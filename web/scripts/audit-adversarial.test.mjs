// INDEPENDENT ADVERSARIAL RULES AUDIT — written by the auditor, not by the repo.
// Tests what an attacker can actually do, not what the comments say is prevented.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs } from "firebase/firestore";

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

// EVERY ASSERTION IN THIS SECTION WAS ONCE `assertSucceeds`.
//
// This file was written as a red-team report: each test DEMONSTRATED an attack that worked at
// the time, which is why they read as `assertSucceeds(<attack>)`. Four of the five were closed
// by later hardening, and nothing noticed, because the file was not in scripts/smoke.sh and had
// therefore never been run again. Running it turned four passes into failures — the good kind —
// and left one attack still standing.
//
// They are flipped to `assertFails` here, which converts a report into a regression suite: the
// holes are shut, and now they cannot quietly reopen.
describe("D. INTEGRITY — can a tenant member tamper with sealed evidence?", () => {
  test("a sealed record cannot be rewritten to release a held machine", async () => {
    // `records` is server-written. The Gate decides release from the record; a client that
    // could edit the record could decide it instead.
    const db = WS("tech1", "acme.com");
    await assertFails(updateDoc(doc(db, "tenants/acme.com/records/rec_1"), { machine_released: true }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), "tenants/acme.com/records/rec_1"));
      assert.equal(snap.data().machine_released, false, "the sealed record must be untouched");
    });
  });
  test("a sealed record cannot be deleted outright", async () => {
    await assertFails(deleteDoc(doc(WS("tech1", "acme.com"), "tenants/acme.com/records/rec_1")));
  });
  test("provenance_class 'measured' cannot be forged with no instrument", async () => {
    const db = WS("tech1", "acme.com");
    await assertFails(setDoc(doc(db, "tenants/acme.com/jobs/job_1"), {
      id: "job_1", tenant_id: "acme.com", status: "sealed",
      steps: [{ step_id: "s1", status: "performed",
        fields: [{ key: "torque", value: 110, provenance_class: "measured", tool_id: "totally-real-wrench" }] }],
    }));
  });
  test("an agent Decision cannot be forged in the audit log", async () => {
    // `decisions` is server-written. A record that stamps which agent decided is worth exactly
    // as much as the impossibility of writing that stamp by hand.
    await assertFails(addDoc(collection(WS("tech1", "acme.com"), "tenants/acme.com/decisions"), {
      job_id: "job_1", agent: "inspector", verdict: "PASS", rationale: "I never ran.",
    }));
  });
});

