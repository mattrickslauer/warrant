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

import { test, before, after, describe } from "node:test";
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

/**
 * The Gemma-position screen, stubbed OFF for every test in this file.
 *
 * `adjudicate` gained a screen in front of the judge (`adjudicate/screen.ts`), and it is a
 * second fleet operation — so a test that stubs `ask` and not `screen` is not hermetic: it
 * reaches the real engine, spends ~900ms on a network round trip and, when that round trip
 * 403s, takes the emulator's timing with it. That is exactly how it announced itself — the two
 * POSITIVE CONTROLS in "prior captures" started reporting an empty prior-media list, which
 * reads as the lookup being broken rather than as the spine having grown a collaborator.
 *
 * NEEDS_JUDGEMENT is the right stub because it is the pass-through: every assertion in this
 * file is about what the JUDGE did, and this is the answer that guarantees the judge is asked.
 * The screen's own behaviour is tested in `screen.test.mjs`, hermetically, with no emulator.
 */
const noScreen = async () => ({
  output: { screen: "NEEDS_JUDGEMENT", confidence: 0.0, defect: "none",
            rationale: "stubbed: the judge is always asked in this file" },
  valid: true, schemaErrors: [], model: "stub-screen", latencyMs: 0,
  usage: { totalTokenCount: 0 }, actsOn: false,
});

const PASS = { verdict: "PASS", confidence: 0.9, rationale: "Pads clearly visible." };
const BELONGS = { belongs: true, confidence: 0.9, mismatch_kind: "none",
                  rationale: "Matches bike-04's fork." };

const outcomeOf = (jobId) =>
  db.doc(`tenants/${TENANT}/jobs/${jobId}/step_outcomes/s3`).get().then((s) => s.data());
const decisionsFor = (jobId) =>
  db.collection(`tenants/${TENANT}/decisions`)
    .where("job_id", "==", `${TENANT}/${jobId}`).get();

