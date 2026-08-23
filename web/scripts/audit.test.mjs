// The longest horizon in the system, against a real Firestore.
//
// The Auditor's three refusals are what keep it honest, and two of them are enforced here
// rather than by the model: it may not be asked about a procedure with no aggregate behind it,
// and it may never hand over a replacement figure. The third — one technician is not a
// procedure — is the model's own and is tested in the scenario corpus.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/audit.test.mjs
//
// Requires the Firestore emulator; scripts/smoke.sh starts it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCP_PROJECT = "warrant-rules-test";
process.env.WARRANT_FLEET_ENGINE ??=
  "projects/1/locations/us-central1/reasoningEngines/test";

const { audit } = await import("../src/server/adjudicate/audit.ts");
const { proceduresDueAnAudit } = await import("../src/server/tasks.ts");
const { adminDb } = await import("../src/auth/admin.ts");

const TENANT = "acme.com";
const db = adminDb();

/** A procedure with `count` sealed jobs behind it, each carrying one blocked step. */
async function seedProcedure(procedureId, count, { reason } = {}) {
  await db.doc(`tenants/${TENANT}/procedure_versions/${procedureId}`).set({
    title: "Fork oil change", version: 3, strictness: 2,
    published_at: "2026-06-01T00:00:00Z",
    steps: [{ id: "s2", title: "Judge the oil", explanation: "Contaminated oil ruins seals." }],
  });
  for (let i = 0; i < count; i++) {
    const job = db.doc(`tenants/${TENANT}/jobs/${procedureId}_j${i}`);
    await job.set({
      id: `${TENANT}/${procedureId}_j${i}`, tenant_id: TENANT,
      procedure_id: procedureId, status: "sealed", asset_id: `bike-${i}`,
      started_at: `2026-08-${String(i + 1).padStart(2, "0")}T09:00:00Z`,
    });
    await job.collection("step_outcomes").doc("s2").set({
      id: "s2", step_id: "s2", status: "deferred",
      reason_transcript: reason ?? "no idea how you're meant to tell fork oil from road grime",
      reason_by: `tech_${i % 2}`,
    });
  }
  return { tenantId: TENANT, procedureId };
}

const FINDING = {
  mode: "revise",
  understanding: "Step 2 has been read two different ways by two technicians across the window.",
  jobs_examined: 5,
  considered_and_rejected: [],
  findings: [{
    step_title: "Judge the oil", field_key: "oil_state",
    defect: "ambiguous_instruction",
    what: "The step says to judge the oil without saying what disqualifies it.",
    jobs_cited: ["j0", "j1", "j2"], jobs_affected: 3,
    proposed_revision: "State what counts as contaminated.",
    needs_the_shop: true, confidence: 0.8,
  }],
};

const fleet = (output, { valid = true, errors = [] } = {}) => {
  const seen = {};
  return { seen, ask: async (agent, kase) => {
    seen[agent] = kase;
    return { output, valid, schemaErrors: errors, model: "gemini-3.5-flash",
             latencyMs: 2000, usage: { totalTokenCount: 9000 } };
  } };
};

