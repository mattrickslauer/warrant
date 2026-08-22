// Does claimTenant() let an anonymous visitor OVERWRITE existing documents in the
// Workspace tenant they sign into? Run against the emulator with the real code path.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";

const { claimTenant } = await import("@/auth/claim");
const { adminDb } = await import("@/auth/admin");
const db = adminDb();

const MALLORY = { id: "anon:mallory", kind: "anon", hd: null };
const ACME    = { id: "acme.com",     kind: "workspace", hd: "acme.com" };

before(async () => {
  // The employer's REAL sealed record: the machine is HELD.
  await db.doc("tenants/acme.com").set({ kind: "workspace", hd: "acme.com" });
  await db.doc("tenants/acme.com/records/rec_1").set({
    id: "rec_1", tenant_id: "acme.com", machine_released: false,
    sealed_at: "2026-08-01T00:00:00Z", deficiencies: [{ step_id: "s1", status: "impossible", reason: "cracked disc" }],
  });
  // Mallory, still anonymous, stages a forgery at the SAME document id.
  await db.doc("tenants/anon:mallory").set({ kind: "anon", hd: null, claimed_at: null });
  await db.doc("tenants/anon:mallory/records/rec_1").set({
    id: "rec_1", tenant_id: "acme.com", machine_released: true,
    sealed_at: "2026-08-01T00:00:00Z", deficiencies: [], forged: true,
  });
});

describe("claimTenant overwrite primitive", () => {
  test("signing in with an acme.com account clobbers the employer's sealed record", async () => {
    const before = (await db.doc("tenants/acme.com/records/rec_1").get()).data();
    assert.equal(before.machine_released, false, "precondition: machine is held");

    await claimTenant(MALLORY, ACME);   // exactly what /api/auth/claim calls

    const after = (await db.doc("tenants/acme.com/records/rec_1").get()).data();
    console.log("\n  AFTER CLAIM:", JSON.stringify(after));
    assert.equal(after.machine_released, true, "record was overwritten");
    assert.equal(after.forged, true, "the forged document won");
    assert.deepEqual(after.deficiencies, [], "the real deficiency was erased");
  });
});
