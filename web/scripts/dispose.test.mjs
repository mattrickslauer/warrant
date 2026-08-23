// The handoff, against a real Firestore.
//
// Everywhere else in this fleet two agents answer independently and in parallel. Here the
// Instructor's answer IS the Foreman's input, and what these tests hold to account is the
// chain: that the six fields one returns arrive as the six fields the other reads, that the
// Foreman's disposition becomes a task somebody is actually raised for, and — most of all —
// that the one thing an agent may not do here, it cannot do.
//
// The fleet is faked. What is under test is the wiring, not whether Gemini can read a sentence
// about a rounded bolt.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/dispose.test.mjs
//
// Requires the Firestore emulator; scripts/smoke.sh starts it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCP_PROJECT = "warrant-rules-test";
process.env.WARRANT_FLEET_ENGINE ??=
  "projects/1/locations/us-central1/reasoningEngines/test";

const { dispose } = await import("../src/server/adjudicate/dispose.ts");
const { stalledSteps } = await import("../src/server/tasks.ts");
const { adminDb } = await import("../src/auth/admin.ts");
const { FleetUnreachable } = await import("../src/server/fleet.ts");

const TENANT = "acme.com";
const db = adminDb();

// A procedure of its own, NOT the one adjudicate.test.mjs seeds. Both files run against the
// same emulator and the same tenant, so sharing a procedure id means whichever writes its
// version document last silently decides the other's steps — which fails as a broken assertion
// somewhere unrelated, in the file that did nothing wrong.
async function seedStall(jobId, { transcript, status = "deferred", disposition, reasonAt } = {}) {
  const job = db.doc(`tenants/${TENANT}/jobs/${jobId}`);
  await job.set({
    id: `${TENANT}/${jobId}`, tenant_id: TENANT, procedure_id: "caliper-torque-service",
    asset_id: "bike-04", strictness: 2, status: "open",
    started_at: "2026-08-18T09:00:00Z", booking: "collected Friday 09:00",
  });
  await job.collection("step_outcomes").doc("s4").set({
    id: `out_${jobId}_s4`, job_id: `${TENANT}/${jobId}`, step_id: "s4",
    status,
    reason_kind: "voice",
    reason_transcript: transcript ??
      "the caliper bolt's rounded off, I can't get any purchase on it at all",
    reason_by: "uid_tech_1",
    reason_at: reasonAt ?? "2026-08-21T11:00:00Z",
    ...(disposition ? { disposition_action: disposition } : {}),
  });
  // A settled step alongside it, so `steps_outstanding` is a count and not a constant.
  await job.collection("step_outcomes").doc("s1").set({
    id: `out_${jobId}_s1`, job_id: `${TENANT}/${jobId}`, step_id: "s1", status: "performed",
  });
  await db.doc(`tenants/${TENANT}/procedure_versions/caliper-torque-service`).set({
    title: "Front brake service", version: 3,
    steps: [
      { id: "s1", title: "Remove wheel", fields: [] },
      { id: "s4", title: "Torque caliper bolts", safety_critical: true,
        explanation: "An untorqued caliper bolt is how a brake leaves the machine.",
        fields: [{ key: "torque", prompt: "Torque to spec" }] },
      { id: "s5", title: "Function check", fields: [] },
    ],
  });
  return { tenantId: TENANT, jobId, stepId: "s4" };
}

const RECOMMENDATION = {
  reason_summary: "the caliper bolt is rounded off and won't take a socket",
  blocker_kind: "seized_or_damaged",
  recommended_action: "Stop and hand off. Do not attempt to drill it out mid-service.",
  proposed_status: "deferred",
  blocking_part: null,
  safety_flag: true,
};

