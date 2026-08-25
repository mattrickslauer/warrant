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
import { faults, prune, NotCompilable, type Draft } from "@/server/procedure-faults";
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
): Promise<{ version: number; dropped: string[] }> {
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

    const stored = snap.data() as Procedure;

    // Pruned first, for the same reason and with the same consequences as on the Scoper's
    // path — see `prune`. The hand editor is if anything the likelier source: somebody sets a
    // field to `choice` and publishes before writing the answers, and what freezes is a step
    // no technician can get past.
    //
    // The prune happens on the way INTO the frozen version and is also written back to the
    // live draft below, so the editor shows what actually shipped rather than a field that
    // silently stopped being part of the procedure. `index` is renumbered so the steps read
    // 1..n on a page; the step IDS are left exactly alone, because a job pins step ids and
    // renumbering those would orphan every outcome already written against them.
    const { draft: cleaned, dropped } = prune(stored as unknown as Draft);
    const procedure: Procedure = {
      ...(cleaned as unknown as Procedure),
      steps: (cleaned.steps ?? []).map((step, i) => ({ ...step, index: i + 1 })) as Procedure["steps"],
      dropped,
    };

    // The gate, applied HERE rather than only on the Scoper's path.
    //
    // `compileProcedure` has always run this before calling us, so an interview could not
    // freeze a draft with a `within` rule and no bound. The hand editor writes the same
    // document by a different door, and until this check moved onto the publish path that door
    // had no lock on it: a step with no title, a field with no acceptance rule, a choice
    // offering only the answer that means the job went well — all freezable, all then
    // unfixable, because a frozen version is immutable by design.
    //
    // Refused with its reasons rather than a status code, because the person is looking at the
    // very form that can fix each one. Draft-time validity was never required and still is not;
    // this is the one moment it becomes required, which is the moment it starts to matter.
    const problems = faults(procedure);
    if (problems.length) throw new NotCompilable(problems);

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
      // The live draft is brought into line with what was frozen. Leaving it alone would put
      // the editor and the published version out of step on exactly the fields somebody needs
      // to see to fix them: the author would keep editing a choice field that no longer
      // exists in anything anyone runs.
      steps: procedure.steps,
      dropped,
    }, { merge: true });

    return { version, dropped };
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

/**
 * The version a running job is actually judged against.
 *
 * THIS IS THE FUNCTION THAT MAKES THE PIN REAL, and until it existed the pin was decorative:
 * `publishProcedure` froze `{id}:{n}` and every server-side reader asked for `{id}` — a
 * document only the public-catalogue seed ever wrote. So a procedure authored through the
 * Scoper and published had no version any reader could find, every capture against it threw
 * "step X is not in the pinned procedure version", and the capture was never marked
 * adjudicated, so the sweep retried it forever. Meanwhile the guarantee the comments all
 * claimed — "a job is judged against the rules it started under" — was false in the other
 * direction too: the one document being read was mutable.
 *
 * The job's `procedure_version` is honoured first. The bare `{id}` document is a fallback and
 * nothing more: it is what `/api/procedures/seed` wrote before it learned to write both, and a
 * job pinned to a version that was never frozen must still be runnable rather than stranding a
 * technician mid-procedure.
 */
export async function pinnedVersion(
  db: FirebaseFirestore.Firestore,
  tenantId: string,
  procedureId: string,
  version: number | null | undefined,
): Promise<Procedure | null> {
  const versions = db.collection("tenants").doc(tenantId).collection("procedure_versions");

  if (typeof version === "number" && Number.isFinite(version)) {
    const exact = await versions.doc(versionId(procedureId, version)).get();
    if (exact.exists) return exact.data() as Procedure;
  }

  const bare = await versions.doc(procedureId).get();
  return bare.exists ? (bare.data() as Procedure) : null;
}
