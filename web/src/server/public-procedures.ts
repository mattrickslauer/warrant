import "server-only";

// Showing a procedure to the world.
//
// `server/procedures.ts` says a procedure is private by construction and that a visibility
// flag would be worse than nothing, and it is right — which is why there is no flag here. The
// private procedure never moves. It stays at /tenants/{t}/procedures/{id}, where the subtree
// rule keeps it unreachable to everyone else, and sharing writes a SECOND document at
// /public_procedures/{publicId}: a projection of ONE frozen version, world-readable and
// nobody-writable. Unsharing deletes it.
//
// So `public_id` on the procedure is a pointer to where the copy lives, not a claim about who
// may read anything. If the two ever disagree, the document is the truth and the pointer is
// stale — which is the safe direction, because a stale pointer grants nothing.
//
// This is deliberately the same shape as `server/publish.ts`, which does it for sealed
// records. Two mechanisms for "make this one thing public" would be two sets of rules to keep
// honest, and the second one is always the one that rots.
//
// WHAT IS PUBLISHED IS A FROZEN VERSION, never the live draft. A shop editing v2 in the
// authoring desk must not be silently broadcasting half of it, and somebody reading the public
// copy has to be reading something that will still say the same thing tomorrow.

import { adminDb } from "@/auth/admin";
import { getMember } from "@/auth/members";
import { newPublicId } from "@/server/publish";
import { versionId, NotAllowed } from "@/server/procedures";
import type { Procedure, Step } from "@/generated/types";

/**
 * The public copy of a procedure.
 *
 * NO tenant id and NO uid, for the reason firestore.rules gives at length: this collection is
 * listable by anyone, on purpose, because being found is the point of publishing. A tenant id
 * in a listable collection would be an enumeration of every shop using Warrant, and for a
 * consumer account `u:{uid}` is a Firebase uid. The owner is named the way a published record
 * names its issuer — by a display label that resolves to a person or a company, not to a key
 * anything else in the system is addressed by.
 */
export interface PublicProcedure {
  schema_version: number;
  id: string;
  /** Stable across versions. Not unique across tenants — two shops may both have `brake-service`. */
  key: string;
  title: string;
  /** WHICH frozen version this is a copy of. */
  version: number;
  strictness: number;
  minimum_tier: string;
  disqualifiers: string[];
  releases: string[];
  steps: Step[];
  /** When this version was frozen, not when it was shared. */
  published_at: string | null;
  /** When it was put here. What "newest" on the home page orders by. */
  shared_at: string;
  owner_label: string;
}

/**
 * Who to say wrote it.
 *
 * A Workspace tenant IS a domain, which is a public name a company chose and the honest
 * attribution. A consumer tenant is `u:{uid}`, which is not a name and must not leave the
 * instance space, so the person's own display name stands in — the same substitution
 * `publish.ts` makes for a record's issuer.
 */
function ownerLabel(tenantId: string, displayName: string | null): string {
  if (!tenantId.startsWith("u:") && !tenantId.startsWith("anon:")) return tenantId;
  return displayName?.trim() || "A Warrant user";
}

/**
 * Publish the current frozen version to the public collection, or refuse.
 *
 * Standing is checked here and not in the route for the same reason `publishProcedure` checks
 * it here: this is the only path to the collection, and a check the caller performs is a check
 * the caller can skip. `may_publish_procedures` is the right standing — deciding that the
 * world may read what your shop calls done is at least as consequential as freezing it.
 *
 * Re-sharing after publishing a new version REUSES the existing public id, so a link somebody
 * has already sent to a customer keeps working and starts showing the newer version. Minting a
 * fresh id would quietly break every link that had been shared, which is the failure mode the
 * whole capability-URL design in `publish.ts` exists to avoid.
 */