/** A fake fleet that records every case it was handed, so the handoff itself is assertable. */
function fleet(foremanOut, { recommendation = RECOMMENDATION, instructorThrows = false,
                             foremanThrows = false, foremanValid = true } = {}) {
  const seen = {};
  const ask = async (agent, kase) => {
    seen[agent] = kase;
    if (agent === "instructor") {
      if (instructorThrows) throw new FleetUnreachable("no credential", "warrant-web@x");
      return { output: recommendation, valid: true, schemaErrors: [],
               model: "gemini-3.5-flash", latencyMs: 900, usage: { totalTokenCount: 700 } };
    }
    if (foremanThrows) throw new FleetUnreachable("no credential", "warrant-web@x");
    return { output: foremanOut, valid: foremanValid,
             schemaErrors: foremanValid ? [] : ["action: required"],
             model: "gemini-3.5-flash", latencyMs: 1100, usage: { totalTokenCount: 800 } };
  };
  return { ask, seen };
}

const CHASE = {
  status: "deferred", action: "chase", hold_machine: true,
  chase_after: "2026-08-25T09:00:00Z",
  rationale: "The bolt needs an extractor the shop does not hold until Monday.",
};

const outcomeOf = (jobId) =>
  db.doc(`tenants/${TENANT}/jobs/${jobId}/step_outcomes/s4`).get().then((s) => s.data());
const decisionsFor = (jobId) =>
  db.collection(`tenants/${TENANT}/decisions`)
    .where("job_id", "==", `${TENANT}/${jobId}`).get();

