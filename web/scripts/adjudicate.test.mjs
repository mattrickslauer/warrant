// The spine, against a real Firestore.
//
// The fleet is faked here on purpose. What is under test is that a verdict becomes a
// `decisions` document and the right step transition — not that Gemini can see a brake pad.
// A live fleet call is proven separately, and once end to end in the smoke test.
//
// The assertions that matter most are the negative ones: a malformed verdict must move
// nothing, and an unreachable fleet must leave a trace and stay eligible for the sweep.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/adjudicate.test.mjs
//
// Requires the Firestore emulator; scripts/smoke.sh starts it.

import { test, before, describe } from "node:test";
import assert from "node:assert/strict";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCP_PROJECT = "warrant-rules-test";
process.env.WARRANT_FLEET_ENGINE ??=
  "projects/1/locations/us-central1/reasoningEngines/test";

const { adjudicate } = await import("../src/server/adjudicate/run.ts");
const { adminDb } = await import("../src/auth/admin.ts");
const { FleetUnreachable } = await import("../src/server/fleet.ts");

const TENANT = "acme.com";
const db = adminDb();

/** A fresh job per test, so one test's step transition cannot satisfy another's. */
async function seedJob(jobId, { strictness = 2, fields } = {}) {
  const job = db.doc(`tenants/${TENANT}/jobs/${jobId}`);
  await job.set({
    id: `${TENANT}/${jobId}`, tenant_id: TENANT, procedure_id: "front-brake-service",
    asset_id: "bike-04", strictness, status: "open",
    started_at: "2026-08-21T09:00:00Z",
  });
  await job.collection("captures").doc("cap_1").set({
    id: "cap_1", field_id: "s3__pad_photo", kind: "photo", capture_mode: "live",
    capture_surface: "app", created_at: "2026-08-21T10:00:00Z",
    armor_verdict: null, adjudicated: false,
  });
  await job.collection("step_outcomes").doc("s3").set({
    id: `out_${jobId}_s3`, job_id: `${TENANT}/${jobId}`, step_id: "s3",
    status: "pending", fields: [],
  });
  await db.doc(`tenants/${TENANT}/procedure_versions/front-brake-service`).set({
    steps: [{
      id: "s3", index: 3, title: "Check pad wear",
      explanation: "Worn pads stop the bike less well.", max_add_fields: 2,
      fields: fields ?? [{
        key: "pad_photo", kind: "photo", prompt: "Photograph the pad edge",
        source: "camera", required_at_strictness: 0, acceptance_rule: "must_show",
      }],
    }],
  });
  return { tenantId: TENANT, jobId, stepId: "s3", fieldKey: "pad_photo", captureId: "cap_1" };
}

const ask = (inspectorOut, skepticOut, opts = {}) => async (agent) => ({
  output: agent === "inspector" ? inspectorOut : skepticOut,
  valid: agent === "inspector" ? (opts.inspectorValid ?? true) : true,
  schemaErrors: agent === "inspector" ? (opts.inspectorErrors ?? []) : [],
  model: "gemini-3.5-flash",
  latencyMs: 1234,
  usage: { totalTokenCount: 900 },
});

const PASS = { verdict: "PASS", confidence: 0.9, rationale: "Pads clearly visible." };
const BELONGS = { belongs: true, confidence: 0.9, mismatch_kind: "none",
                  rationale: "Matches bike-04's fork." };

const outcomeOf = (jobId) =>
  db.doc(`tenants/${TENANT}/jobs/${jobId}/step_outcomes/s3`).get().then((s) => s.data());
const decisionsFor = (jobId) =>
  db.collection(`tenants/${TENANT}/decisions`)
    .where("job_id", "==", `${TENANT}/${jobId}`).get();

