// Claiming an anonymous tenant, against real Firestore.
//
// This is the riskiest code in the auth layer: a recursive copy across an arbitrarily deep
// document tree, followed by a delete. Getting it wrong loses a visitor's work — the exact
// outcome the anonymous tenant exists to prevent — and it is the one path that cannot be
// exercised by clicking through the product, because reaching it requires linking a real
// Google account to an anonymous session.
//
//   node --experimental-strip-types --conditions=react-server \
//        --import ./scripts/ts-resolve.mjs --test scripts/claim.test.mjs
//
// Needs Admin credentials (GOOGLE_APPLICATION_CREDENTIALS or ADC) and writes to the live
// project under `anon:claimtest-*` and `claimtest-*.example`, which it removes afterwards.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";

const { claimTenant } = await import("@/auth/claim");
const { adminDb } = await import("@/auth/admin");

const SOURCE = { id: "anon:claimtest-source", kind: "anon", hd: null };
const DEST = { id: "claimtest-dest.example", kind: "workspace", hd: "claimtest-dest.example" };

const db = adminDb();

async function wipe(tenantId) {
  const ref = db.collection("tenants").doc(tenantId);
  for (const collection of await ref.listCollections()) {
    for (const doc of (await collection.get()).docs) {
      for (const sub of await doc.ref.listCollections()) {
        for (const d of (await sub.get()).docs) await d.ref.delete();
      }
      await doc.ref.delete();
    }
  }
  await ref.delete();
}

before(async () => {
  await wipe(SOURCE.id);
  await wipe(DEST.id);

  // A visitor who did real work before signing in: two jobs, one with a capture nested
  // beneath it, and a sealed record. Depth matters — a flat copy would pass a shallow test
  // and still silently drop the captures, which are the evidence.
  await db.doc(`tenants/${SOURCE.id}`).set({ kind: "anon", hd: null, region: "us", claimed_at: null });
  await db.doc(`tenants/${SOURCE.id}/jobs/job-1`).set({ status: "sealed", note: "front brake" });
  await db.doc(`tenants/${SOURCE.id}/jobs/job-1/captures/cap-1`).set({ kind: "photo", ref: "gs://x/1" });
  await db.doc(`tenants/${SOURCE.id}/jobs/job-2`).set({ status: "open" });
  await db.doc(`tenants/${SOURCE.id}/records/rec-1`).set({ sealed: true });
});

after(async () => {
  await wipe(SOURCE.id);
  await wipe(DEST.id);
});

describe("claiming an anonymous tenant", () => {
  test("moves every document, at every depth, and stamps the claim", async () => {
    const result = await claimTenant(SOURCE, DEST);

    assert.equal(result.documents_moved, 4, "two jobs, one capture and one record should move");
    assert.ok(result.claimed_at, "the claim must be stamped");

    const job = await db.doc(`tenants/${DEST.id}/jobs/job-1`).get();
    assert.ok(job.exists);
    assert.equal(job.data().note, "front brake", "field values must survive the move");

    // The nested capture is the point of the recursion.
    const capture = await db.doc(`tenants/${DEST.id}/jobs/job-1/captures/cap-1`).get();
    assert.ok(capture.exists, "a capture nested under a job must move with it");
    assert.equal(capture.data().ref, "gs://x/1");

    const record = await db.doc(`tenants/${DEST.id}/records/rec-1`).get();
    assert.ok(record.exists, "sealed records must move");

    const tenant = await db.doc(`tenants/${DEST.id}`).get();
    assert.ok(tenant.data().claimed_at, "the destination tenant must record when it was claimed");
  });

  test("leaves nothing behind in the anonymous tenant", async () => {
    const source = await db.doc(`tenants/${SOURCE.id}`).get();
    assert.equal(source.exists, false, "the anonymous tenant document must be gone");

    const jobs = await db.collection(`tenants/${SOURCE.id}/jobs`).get();
    assert.equal(jobs.size, 0, "no job may remain readable at the old address");

    const captures = await db.collection(`tenants/${SOURCE.id}/jobs/job-1/captures`).get();
    assert.equal(captures.size, 0, "no capture may remain readable at the old address");
  });

  test("claiming into the same tenant is a stamp, not a move", async () => {
    // A solo user signing in from their own anonymous session can resolve to the same id.
    // Copy-then-delete would then delete what it had just written — losing everything.
    const same = { id: "anon:claimtest-source", kind: "anon", hd: null };
    await db.doc(`tenants/${same.id}`).set({ kind: "anon", region: "us", claimed_at: null });
    await db.doc(`tenants/${same.id}/jobs/job-9`).set({ status: "open" });

    const result = await claimTenant(same, same);

    assert.equal(result.documents_moved, 0);
    const survived = await db.doc(`tenants/${same.id}/jobs/job-9`).get();
    assert.ok(survived.exists, "self-claim must not delete the tenant's own work");
    const stamped = await db.doc(`tenants/${same.id}`).get();
    assert.ok(stamped.data().claimed_at, "self-claim must still stamp claimed_at");
  });
});