describe("dispose", () => {
  test("the Instructor is asked first, and gets the transcript verbatim", async () => {
    const ref = await seedStall("stall_a");
    const f = fleet(CHASE);
    await dispose(ref, { ask: f.ask, db });

    // Untidied. The words somebody chooses when a bolt is round are evidence about the blocker.
    assert.equal(f.seen.instructor.transcript,
                 "the caliper bolt's rounded off, I can't get any purchase on it at all");
    assert.equal(f.seen.instructor.step.title, "Torque caliper bolts");
    assert.equal(f.seen.instructor.procedure.step_count, 3);
    assert.deepEqual(f.seen.instructor.remaining_steps, ["Function check"]);
  });

  test("the Instructor's six fields arrive as the Foreman's six fields", async () => {
    // The whole reason this module exists. `instructor-recommendation` and the block
    // foreman.py renders as "What the Instructor made of it" are the same six keys.
    const ref = await seedStall("stall_b");
    const f = fleet(CHASE);
    await dispose(ref, { ask: f.ask, db });

    assert.deepEqual(f.seen.foreman.recommendation, {
      reason_summary: RECOMMENDATION.reason_summary,
      blocker_kind: "seized_or_damaged",
      recommended_action: RECOMMENDATION.recommended_action,
      proposed_status: "deferred",
      blocking_part: null,
      safety_flag: true,
    });
  });

  test("the Foreman is told what it needs to judge a JOB rather than a step", async () => {
    const ref = await seedStall("stall_c");
    const f = fleet(CHASE);
    await dispose(ref, { ask: f.ask, db });

    const job = f.seen.foreman.job;
    assert.equal(job.steps_outstanding, 2);          // s4 and s5; s1 is performed
    assert.equal(job.booking, "collected Friday 09:00");
    assert.ok(job.days_open >= 1);
    assert.equal(f.seen.foreman.step.safety_critical, true);
  });

  test("BOTH agents are shown the shelf, and it is read once", async () => {
    // instructor.py renders "What is on the shelf right now"; foreman.py renders "Stock and
    // orders". Neither was ever set. The Instructor could not tell "fit the new pad" from
    // "there is no pad", and the Foreman was choosing between CHASE and REORDER blind.
    await db.doc(`tenants/${TENANT}/parts/45105-MEE-006`).set({
      part_number: "45105-MEE-006", description: "Caliper bolt",
      on_hand: 0, floor: 2, on_order: 10, expected_at: "2026-08-28T00:00:00Z",
    });
    const ref = await seedStall("stall_stock");
    const f = fleet(CHASE);
    await dispose(ref, { ask: f.ask, db });

    for (const agent of ["instructor", "foreman"]) {
      const shelf = f.seen[agent].stock;
      assert.ok(Array.isArray(shelf), `${agent} was not shown the shelf`);
      assert.equal(shelf[0].part_number, "45105-MEE-006");
      assert.equal(shelf[0].on_hand, 0);
      assert.equal(shelf[0].on_order, 10);
    }
  });

  test("a shop with no parts collection sends no stock block at all", async () => {
    // Not an empty list. A heading with nothing under it invites the conclusion that the
    // shelf is bare, which is a different claim from having no inventory system.
    const ref = { tenantId: "nostock.example", jobId: "stall_ns", stepId: "s4" };
    const job = db.doc(`tenants/nostock.example/jobs/stall_ns`);
    await job.set({ id: "nostock.example/stall_ns", tenant_id: "nostock.example",
                    procedure_id: "caliper-torque-service", status: "open",
                    started_at: "2026-08-18T09:00:00Z" });
    await job.collection("step_outcomes").doc("s4").set({
      id: "s4", step_id: "s4", status: "deferred", reason_kind: "voice",
      reason_transcript: "bolt is rounded", reason_by: "uid_tech_1",
    });
    await db.doc(`tenants/nostock.example/procedure_versions/caliper-torque-service`).set({
      title: "Front brake service", version: 3,
      steps: [{ id: "s4", title: "Torque caliper bolts", fields: [] }],
    });

    const f = fleet(CHASE);
    await dispose(ref, { ask: f.ask, db });
    assert.equal("stock" in f.seen.instructor, false);
    assert.equal("stock" in f.seen.foreman, false);
  });

  test("a disposition becomes a decision per agent, and a task somebody is raised for",
       async () => {
    const ref = await seedStall("stall_d");
    const out = await dispose(ref, { ask: fleet(CHASE).ask, db });

    assert.equal(out.action, "chase");
    assert.ok(out.taskId, "a disposition that raises nobody is a disposition nobody acts on");

    const agents = (await decisionsFor("stall_d")).docs.map((d) => d.data().agent).sort();
    assert.deepEqual(agents, ["foreman", "instructor"]);

    const outcome = await outcomeOf("stall_d");
    assert.equal(outcome.disposition_action, "chase");
    assert.ok(outcome.disposition_at);
    assert.match(outcome.recommendation_text, /hand off/);
    // A recommendation on the record, never an act.
    assert.match(outcome.hold_reason, /extractor/);

    const task = await db.doc(`tenants/${TENANT}/tasks/${out.taskId}`).get();
    assert.equal(task.data().kind, "chase");
    assert.equal(task.data().created_by_agent ?? task.data().createdByAgent ?? "foreman",
                 "foreman");
  });

  test("reorder drafts a purchase order for somebody to approve", async () => {
    const ref = await seedStall("stall_e");
    const out = await dispose(ref, {
      ask: fleet({ status: "deferred", action: "reorder", hold_machine: false,
                   reorder_part: "45105-MEE-006 caliper bolt",
                   rationale: "The bolt is not reusable and none are on the shelf." }).ask,
      db,
    });
    const task = await db.doc(`tenants/${TENANT}/tasks/${out.taskId}`).get();
    assert.equal(task.data().kind, "approve_order");
    assert.match(task.data().title, /45105-MEE-006/);
  });

  test("A WAIVER IS REFUSED, however the Foreman phrased it", async () => {
    // The one thing this path may not do. A waiver seals a record with a named person's
    // standing behind it; a cron holds nobody's standing. So the model is not obeyed — it is
    // escalated to somebody who can actually waive, and the record says that is what happened.
    const ref = await seedStall("stall_f");
    const out = await dispose(ref, {
      ask: fleet({ status: "waived", action: "revise", hold_machine: false,
                   rationale: "The owner said on the phone it was fine to skip." }).ask,
      db,
    });

    assert.equal(out.status, "deferred", "a waiver must never be written from here");
    assert.equal(out.action, "escalate");
    assert.match(out.refused, /standing/);

    const outcome = await outcomeOf("stall_f");
    assert.notEqual(outcome.status, "waived");
    assert.equal(outcome.disposition_action, "escalate");

    // The refusal is on the record as its own decision, not swallowed.
    const refusals = (await decisionsFor("stall_f")).docs
      .filter((d) => d.data().verdict === "refused_by_gate");
    assert.equal(refusals.length, 1);

    const task = await db.doc(`tenants/${TENANT}/tasks/${out.taskId}`).get();
    assert.equal(task.data().kind, "escalation");
  });

  test("an unreachable Instructor does not stop the chain, and is not invented around",
       async () => {
    const ref = await seedStall("stall_g");
    const f = fleet(CHASE, { instructorThrows: true });
    const out = await dispose(ref, { ask: f.ask, db });

    assert.equal(out.action, "chase");
    // The Foreman is shown the technician's raw sentence and a recommendation of nulls — never
    // a fabricated blocker.
    assert.equal(f.seen.foreman.recommendation.blocker_kind, null);
    assert.match(f.seen.foreman.recommendation.reason_summary, /rounded off/);

    const verdicts = (await decisionsFor("stall_g")).docs.map((d) => d.data().verdict);
    assert.ok(verdicts.includes("engine_unreachable"));
  });

  test("an unreachable Foreman leaves the step stalled so the sweep tries again", async () => {
    const ref = await seedStall("stall_h");
    const out = await dispose(ref, { ask: fleet(CHASE, { foremanThrows: true }).ask, db });

    assert.equal(out.action, null);
    const outcome = await outcomeOf("stall_h");
    assert.ok(!outcome.disposition_action, "a step nobody ruled on must stay in the queue");
    assert.ok((await stalledSteps(200)).some((s) => s.jobId === "stall_h"));
  });

  test("an off-contract Foreman moves nothing", async () => {
    const ref = await seedStall("stall_i");
    const out = await dispose(ref, {
      ask: fleet({ status: "deferred" }, { foremanValid: false }).ask, db,
    });
    assert.equal(out.action, null);
    assert.ok(!(await outcomeOf("stall_i")).disposition_action);
  });
});