describe("adjudicate", () => {
  test("writes one decision per agent that answered", async () => {
    const ref = await seedJob("job_a");
    const result = await adjudicate(ref, { ask: ask(PASS, BELONGS), db });
    assert.equal(result.decisionIds.length, 2);
    const agents = (await decisionsFor("job_a")).docs.map((d) => d.data().agent).sort();
    assert.deepEqual(agents, ["inspector", "skeptic"]);
  });

  test("a decision stamps the model, the cost and a rationale", async () => {
    const snap = await decisionsFor("job_a");
    const d = snap.docs.find((x) => x.data().agent === "inspector").data();
    assert.equal(d.model, "gemini-3.5-flash");
    assert.equal(d.verdict, "PASS");
    assert.ok(typeof d.cost_usd === "number" && d.cost_usd > 0);
    assert.ok(d.rationale.length > 0);
    assert.ok(d.agent_version);
  });

  test("a PASS on the only required field performs the step", async () => {
    const o = await outcomeOf("job_a");
    assert.deepEqual(o.accepted_fields, ["pad_photo"]);
    assert.equal(o.status, "performed");
  });

  test("one field passing does NOT perform a two-field step", async () => {
    // The failure this guards is a seven-field step sealing on its first photograph.
    const ref = await seedJob("job_b", {
      fields: [
        { key: "pad_photo", kind: "photo", prompt: "Photograph the pad edge",
          source: "camera", required_at_strictness: 0, acceptance_rule: "must_show" },
        { key: "disc_photo", kind: "photo", prompt: "Photograph the disc face",
          source: "camera", required_at_strictness: 0, acceptance_rule: "must_show" },
      ],
    });
    await adjudicate(ref, { ask: ask(PASS, BELONGS), db });
    const o = await outcomeOf("job_b");
    assert.deepEqual(o.accepted_fields, ["pad_photo"]);
    assert.equal(o.status, "pending", "a step with evidence still owed is not performed");
  });

  test("ADD_FIELD appends the field and spends one of the budget", async () => {
    const ref = await seedJob("job_c");
    await adjudicate(ref, {
      ask: ask({ verdict: "ADD_FIELD", confidence: 0.4, rationale: "Edge is out of frame.",
                 add_field_key: "pad_edge_retry", add_field_kind: "photo",
                 add_field_prompt: "Photograph the pad edge square on" }, BELONGS),
      db,
    });
    const o = await outcomeOf("job_c");
    assert.equal(o.add_fields_used, 1);
    assert.equal(o.added_fields.length, 1);
    assert.equal(o.added_fields[0].key, "pad_edge_retry");
    assert.equal(o.status, "pending");
  });

  test("a Skeptic dissent keeps the step pending and records the question", async () => {
    const ref = await seedJob("job_d");
    const result = await adjudicate(ref, {
      ask: ask(PASS, { belongs: false, confidence: 0.8, mismatch_kind: "asset",
                       rationale: "The fork is the wrong colour for bike-04." }),
      db,
    });
    assert.equal(result.effect.kind, "escalate");
    const o = await outcomeOf("job_d");
    assert.equal(o.status, "pending", "an escalation is a decision awaited, not a status");
    assert.match(o.escalation_question, /asset/);
    const verdicts = (await decisionsFor("job_d")).docs.map((d) => d.data().verdict).sort();
    assert.deepEqual(verdicts, ["DISSENT", "PASS"]);
  });

  test("a schema-invalid verdict is written and moves no step", async () => {
    const ref = await seedJob("job_e");
    const result = await adjudicate(ref, {
      ask: ask({ verdict: "PASS" }, BELONGS,
               { inspectorValid: false,
                 inspectorErrors: ["confidence: required by the contract and absent"] }),
      db,
    });
    assert.equal(result.effect.kind, "hold");
    const o = await outcomeOf("job_e");
    assert.equal(o.status, "pending");
    assert.ok(!o.accepted_fields || o.accepted_fields.length === 0);
    assert.match(o.hold_reason, /confidence/);
    const d = (await decisionsFor("job_e")).docs.map((x) => x.data());
    assert.ok(d.length >= 1, "a malformed answer is still recorded — it is a finding");
  });

  test("an unreachable fleet is recorded, and the capture stays eligible for the sweep", async () => {
    const ref = await seedJob("job_f");
    const result = await adjudicate(ref, {
      ask: async () => {
        throw new FleetUnreachable("fleet returned 403: denied",
                                   "warrant-web@warrent-505918.iam.gserviceaccount.com");
      },
      db,
    });
    assert.equal(result.effect.kind, "hold");
    const d = (await decisionsFor("job_f")).docs.map((x) => x.data());
    assert.equal(d.length, 1);
    assert.equal(d[0].verdict, "engine_unreachable");
    assert.match(d[0].rationale, /warrant-web/);

    const cap = await db.doc(`tenants/${TENANT}/jobs/job_f/captures/cap_1`).get();
    assert.notEqual(cap.data().adjudicated, true,
      "an unreachable fleet must leave the capture for the sweep to retry");
  });

  test("an adjudicated capture is marked so the sweep leaves it alone", async () => {
    const cap = await db.doc(`tenants/${TENANT}/jobs/job_a/captures/cap_1`).get();
    assert.equal(cap.data().adjudicated, true);
  });

  test("the Skeptic is never shown the Inspector's conclusion", async () => {
    const ref = await seedJob("job_g");
    let skepticCase = null;
    await adjudicate(ref, {
      ask: async (agent, kase) => {
        if (agent === "skeptic") skepticCase = kase;
        return { output: agent === "inspector" ? PASS : BELONGS, valid: true,
                 schemaErrors: [], model: "m", latencyMs: 1, usage: null };
      },
      db,
    });
    const text = JSON.stringify(skepticCase);
    assert.ok(!/PASS|verdict|acceptance_rule/.test(text), text);
  });
});