describe("prior captures — the Skeptic's memory", () => {
  // A bucket, for the whole block. Without one `mediaUri` has nowhere to point and every
  // assertion below would pass against an empty list — which is exactly the shape of vacuous
  // green this file's own comments warn about elsewhere.
  let previousBucket;
  before(() => {
    previousBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "warrant-test-evidence";
  });
  after(() => {
    if (previousBucket === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    else process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = previousBucket;
  });

  /** Records the case each agent was handed, which is the only way to assert what it SAW. */
  const spy = () => {
    const seen = {};
    return { seen, ask: async (agent, kase) => {
      seen[agent] = kase;
      return { output: agent === "inspector" ? PASS : BELONGS, valid: true, schemaErrors: [],
               model: "gemini-3.5-flash", latencyMs: 10, usage: { totalTokenCount: 100 } };
    } };
  };

  test("earlier captures for the SAME machine are put in front of it", async () => {
    // Reuse is the cheat this catches: the same photograph submitted for a job never done.
    // Until this was wired the list was empty, so the reuse question was being asked of an
    // agent that had been shown nothing to compare against.
    const ref = await seedJob("job_prior_a");
    const older = db.doc(`tenants/${TENANT}/jobs/job_prior_old`);
    await older.set({
      id: `${TENANT}/job_prior_old`, tenant_id: TENANT, asset_id: "bike-04",
      procedure_id: "front-brake-service", status: "sealed",
      started_at: "2026-07-01T09:00:00Z",
    });
    await older.collection("captures").doc("cap_old").set({
      id: "cap_old", field_id: "s3__pad_photo", kind: "photo",
      created_at: "2026-07-01T10:00:00Z", adjudicated: true,
    });

    const s = spy();
    await adjudicate(ref, { screen: noScreen, ask: s.ask, db });
    assert.ok(s.seen.skeptic.prior_media.length >= 1,
              "the Skeptic must be shown what is already on file for this machine");
    assert.ok(s.seen.skeptic.prior_media.some((u) => u.includes("cap_old")));
    // Never the frame being judged.
    assert.ok(!s.seen.skeptic.prior_media.some((u) => u.includes("cap_1")));
  });

  test("a job for a DIFFERENT machine contributes nothing", async () => {
    const ref = await seedJob("job_prior_b");
    const other = db.doc(`tenants/${TENANT}/jobs/job_prior_other`);
    await other.set({
      id: `${TENANT}/job_prior_other`, tenant_id: TENANT, asset_id: "bike-99",
      procedure_id: "front-brake-service", started_at: "2026-07-02T09:00:00Z",
    });
    await other.collection("captures").doc("cap_other").set({
      id: "cap_other", field_id: "s3__pad_photo", kind: "photo",
      created_at: "2026-07-02T10:00:00Z", adjudicated: true,
    });

    const s = spy();
    await adjudicate(ref, { screen: noScreen, ask: s.ask, db });
    assert.ok(!s.seen.skeptic.prior_media.some((u) => u.includes("cap_other")),
              "another machine's history is not this machine's history");
    // Positive control: bike-04 DOES have history by now, so an empty list here would mean
    // the lookup was broken rather than correctly selective.
    assert.ok(s.seen.skeptic.prior_media.length >= 1, "the lookup must not simply be returning nothing");
  });

  test("a typed answer on an earlier job is not offered as a photograph", async () => {
    const ref = await seedJob("job_prior_c");
    const older = db.doc(`tenants/${TENANT}/jobs/job_prior_typed`);
    await older.set({
      id: `${TENANT}/job_prior_typed`, tenant_id: TENANT, asset_id: "bike-04",
      procedure_id: "front-brake-service", started_at: "2026-06-01T09:00:00Z",
    });
    await older.collection("captures").doc("cap_text").set({
      id: "cap_text", field_id: "s3__name", kind: "text", media_ref: "A. Technician",
      created_at: "2026-06-01T10:00:00Z", adjudicated: true,
    });

    const s = spy();
    await adjudicate(ref, { screen: noScreen, ask: s.ask, db });
    assert.ok(!s.seen.skeptic.prior_media.some((u) => u.includes("cap_text")),
              "a signature is not evidence of a machine, and has no object to point at");
    assert.ok(s.seen.skeptic.prior_media.length >= 1, "the lookup must not simply be returning nothing");
  });
});

describe("adjudicate", () => {
  test("writes one decision per agent that answered", async () => {
    const ref = await seedJob("job_a");
    const result = await adjudicate(ref, { screen: noScreen, ask: ask(PASS, BELONGS), db });
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

  test("a typed answer is sent AS the answer, and no media URI is built for it", async () => {
    // The bug this pins reached a phone. `capture.kind` had no `text` member, so a signature
    // went out labelled `scan`; the server built a gs:// URI for it; Gemini was asked for a
    // file nobody had uploaded and returned 404; and the technician was shown "the fleet
    // could not be reached" — a sentence about the network, for a name typed into a box.
    //
    // Both directions are asserted in one test on purpose. Without the photo half, an empty
    // `media` proves nothing: it is also what you get when the bucket is unset, which is the
    // default in this suite.
    const prev = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "warrant-test-evidence";

    const seen = {};
    const watch = async (agent, kase) => {
      if (agent === "inspector") seen[kase.field.key] = kase;
      return {
        output: agent === "inspector" ? PASS : BELONGS,
        valid: true, schemaErrors: [], model: "gemini-3.5-flash",
        latencyMs: 1, usage: { totalTokenCount: 1 },
      };
    };

    try {
      const ref = await seedJob("job_typed", {
        fields: [
          { key: "pad_photo", kind: "photo", prompt: "Photograph the pad edge",
            source: "camera", required_at_strictness: 0, acceptance_rule: "must_show" },
          { key: "knife_stored", kind: "signature", prompt: "Confirm the knife is stored",
            source: "human", required_at_strictness: 0, acceptance_rule: "signed_by",
            acceptance_target: "whoever performed the job" },
        ],
      });

      await db.doc(`tenants/${TENANT}/jobs/job_typed/captures/cap_text`).set({
        id: "cap_text", field_id: "s3__knife_stored", kind: "text",
        // The answer itself. There is no object, and media_ref is where the shape puts it.
        media_ref: "Anthony", capture_mode: "live", capture_surface: "app",
        created_at: "2026-08-21T10:05:00Z", armor_verdict: null, adjudicated: false,
      });

      await adjudicate(ref, { screen: noScreen, ask: watch, db });
      await adjudicate(
        { ...ref, fieldKey: "knife_stored", captureId: "cap_text" },
        { screen: noScreen, ask: watch, db },
      );

      // The photograph still gets one, so the empty list below means something.
      assert.equal(seen.pad_photo.media.length, 1);
      assert.match(seen.pad_photo.media[0], /^gs:\/\//);
      assert.equal(seen.pad_photo.answer, undefined);

      assert.deepEqual(seen.knife_stored.media, [], "a text capture points at no object");
      assert.equal(seen.knife_stored.answer, "Anthony", "and the fleet is told what was said");

      const stuck = (await decisionsFor("job_typed")).docs
        .map((d) => d.data()).filter((d) => d.verdict === "engine_unreachable");
      assert.deepEqual(stuck, [], "nothing should have been sent after a missing file");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
      else process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = prev;
    }
  });

  test("a PASS on the only required field performs the step", async () => {
    const o = await outcomeOf("job_a");
    assert.deepEqual(o.accepted_fields, ["pad_photo"]);
    assert.equal(o.status, "performed");
  });

  test("performing the LAST step seals the job, with no client asking", async () => {
    // The hole this closes. `/api/jobs/seal` had no caller in either client — Android's Api.kt
    // never had a method for it and the web app never fetched it — so the only path to a
    // record was the sweep's net, over a cron that was never scheduled. Every step went green
    // and the record never arrived.
    //
    // Nothing in this test asks for a seal. `adjudicate` does it, because `adjudicate` is what
    // moved the step, and a step's status is decided on the server for both surfaces at once.
    const ref = await seedJob("job_seals");
    await adjudicate(ref, { screen: noScreen, ask: ask(PASS, BELONGS), db });

    const header = (await db.doc(`tenants/${TENANT}/jobs/job_seals`).get()).data();
    assert.equal(header.status, "sealed", "a finished job must not sit open for ever");
    assert.ok(header.sealed_at, "a seal says when");
    // TENANT-SCOPED, and asserted as a literal because Android's `split()` does
    // `require(i > 0)` on this exact string — a bare id there throws on the record screen
    // rather than merely looking the wrong record up.
    assert.equal(header.record_id, `${TENANT}/job_seals`);

    const record = (await db.doc(`tenants/${TENANT}/records/job_seals`).get()).data();
    assert.ok(record, "a job marked sealed with no record behind it is the worst of both");
    assert.equal(record.job_id, `${TENANT}/job_seals`);
    assert.equal(record.machine_released, true, "one performed step releases the machine");
    assert.deepEqual(record.deficiencies, [],
                     "nothing here was explained rather than performed");
  });

  test("a job with evidence still owed does NOT seal", async () => {
    // The other half, and the one that matters more. A trigger on every step settle is only
    // safe if it is silent on all but the last — a record sealed early claims work that has
    // not happened, which is the single thing this product exists not to do.
    const ref = await seedJob("job_not_yet", {
      fields: [
        { key: "pad_photo", kind: "photo", prompt: "Photograph the pad edge",
          source: "camera", required_at_strictness: 0, acceptance_rule: "must_show" },
        { key: "disc_photo", kind: "photo", prompt: "Photograph the disc face",
          source: "camera", required_at_strictness: 0, acceptance_rule: "must_show" },
      ],
    });
    await adjudicate(ref, { screen: noScreen, ask: ask(PASS, BELONGS), db });

    const header = (await db.doc(`tenants/${TENANT}/jobs/job_not_yet`).get()).data();
    assert.equal(header.status, "open", "one photograph of two is not a finished job");
    assert.equal(header.record_id ?? null, null);
    assert.equal((await db.doc(`tenants/${TENANT}/records/job_not_yet`).get()).exists, false,
                 "no record may exist for a job that is not finished");
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
    await adjudicate(ref, { screen: noScreen, ask: ask(PASS, BELONGS), db });
    const o = await outcomeOf("job_b");
    assert.deepEqual(o.accepted_fields, ["pad_photo"]);
    assert.equal(o.status, "pending", "a step with evidence still owed is not performed");
  });

  test("ADD_FIELD appends the field and spends one of the budget", async () => {
    const ref = await seedJob("job_c");
    await adjudicate(ref, { screen: noScreen,
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
    const result = await adjudicate(ref, { screen: noScreen,
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
    const result = await adjudicate(ref, { screen: noScreen,
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
    const result = await adjudicate(ref, { screen: noScreen,
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

  test("an unscreened capture records NOT_SCREENED, never a clean verdict", async () => {
    // The capture in these tests has no media in a reachable bucket, so Model Armor cannot
    // have run. What must never happen is the record claiming it did.
    const cap = await db.doc(`tenants/${TENANT}/jobs/job_a/captures/cap_1`).get();
    assert.equal(cap.data().armor_verdict, "NOT_SCREENED");
    assert.notEqual(cap.data().armor_verdict, "NO_MATCH_FOUND");
  });

  test("an adjudicated capture is marked so the sweep leaves it alone", async () => {
    const cap = await db.doc(`tenants/${TENANT}/jobs/job_a/captures/cap_1`).get();
    assert.equal(cap.data().adjudicated, true);
  });

  test("the Skeptic is never shown the Inspector's conclusion", async () => {
    const ref = await seedJob("job_g");
    let skepticCase = null;
    await adjudicate(ref, { screen: noScreen,
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

  test("a consistent_with field is handed the capture its target names", async () => {
    // The pickup procedure's whole claim is that two photographs prove one lift, and it
    // rests on this. Before it, the Inspector was told "resolves against: s1.object_before"
    // and shown only the new frame, so ESCALATE was the only honest verdict it could reach
    // and every correct run stalled on it.
    let seen = null;
    const watch = async (agent, c) => {
      if (agent === "inspector") seen = c;
      return { output: agent === "inspector" ? PASS : BELONGS, valid: true, schemaErrors: [],
               model: "gemini-3.5-flash", latencyMs: 1, usage: { totalTokenCount: 1 } };
    };

    // A reference is a storage URI, so this test needs a bucket like the typed-answer one.
    const prev = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "warrant-test-evidence";
    try {
      const ref = await seedJob("job_ref", {
        fields: [{ key: "pad_photo", kind: "photo", prompt: "Photograph it held clear",
                   source: "camera", required_at_strictness: 0,
                   acceptance_rule: "consistent_with", acceptance_target: "s1.object_before" }],
      });
      // The earlier capture, on the step the target names.
      await db.doc(`tenants/${TENANT}/jobs/job_ref/captures/cap_0`).set({
        id: "cap_0", field_id: "s1__object_before", kind: "photo", capture_mode: "live",
        capture_surface: "app", created_at: "2026-08-21T09:30:00Z",
        armor_verdict: null, adjudicated: true,
      });

      await adjudicate(ref, { screen: noScreen, ask: watch, db });

      assert.equal(seen.reference.target, "s1.object_before");
      assert.equal(seen.reference.media.length, 1);
      assert.match(seen.reference.media[0], /cap_0\.jpg$/);
      // And the frame under judgement is still the new one, not the reference.
      assert.match(seen.media[0], /cap_1\.jpg$/);
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
      else process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = prev;
    }
  });

  test("no reference block when the field does not resolve against one", async () => {
    let seen = null;
    const watch = async (agent, c) => {
      if (agent === "inspector") seen = c;
      return { output: agent === "inspector" ? PASS : BELONGS, valid: true, schemaErrors: [],
               model: "gemini-3.5-flash", latencyMs: 1, usage: { totalTokenCount: 1 } };
    };
    const ref = await seedJob("job_noref");
    await adjudicate(ref, { screen: noScreen, ask: watch, db });
    assert.ok(!("reference" in seen));
  });

});

describe("undecidedCaptures", () => {
  test("finds a capture older than the window that nobody ruled on", async () => {
    const { undecidedCaptures } = await import("../src/server/tasks.ts");
    await db.doc(`tenants/${TENANT}/jobs/job_a/captures/cap_orphan`).set({
      id: "cap_orphan", field_id: "s3__pad_photo", kind: "photo", capture_mode: "live",
      capture_surface: "app", adjudicated: false,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    const found = await undecidedCaptures(2 * 60 * 1000);
    const orphan = found.find((r) => r.captureId === "cap_orphan");
    assert.ok(orphan, "a capture whose client died must be found by the sweep");
    assert.equal(orphan.tenantId, TENANT);
    assert.equal(orphan.jobId, "job_a");
    assert.equal(orphan.stepId, "s3");
    assert.equal(orphan.fieldKey, "pad_photo");
  });

  test("leaves an already-adjudicated capture alone", async () => {
    const { undecidedCaptures } = await import("../src/server/tasks.ts");
    const found = await undecidedCaptures(2 * 60 * 1000);
    assert.ok(!found.some((r) => r.jobId === "job_a" && r.captureId === "cap_1"),
      "job_a/cap_1 was adjudicated and must not be picked up again");
  });

  test("still finds the capture an unreachable fleet left behind", async () => {
    const { undecidedCaptures } = await import("../src/server/tasks.ts");
    await db.doc(`tenants/${TENANT}/jobs/job_f/captures/cap_1`)
      .set({ created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
            { merge: true });
    const found = await undecidedCaptures(2 * 60 * 1000);
    assert.ok(found.some((r) => r.jobId === "job_f"),
      "the retry path is the whole reason the flag is not set on an unreachable fleet");
  });

  test("a capture too recent to have been abandoned is left alone", async () => {
    const { undecidedCaptures } = await import("../src/server/tasks.ts");
    await db.doc(`tenants/${TENANT}/jobs/job_a/captures/cap_fresh`).set({
      id: "cap_fresh", field_id: "s3__pad_photo", kind: "photo", adjudicated: false,
      created_at: new Date().toISOString(),
    });
    const found = await undecidedCaptures(2 * 60 * 1000);
    assert.ok(!found.some((r) => r.captureId === "cap_fresh"),
      "a live client must be given its chance before the sweep steps in");
  });

  test("an unparseable field_id is skipped rather than guessed at", async () => {
    const { undecidedCaptures } = await import("../src/server/tasks.ts");
    await db.doc(`tenants/${TENANT}/jobs/job_a/captures/cap_broken`).set({
      id: "cap_broken", field_id: "nonsense", kind: "photo", adjudicated: false,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    const found = await undecidedCaptures(2 * 60 * 1000);
    assert.ok(!found.some((r) => r.captureId === "cap_broken"),
      "guessing the field would put a verdict against the wrong evidence");
  });
});
