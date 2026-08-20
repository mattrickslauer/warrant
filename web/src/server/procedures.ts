import "server-only";

// Publishing a procedure.
//
// A procedure is private by construction: it lives under the tenant subtree, so
// firestore.rules already makes it unreachable to anyone else. No visibility flag enforces
// anything, and one would be worse than nothing — a flag that looks like a permission but is
// not is how people end up trusting the wrong thing.
//
// What publishing does is FREEZE a version. `/tenants/{t}/procedure_versions/{id}:{n}` is
// server-written and immutable, and a job pins the version it started under. Without that,
// publishing v3 while a v2 job is being performed silently changes the steps under the
// technician's hands, while the job still records `procedure_version: 2` — and the sealed
// record promises it names the version that ran.
//
// See specs/2026-08-20-firestore-design.md §5.

import { adminDb } from "@/auth/admin";
import { getMember } from "@/auth/members";
import type { Procedure } from "@/generated/types";

export class NotAllowed extends Error {}

export const versionId = (procedureId: string, version: number) => `${procedureId}:${version}`;

/**
 * Freeze the current draft as the next version and mark it published.
 *
 * Idempotent in the way that matters: the frozen document is written with `create` semantics
 * via a transaction that refuses to overwrite an existing version. A version that could be
 * rewritten is not a version, and a job pinned to it would not be pinned to anything.
 */
export async function publishProcedure(
  tenantId: string, procedureId: string, byUid: string,
): Promise<{ version: number }> {
  const member = await getMember(tenantId, byUid);
  if (!member || member.disabled || !member.standing.may_publish_procedures) {
    throw new NotAllowed("You do not have standing to publish procedures.");
  }

  const db = adminDb();
  const tenantRef = db.collection("tenants").doc(tenantId);
  const procRef = tenantRef.collection("procedures").doc(procedureId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(procRef);
    if (!snap.exists) throw new NotAllowed(`No such procedure: ${procedureId}`);

    const procedure = snap.data() as Procedure;
    const version = (procedure.current_version ?? procedure.version ?? 0) + 1;
    const frozenRef = tenantRef.collection("procedure_versions").doc(versionId(procedureId, version));

    const existing = await tx.get(frozenRef);
    if (existing.exists) {
      throw new NotAllowed(`Version ${version} of ${procedureId} already exists.`);
    }

    const now = new Date().toISOString();
    const frozen: Procedure = {
      ...procedure,
      schema_version: 1,
      version,
      current_version: version,
      status: "published",
      published_at: now,
      published_by: byUid,
    };

    tx.set(frozenRef, frozen);
    tx.set(procRef, {
      version,
      current_version: version,
      status: "published",
      published_at: now,
      published_by: byUid,
      updated_at: now,
      schema_version: 1,
    }, { merge: true });

    return { version };
  });
}

/** The frozen version a job pinned. Never the live document. */
export async function getProcedureVersion(
  tenantId: string, procedureId: string, version: number,
): Promise<Procedure | null> {
  const snap = await adminDb()
    .collection("tenants").doc(tenantId)
    .collection("procedure_versions").doc(versionId(procedureId, version))
    .get();
  return snap.exists ? (snap.data() as Procedure) : null;
}
