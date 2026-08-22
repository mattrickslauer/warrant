// INDEPENDENT ADVERSARIAL RULES AUDIT — written by the auditor, not by the repo.
// Tests what an attacker can actually do, not what the comments say is prevented.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc } from "firebase/firestore";

const RULES = new URL("../../firestore.rules", import.meta.url);
let env;

const WS  = (uid, hd) => env.authenticatedContext(uid, { hd, firebase: { sign_in_provider: "google.com" } }).firestore();
const SOLO= (uid)     => env.authenticatedContext(uid, { firebase: { sign_in_provider: "google.com" } }).firestore();
const ANON= (uid)     => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();
const OUT  = ()       => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "warrant-audit",
    firestore: { rules: readFileSync(RULES, "utf8"), host: "127.0.0.1", port: 8080 },
  });
  // Seed a REAL sealed record and a REAL catalogue entry, bypassing rules.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "tenants/acme.com"), { kind: "workspace", hd: "acme.com" });
    await setDoc(doc(db, "tenants/acme.com/records/rec_1"), {
      id: "rec_1", job_id: "job_1", tenant_id: "acme.com",
      machine_released: false, sealed_at: "2026-08-19T00:00:00Z", public: true,
    });
    await setDoc(doc(db, "tenants/acme.com/jobs/job_1"), {
      id: "job_1", tenant_id: "acme.com", status: "sealed",
      steps: [{ step_id: "s1", status: "performed", fields: [{ key: "torque", provenance_class: "asserted" }] }],
    });
    await setDoc(doc(db, "spec_values/v1"), { torque_nm: 110 });
  });
});
after(async () => { await env?.cleanup(); });

describe("A. tenancy isolation (the claim the repo makes)", () => {
  test("a Workspace user cannot read another domain's tenant data", async () => {
    await assertFails(getDoc(doc(WS("evil", "evil.com"), "tenants/acme.com/records/rec_1")));
  });
  test("a solo consumer user cannot read a Workspace tenant", async () => {
    await assertFails(getDoc(doc(SOLO("consumer"), "tenants/acme.com/records/rec_1")));
  });
  test("an anonymous visitor cannot read another anonymous visitor's tenant", async () => {
    await assertFails(getDoc(doc(ANON("anon-b"), "tenants/anon:anon-a/jobs/job_1")));
  });
  test("an unauthenticated stranger cannot read anything", async () => {
    await assertFails(getDoc(doc(OUT(), "tenants/acme.com/records/rec_1")));
    await assertFails(getDoc(doc(OUT(), "spec_values/v1")));
  });
});

describe("B. the tenant document itself", () => {
  test("an outsider cannot seed a tenant they do not belong to", async () => {
    await assertFails(setDoc(doc(SOLO("squatter"), "tenants/notyet.com"), { kind: "workspace" }));
  });
  test("even a member cannot write their own tenant doc", async () => {
    await assertFails(setDoc(doc(WS("tech1", "acme.com"), "tenants/acme.com"), { kind: "workspace", pwned: true }));
  });
});

describe("C. catalogue is read-only to clients", () => {
  test("a signed-in user may read the catalogue", async () => {
    await assertSucceeds(getDoc(doc(SOLO("tech1"), "spec_values/v1")));
  });
  test("no client may write the catalogue", async () => {
    await assertFails(setDoc(doc(WS("tech1", "acme.com"), "spec_values/v1"), { torque_nm: 1 }));
  });
});

describe("D. INTEGRITY — can a tenant member tamper with sealed evidence?", () => {
  test("ATTACK: rewrite a SEALED record to release a held machine", async () => {
    const db = WS("tech1", "acme.com");
    await assertSucceeds(updateDoc(doc(db, "tenants/acme.com/records/rec_1"), { machine_released: true }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), "tenants/acme.com/records/rec_1"));
      assert.equal(snap.data().machine_released, true, "sealed record was mutated by a client");
    });
  });
  test("ATTACK: DELETE a sealed record outright", async () => {
    await assertSucceeds(deleteDoc(doc(WS("tech1", "acme.com"), "tenants/acme.com/records/rec_1")));
  });
  test("ATTACK: forge provenance_class 'measured' with no instrument", async () => {
    const db = WS("tech1", "acme.com");
    await assertSucceeds(setDoc(doc(db, "tenants/acme.com/jobs/job_1"), {
      id: "job_1", tenant_id: "acme.com", status: "sealed",
      steps: [{ step_id: "s1", status: "performed",
        fields: [{ key: "torque", value: 110, provenance_class: "measured", tool_id: "totally-real-wrench" }] }],
    }));
  });
  test("ATTACK: forge a waiver signed by someone with standing", async () => {
    await assertSucceeds(setDoc(doc(WS("tech1", "acme.com"), "tenants/acme.com/jobs/job_2"), {
      id: "job_2", tenant_id: "acme.com",
      steps: [{ step_id: "s1", status: "waived", waived_by: "the.ceo@acme.com" }],
    }));
  });
  test("ATTACK: forge an agent Decision in the audit log", async () => {
    await assertSucceeds(addDoc(collection(WS("tech1", "acme.com"), "tenants/acme.com/decisions"), {
      job_id: "job_1", agent: "inspector", verdict: "PASS", rationale: "I never ran.",
    }));
  });
});

describe("E. anonymous tenant used as a staging area (claim-overwrite primitive)", () => {
  test("an anon visitor can create docs with ATTACKER-CHOSEN ids under their own tenant", async () => {
    // These ids are what claimTenant() later copies into the destination tenant with merge:false.
    await assertSucceeds(setDoc(doc(ANON("mallory"), "tenants/anon:mallory/records/rec_1"), {
      id: "rec_1", machine_released: true, tenant_id: "acme.com", sealed_at: "2026-01-01T00:00:00Z",
    }));
  });
});

describe("F. public record sharing", () => {
  test("a record marked public:true is STILL unreadable by a stranger", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "tenants/acme.com/records/rec_pub"), { public: true });
    });
    await assertFails(getDoc(doc(OUT(), "tenants/acme.com/records/rec_pub")));
    await assertFails(getDoc(doc(SOLO("stranger"), "tenants/acme.com/records/rec_pub")));
  });
});