// THE TICK IN THE BOX, AS A RULE.
//
// The section above tests the LEGACY aggregate shape, where a job carried its steps in an
// array. Rules cannot inspect array contents, so those attacks were only ever refused by
// something else on the document — and the current model decomposes a job into
// `step_outcomes/` subdocuments (docs/data-model.md §4), where every one of these fields is at
// the top level and visible to a rule for the first time.
//
// Run against that shape, an ordinary signed-in technician could write a `performed` outcome
// with no evidence, a `waived` one naming the CEO, and their own `disposition_action`. All
// three are now refused by clientMayNotSettleAStep() in firestore.rules.
describe("D2. INTEGRITY — can a technician settle their own step?", () => {
  const stepDoc = (id) => `tenants/acme.com/jobs/job_1/step_outcomes/${id}`;

  test("a technician cannot mark a step PERFORMED", async () => {
    // The entire product in one assertion. `performed` means every required field was accepted
    // by an Inspector; a technician writing it is the tick in the box.
    await assertFails(setDoc(doc(WS("tech1", "acme.com"), stepDoc("s_perf")), {
      id: "s_perf", step_id: "s_perf", status: "performed",
      accepted_fields: ["torque", "photo"],
    }));
  });

  test("a technician cannot forge a waiver naming someone with standing", async () => {
    await assertFails(setDoc(doc(WS("tech1", "acme.com"), stepDoc("s_waive")), {
      id: "s_waive", step_id: "s_waive", status: "waived", waived_by: "the.ceo@acme.com",
    }));
  });

  test("a technician cannot declare a step IMPOSSIBLE", async () => {
    await assertFails(setDoc(doc(WS("tech1", "acme.com"), stepDoc("s_imp")), {
      id: "s_imp", step_id: "s_imp", status: "impossible",
    }));
  });

  test("a technician cannot write the Foreman's disposition", async () => {
    await assertFails(setDoc(doc(WS("tech1", "acme.com"), stepDoc("s_disp")), {
      id: "s_disp", step_id: "s_disp", disposition_action: "revise",
    }));
  });

  test("a technician cannot add themselves to accepted_fields", async () => {
    await assertFails(setDoc(doc(WS("tech1", "acme.com"), stepDoc("s_acc")), {
      id: "s_acc", step_id: "s_acc", accepted_fields: ["torque"],
    }));
  });

  // The other half. A rule that refused these would stop the product working, and a security
  // fix that breaks the flow it protects gets reverted within a day.
  test("a client may still OPEN a step as pending", async () => {
    await assertSucceeds(setDoc(doc(WS("tech1", "acme.com"), stepDoc("s_open")), {
      id: "s_open", job_id: "acme.com/job_1", step_id: "s_open", status: "pending",
    }));
  });

  test("a technician may still declare themselves blocked, without choosing the disposition",
       async () => {
    // What LiveSource.declareBlocked actually writes. Note it sets no status at all: choosing
    // between deferred, waived and impossible is the Foreman's call, made server-side.
    await assertSucceeds(setDoc(doc(WS("tech1", "acme.com"), stepDoc("s_open")), {
      reason_kind: "voice",
      reason_transcript: "the caliper bolt's rounded off, I can't get any purchase on it",
      reason_by: "tech1", reason_at: "2026-08-21T11:00:00Z",
      provenance_class: "asserted",
    }, { merge: true }));
  });

  test("a blocker can still be declared on a step the fleet has PARTLY accepted", async () => {
    // The flow a naive "accepted_fields must be absent" rule would have broken: three fields,
    // one already accepted by an Inspector, and then the technician cannot do the rest.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), stepDoc("s_partial")), {
        id: "s_partial", step_id: "s_partial", status: "pending",
        accepted_fields: ["photo"],
      });
    });
    await assertSucceeds(setDoc(doc(WS("tech1", "acme.com"), stepDoc("s_partial")), {
      reason_kind: "text", reason_transcript: "no torque wrench in the building",
      reason_by: "tech1", provenance_class: "asserted",
    }, { merge: true }));
  });
});

describe("E. anonymous tenant used as a staging area (claim-overwrite primitive)", () => {
  test("an anon visitor cannot stage a record with an ATTACKER-CHOSEN id", async () => {
    // Also once `assertSucceeds`. The staging primitive was: write a `records` document under
    // your own anonymous tenant with an id you choose, then have claimTenant() copy it into the
    // destination. `records` became server-written, which removes the primitive at its source —
    // there is nothing to stage.
    await assertFails(setDoc(doc(ANON("mallory"), "tenants/anon:mallory/records/rec_1"), {
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

  // THE CAPABILITY URL IS ONLY A CAPABILITY IF THE IDS MUST BE GUESSED.
  //
  // `/records/{publicId}` is world-readable by design — holding the link is the credential.
  // But `allow read` is `get` PLUS `list`, and a list rule that does not depend on which
  // document is being fetched grants the entire collection: one getDocs() and a stranger walks
  // every record anybody ever shared, no id-guessing required. The unguessable 22 characters
  // bought nothing. Split into `get` / `list`, and this is what pins it.
  test("the published catalogue can be READ by link and never ENUMERATED", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "records/pub_abcdefghijklmnopqrstuv"),
                   { id: "pub_abcdefghijklmnopqrstuv", revoked: false });
    });
    // Naming it works. That is the whole product feature.
    await assertSucceeds(getDoc(doc(OUT(), "records/pub_abcdefghijklmnopqrstuv")));
    // Asking for all of them does not.
    await assertFails(getDocs(collection(OUT(), "records")));
    await assertFails(getDocs(collection(SOLO("stranger"), "records")));
  });
});