describe("audit", () => {
  test("a procedure with almost no history is never put to the model", async () => {
    // "I do not have enough history" is a correct answer, and asking anyway wastes a call to
    // produce a finding from two jobs — which is noise wearing a uniform.
    const ref = await seedProcedure("thin-proc", 2);
    const f = fleet(FINDING);
    const out = await audit(ref, { ask: f.ask, db });
    assert.equal(out.mode, "insufficient_history");
    assert.equal(f.seen.auditor, undefined, "the model must not have been asked");
    assert.equal(out.decisionId, null);
  });

  test("the jobs go over whole, with their stated reasons", async () => {
    const ref = await seedProcedure("full-proc", 5);
    const f = fleet(FINDING);
    await audit(ref, { ask: f.ask, db });

    const kase = f.seen.auditor;
    assert.equal(kase.jobs.length, 5);
    assert.equal(kase.procedure.steps.length, 1);
    // The strongest evidence in the document: somebody stopped work and explained why.
    assert.match(kase.jobs[0].steps[0].reason, /road grime/);
    assert.ok(kase.jobs[0].steps[0].reason_by);
  });

  test("a truncated window SAYS it was truncated", async () => {
    // A count computed from a sample and presented as a census is a fabricated denominator,
    // and every finding this agent makes rests on one.
    const ref = await seedProcedure("big-proc", 25);
    const f = fleet(FINDING);
    await audit(ref, { ask: f.ask, db });

    const kase = f.seen.auditor;
    assert.equal(kase.jobs.length, 20);
    assert.match(kase.window.truncated, /25 jobs ran/);
    assert.match(kase.window.truncated, /out of 20/);
  });

  test("a finding becomes a record and a task for somebody who can change it", async () => {
    const ref = await seedProcedure("defect-proc", 5);
    const out = await audit(ref, { ask: fleet(FINDING).ask, db });

    assert.equal(out.mode, "revise");
    assert.equal(out.findingIds.length, 1);
    assert.equal(out.taskIds.length, 1);

    const finding = await db.doc(`tenants/${TENANT}/findings/${out.findingIds[0]}`).get();
    assert.equal(finding.data().defect, "ambiguous_instruction");
    assert.equal(finding.data().procedure_id, "defect-proc");
    // A wrong bound can only be replaced by a figure the shop states, so the record carries
    // which findings a person actually has to talk about.
    assert.equal(finding.data().needs_the_shop, true);

    const task = await db.doc(`tenants/${TENANT}/tasks/${out.taskIds[0]}`).get();
    // Filed against the procedure and raised at somebody who can change it — never at a
    // technician who cannot.
    assert.equal(task.data().assignee_role, "owner");
    assert.match(task.data().title, /needs revising/);
  });

  test("an audit that found nothing is still written down", async () => {
    // Without this, "no findings" is indistinguishable from "never audited".
    const ref = await seedProcedure("clean-proc", 5);
    const out = await audit(ref, {
      ask: fleet({ mode: "no_defect", understanding: "It is behaving.", jobs_examined: 5,
                   findings: [], considered_and_rejected: ["one job in five is not a pattern"] }).ask,
      db,
    });
    assert.equal(out.mode, "no_defect");
    assert.equal(out.findingIds.length, 0);
    const record = await db.doc(`tenants/${TENANT}/audits/clean-proc`).get();
    assert.ok(record.exists);
    assert.equal(record.data().mode, "no_defect");
    assert.equal(record.data().jobs_available, 5);
  });

  test("an off-contract answer writes no findings", async () => {
    const ref = await seedProcedure("bad-proc", 5);
    const out = await audit(ref, {
      ask: fleet({ mode: "revise" }, { valid: false, errors: ["findings: required"] }).ask, db,
    });
    assert.equal(out.findingIds.length, 0);
    const decision = await db.doc(`tenants/${TENANT}/decisions/${out.decisionId}`).get();
    assert.equal(decision.data().verdict, "invalid");
  });

  test("a prior finding is shown so it is not re-reported as new", async () => {
    const ref = await seedProcedure("repeat-proc", 5);
    await audit(ref, { ask: fleet(FINDING).ask, db });
    const f = fleet(FINDING);
    await audit(ref, { ask: f.ask, db });
    assert.ok(f.seen.auditor.prior_findings.length >= 1);
    assert.equal(f.seen.auditor.prior_findings[0].defect, "ambiguous_instruction");
  });
});

describe("proceduresDueAnAudit", () => {
  test("a procedure just audited is not audited again", async () => {
    await seedProcedure("recent-proc", 5);
    await audit({ tenantId: TENANT, procedureId: "recent-proc" },
                { ask: fleet(FINDING).ask, db });
    const due = await proceduresDueAnAudit(50);
    assert.ok(!due.some((d) => d.procedureId === "recent-proc"));
  });

  test("a procedure audited long ago comes back round", async () => {
    await seedProcedure("stale-proc", 5);
    await db.doc(`tenants/${TENANT}/audits/stale-proc`).set({
      procedure_id: "stale-proc", at: "2026-01-01T00:00:00Z", mode: "no_defect",
    });
    const due = await proceduresDueAnAudit(50);
    assert.ok(due.some((d) => d.procedureId === "stale-proc"));
  });
});
