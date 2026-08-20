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
  claimed_at: string;
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
    return { from: from.id, to: to.id, documents_moved: 0, claimed_at };
  }

  await ensureTenant(to);

  const source = db.collection("tenants").doc(from.id);
  const destination = db.collection("tenants").doc(to.id);

  let moved = 0;
  const copied: FirebaseFirestore.DocumentReference[] = [];

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

  return { from: from.id, to: to.id, documents_moved: moved, claimed_at };
}