export async function shareProcedure(
  tenantId: string, procedureId: string, byUid: string,
): Promise<{ publicId: string; version: number }> {
  const member = await getMember(tenantId, byUid);
  if (!member || member.disabled || !member.standing.may_publish_procedures) {
    throw new NotAllowed("You do not have standing to publish procedures.");
  }

  const db = adminDb();
  const tenantRef = db.collection("tenants").doc(tenantId);
  const procRef = tenantRef.collection("procedures").doc(procedureId);

  const snap = await procRef.get();
  if (!snap.exists) throw new NotAllowed(`No such procedure: ${procedureId}`);
  const procedure = snap.data() as Procedure;

  // A draft has no frozen version, so there is nothing that can be shown without it changing
  // under the reader. Refused rather than silently publishing the live document.
  const version = procedure.current_version ?? procedure.version ?? 0;
  if (procedure.status !== "published" || version < 1) {
    throw new NotAllowed("Publish this procedure before sharing it. Only a frozen version can be made public.");
  }

  const frozenSnap = await tenantRef
    .collection("procedure_versions").doc(versionId(procedureId, version)).get();
  if (!frozenSnap.exists) {
    throw new NotAllowed(`Version ${version} of ${procedureId} was never frozen.`);
  }
  const frozen = frozenSnap.data() as Procedure;

  const publicId = procedure.public_id ?? newPublicId();
  const projection: PublicProcedure = {
    schema_version: 1,
    id: publicId,
    key: frozen.key,
    title: frozen.title,
    version,
    strictness: frozen.strictness,
    minimum_tier: frozen.minimum_tier,
    disqualifiers: frozen.disqualifiers ?? [],
    releases: frozen.releases ?? [],
    steps: frozen.steps ?? [],
    published_at: frozen.published_at ?? null,
    shared_at: new Date().toISOString(),
    owner_label: ownerLabel(tenantId, member.display_name),
  };

  await db.collection("public_procedures").doc(publicId).set(projection);
  await procRef.set({ public_id: publicId, updated_at: projection.shared_at }, { merge: true });

  return { publicId, version };
}

/**
 * Take it back down.
 *
 * The document is deleted rather than marked hidden. A row that is still there but flagged is
 * one query mistake away from being served, and "I unshared it" has to mean the bytes are
 * gone — the same promise `unpublishRecord` makes.
 *
 * Idempotent: a procedure that is already private is not an error to make private.
 */
export async function unshareProcedure(
  tenantId: string, procedureId: string, byUid: string,
): Promise<void> {
  const member = await getMember(tenantId, byUid);
  if (!member || member.disabled || !member.standing.may_publish_procedures) {
    throw new NotAllowed("You do not have standing to publish procedures.");
  }

  const db = adminDb();
  const procRef = db.collection("tenants").doc(tenantId).collection("procedures").doc(procedureId);
  const snap = await procRef.get();
  if (!snap.exists) throw new NotAllowed(`No such procedure: ${procedureId}`);

  const publicId = (snap.data() as Procedure).public_id;
  if (publicId) await db.collection("public_procedures").doc(publicId).delete();
  await procRef.set({ public_id: null, updated_at: new Date().toISOString() }, { merge: true });
}


/**
 * Every procedure anybody has chosen to publish, newest first.
 *
 * This is the read side of `shareProcedure`, and the reason `public_procedures` is a top-level
 * collection rather than a flag on a tenant document: being FOUND is the point of publishing,
 * and a listable collection is what makes finding possible without handing out a link. The
 * documents carry no tenant id and no uid, so listing them enumerates published work rather
 * than the shops using Warrant — see `PublicProcedure` above for why that matters.
 *
 * Never throws, for the reason `readPublicRecord` never throws: this page must render for a
 * reader with no session, no project credentials, and no network to Google. An unreachable
 * Admin SDK means "nothing published yet", not an error page — the empty state says which of
 * the two you are looking at.
 */
export async function listPublicProcedures(limit = 60): Promise<PublicProcedure[]> {
  try {
    const { adminConfigured } = await import("@/auth/admin");
    if (!adminConfigured()) return [];
    const snap = await adminDb()
      .collection("public_procedures")
      .orderBy("shared_at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as PublicProcedure);
  } catch {
    return [];
  }
}
