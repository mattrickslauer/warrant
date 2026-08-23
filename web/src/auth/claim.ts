import "server-only";

// Claiming an anonymous tenant.
//
// A visitor can use the product with no credentials at all — they get a real tenant, real
// jobs and real sealed records under `anon:<uid>`. Signing in afterwards must not throw that
// away, so the anonymous Firebase user is UPGRADED in place with linkWithCredential (the uid
// survives) and everything under the anonymous tenant is moved to the tenant their account
// resolves to.
//
// The move is a copy-then-delete rather than a rename because Firestore has no rename, and
// because the destination is frequently a Workspace tenant that already exists and already
// has other people's work in it.

import { adminDb } from "./admin";
import type { TenantRef } from "./tenant";
import { ensureTenant } from "./provision";

/** A visitor who generates more than this before signing in is not a demo, it is a runaway. */
const MAX_DOCS = 5000;

export interface ClaimResult {
  from: string;
  to: string;
  documents_moved: number;
  /** Paths the destination already held, left in place. Never silently dropped. */
  documents_skipped: string[];
  claimed_at: string;
  /**
   * Capture objects that could not be moved with their documents.
   *
   * Evidence lives at `tenants/{t}/captures/{jobId}/{file}` and storage.rules grants read only
   * when `tenantOf() == t` — so a claimed job whose objects stayed under the old anonymous
   * prefix renders a record with no photographs in it, which is the one thing a record must
   * not do. `claimStorage` moves them. Anything it could not move is named here rather than
   * left to be discovered by a customer opening a link.
   */
  media_left_behind: string[];
}

/**
 * Move every document beneath `/tenants/{from}` to `/tenants/{to}`, then delete the source.
 *
 * Depth is unbounded and discovered rather than assumed — `listCollections()` walks whatever
 * subcollections actually exist, so this keeps working as the data model grows and does not
 * need a hard-coded list of collection names to stay correct.
 */
export async function claimTenant(from: TenantRef, to: TenantRef): Promise<ClaimResult> {
  const db = adminDb();
  const claimed_at = new Date().toISOString();

  if (from.id === to.id) {
    await db.collection("tenants").doc(to.id).set({ claimed_at }, { merge: true });
    return { from: from.id, to: to.id, documents_moved: 0, documents_skipped: [],
             claimed_at, media_left_behind: [] };
  }

  await ensureTenant(to);

  const source = db.collection("tenants").doc(from.id);
  const destination = db.collection("tenants").doc(to.id);

  let moved = 0;
  const copied: FirebaseFirestore.DocumentReference[] = [];
  /** Documents the destination already had. Reported rather than silently dropped. */
  const skipped: string[] = [];

  async function walk(
    src: FirebaseFirestore.DocumentReference,
    dst: FirebaseFirestore.DocumentReference,
  ): Promise<void> {
    for (const collection of await src.listCollections()) {
      const docs = await collection.get();
      for (const doc of docs.docs) {
        if (moved >= MAX_DOCS) {
          throw new Error(`Refusing to claim more than ${MAX_DOCS} documents in one go.`);
        }
        const target = dst.collection(collection.id).doc(doc.id);

        // NEVER OVER SOMETHING THAT IS ALREADY THERE.
        //
        // This was `set(..., { merge: false })`, which overwrites. The destination is very
        // often a Workspace tenant that already exists and already holds other people's work,
        // and document ids in this system are frequently PREDICTABLE — `/api/procedures/seed`
        // writes `proc_front_brake_v3` into every tenant that asks. So an anonymous visitor
        // could create `procedures/proc_front_brake_v3` in their own throwaway tenant, put
        // whatever acceptance rules they liked in it, then sign in with a corporate account
        // and have the claim silently overwrite the shop's published procedure with theirs.
        // A migration is not a merge conflict resolver; when the destination already has this
        // document, the destination wins and the source copy is left behind rather than
        // deleted, so nothing is lost and nothing is clobbered.
        if ((await target.get()).exists) {
          skipped.push(`${collection.id}/${doc.id}`);
          continue;
        }

        await target.set(doc.data(), { merge: false });
        copied.push(doc.ref);
        moved += 1;
        await walk(doc.ref, target);
      }
    }
  }

  await walk(source, destination);

  // Delete only after every copy has landed. A crash midway leaves duplicated data, which is
  // recoverable; deleting first and crashing would lose it, which is not.
  for (let i = 0; i < copied.length; i += 400) {
    const batch = db.batch();
    for (const ref of copied.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
  await source.delete();

  await destination.set({ claimed_at }, { merge: true });

  // The evidence follows the documents. Done AFTER the copies land and before the source
  // documents go, for the same reason the deletes are ordered that way: duplicated bytes are
  // recoverable and missing ones are not.
  const media_left_behind = await claimStorage(from.id, to.id);

  return { from: from.id, to: to.id, documents_moved: moved, documents_skipped: skipped,
           claimed_at, media_left_behind };
}


/**
 * Move a tenant's capture objects to the tenant that claimed it.
 *
 * storage.rules is keyed on the path — `/tenants/{t}/captures/{jobId}/{file}` readable only
 * when `tenantOf() == t` — so evidence that stays behind is evidence its own owner can no
 * longer read. The jobs moved; without this the photographs did not, and the failure surfaces
 * as a sealed record full of broken images, weeks later, to a stranger.
 *
 * COPY THEN DELETE, never move-in-place, and never fail the claim over it. A visitor who has
 * just signed in must not be told their sign-in failed because a bucket was busy; the names of
 * anything left behind are returned so the caller can say so precisely.
 */
async function claimStorage(fromTenant: string, toTenant: string): Promise<string[]> {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) return [];

  const prefix = `tenants/${fromTenant}/captures/`;
  const stranded: string[] = [];

  try {
    const { getStorage } = await import("firebase-admin/storage");
    const { adminApp } = await import("./admin");
    const bucket = getStorage(adminApp()).bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix });

    for (const file of files) {
      const destination = `tenants/${toTenant}/captures/${file.name.slice(prefix.length)}`;
      try {
        await file.copy(bucket.file(destination));
        await file.delete();
      } catch {
        stranded.push(file.name);
      }
    }
  } catch {
    // An unreachable bucket is not a reason to fail a sign-in. The documents have already
    // moved; the objects can be reconciled, and the prefix is named so somebody can.
    stranded.push(`${prefix}*`);
  }

  return stranded;
}