describe("stalledSteps", () => {
  test("finds a step a technician gave a reason for and NOBODY set a status on", async () => {
    // The shape LiveSource.declareBlocked actually writes. It sets no status, because choosing
    // between deferred, waived and impossible is the Foreman's call — so a sweep that looked
    // for `status == "deferred"` would never see a single real blocker.
    await seedStall("stall_p", { status: "pending" });
    const found = await stalledSteps(200);
    assert.ok(found.some((s) => s.jobId === "stall_p" && s.stepId === "s4"),
              "a pending step with a reason on it is the stall this sweep exists for");
  });

  test("finds a deferred step nobody has ruled on", async () => {
    await seedStall("stall_q");
    const found = await stalledSteps(200);
    assert.ok(found.some((s) => s.jobId === "stall_q" && s.stepId === "s4"));
  });

  test("a step already disposed of is not raised twice", async () => {
    await seedStall("stall_r", { disposition: "chase" });
    assert.ok(!(await stalledSteps(200)).some((s) => s.jobId === "stall_r"));
  });

  test("a backlog of disposed stalls does not starve a new one", async () => {
    // The bug this pins would have made the Foreman go silent as the product was used, with
    // the sweep reporting a clean run throughout. A disposed step keeps its reason forever, so
    // it keeps matching; a page filtered in code fills up with them and nothing new is seen.
    //
    // THE JOB IDS MATTER. Without an orderBy, a collection-group query comes back in document
    // PATH order, so a backlog only starves what sorts after it. The first version of this
    // test used ids that sorted BEFORE the backlog and passed against the broken
    // implementation — proving nothing. `aaa_` and `zzz_` are what make the page fill up
    // ahead of the new stall, which is the situation a real backlog produces and the one the
    // fix is for.
    for (let i = 0; i < 30; i++) {
      await seedStall(`aaa_starved_${String(i).padStart(2, "0")}`, {
        disposition: "chase",
        reasonAt: `2026-08-01T${String(i % 24).padStart(2, "0")}:00:00Z`,
      });
    }
    await seedStall("zzz_fresh", { reasonAt: "2026-08-22T09:00:00Z" });

    const found = await stalledSteps(25);
    assert.ok(found.some((s) => s.jobId === "zzz_fresh"),
              "a fresh stall behind a backlog of disposed ones must still be found");
  });

  test("a performed step is not a stall", async () => {
    await seedStall("stall_s", { status: "performed" });
    assert.ok(!(await stalledSteps(200)).some((s) => s.jobId === "stall_s"));
  });
});
