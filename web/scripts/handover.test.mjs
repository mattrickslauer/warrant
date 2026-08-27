// Where a job stands when the hands stop, and what the evidence carousel puts under each verdict.
//
// The twin is android/…/ui/job/Handover.kt and its `HandoverTest`. Two claims live here and
// both are the kind a screenshot cannot catch:
//
//   * a heading. "Sealed" over a job with a step still owed is a lie, and so is "Everything
//     this procedure asked for is captured" over one where a step was explained rather than
//     performed.
//   * an ATTRIBUTION. The carousel puts photographs and verdicts on the same page, so a frame
//     that carried the wrong step's decisions would show a technician a rejection of one
//     capture printed underneath a different one — which reads as the fleet being wrong about
//     something it never looked at.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/handover.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  handoverStateFor, handoverHeadline, handoverFrames, verificationProgress,
} from "../src/data/handover.ts";

const step = (id, index, over = {}) => ({
  id,
  index,
  title: `Step ${index}`,
  condition: null,
  explanation: "why",
  max_add_fields: 2,
  fields: [{
    key: "photo",
    kind: "photo",
    prompt: "Photograph it",
    source: "camera",
    required_at_strictness: 0,
    acceptance_rule: "must_show",
    guidance: "What good looks like",
  }],
  ...over,
});

const procedure = (...steps) => ({
  id: "proc_x",
  tenant_id: "anon",
  key: "x",
  title: "X",
  version: 1,
  strictness: 1,
  minimum_tier: "open",
  disqualifiers: [],
  releases: [],
  created_at: "2026-08-27T00:00:00Z",
  steps,
});

const field = (key, over = {}) => ({
  id: `fld_${key}`, step_id: "s1", key, kind: "photo", media_ref: `cap_${key}`, ...over,
});

const outcome = (stepId, over = {}) => ({
  id: `out_${stepId}`, job_id: "job_one", step_id: stepId, status: "pending", fields: [], ...over,
});

const job = (outcomes, over = {}) => ({
  id: "job_one",
  tenant_id: "anon",
  procedure_id: "proc_x",
  procedure_version: 1,
  status: "open",
  strictness: 1,
  tier: "open",
  started_at: "2026-08-27T00:00:00Z",
  steps: outcomes,
  ...over,
});

const decision = (stepId, over = {}) => ({
  id: `dec_${stepId}_${over.verdict ?? "PASS"}`,
  job_id: "job_one",
  step_id: stepId,
  agent: "inspector",
  agent_version: "1",
  verdict: "PASS",
  rationale: "looks right",
  at: "2026-08-27T00:01:00Z",
  ...over,
});

describe("which of the three true things is true", () => {
  test("a step still owed outranks a record that has somehow arrived", () => {
    assert.equal(handoverStateFor(1, "rec_1"), "outstanding");
  });

  test("everything captured and no record yet is waiting, not done", () => {
    assert.equal(handoverStateFor(0, null), "waiting");
  });

  test("a record id is the only thing that may be called sealed", () => {
    assert.equal(handoverStateFor(0, "rec_1"), "sealed");
  });

  test("a job that will seal deficient does not read as one that will not", () => {
    const clean = handoverHeadline("waiting", 0, 0).detail;
    const deficient = handoverHeadline("waiting", 0, 2).detail;
    assert.notEqual(clean, deficient);
    assert.match(deficient, /2 steps/);
    assert.match(deficient, /deficient/);
  });

  test("the outstanding sentence agrees with itself about number", () => {
    assert.match(handoverHeadline("outstanding", 1).detail, /1 step still has/);
    assert.match(handoverHeadline("outstanding", 3).detail, /3 steps still have/);
  });
});

describe("the evidence carousel", () => {
  test("one frame per capture, in the order the work happened", () => {
    const p = procedure(step("s1", 1), step("s2", 2));
    const j = job([
      outcome("s1", { status: "performed", fields: [field("photo")] }),
      outcome("s2", { status: "performed", fields: [field("photo"), field("photo_again")] }),
    ]);
    const frames = handoverFrames(j, p, []);
    assert.deepEqual(frames.map((f) => f.id), ["s1:photo", "s2:photo", "s2:photo_again"]);
    assert.deepEqual(frames.map((f) => f.captureId), ["cap_photo", "cap_photo", "cap_photo_again"]);
  });

  test("a step that produced nothing is still a page, carrying its reason", () => {
    // The positive control for the whole placeholder branch: a job where step 2 was explained
    // must not look, on the last screen anybody reads, like a job with one step.
    const p = procedure(step("s1", 1), step("s2", 2));
    const j = job([
      outcome("s1", { status: "performed", fields: [field("photo")] }),
      outcome("s2", { status: "deferred", reason_transcript: "the tool is in the other van" }),
    ]);
    const frames = handoverFrames(j, p, []);
    assert.equal(frames.length, 2);
    assert.equal(frames[1].captureId, null);
    assert.equal(frames[1].fieldKey, null);
    assert.equal(frames[1].reason, "the tool is in the other van");
    assert.equal(frames[1].status, "deferred");
  });

  test("a verdict lands on the step it was about and on no other", () => {
    const p = procedure(step("s1", 1), step("s2", 2));
    const j = job([
      outcome("s1", { status: "performed", fields: [field("photo")] }),
      outcome("s2", { status: "performed", fields: [field("photo")] }),
    ]);
    const frames = handoverFrames(j, p, [
      decision("s1", { verdict: "PASS" }),
      decision("s2", { verdict: "ADD_FIELD" }),
    ]);
    assert.deepEqual(frames[0].decisions.map((d) => d.verdict), ["PASS"]);
    assert.deepEqual(frames[1].decisions.map((d) => d.verdict), ["ADD_FIELD"]);
  });

  test("a job-level decision is attached to no photograph at all", () => {
    // The Foreman's disposition arrives with step_id null. Hanging it on the first frame would
    // print a ruling about the whole job under one capture, as though it were about that one.
    const p = procedure(step("s1", 1));
    const j = job([outcome("s1", { status: "performed", fields: [field("photo")] })]);
    const frames = handoverFrames(j, p, [decision(null, { agent: "foreman", verdict: "DEFER" })]);
    assert.deepEqual(frames[0].decisions, []);
  });

  test("both captures of one step carry that step's verdicts", () => {
    // Decisions are scoped to a step and nothing finer, so the two frames of a grown step
    // share them. Splitting them by guessing from the rationale text would be worse.
    const p = procedure(step("s1", 1));
    const j = job([outcome("s1", {
      status: "performed", fields: [field("photo"), field("photo_reframed")],
    })]);
    const frames = handoverFrames(j, p, [decision("s1"), decision("s1", { verdict: "ADD_FIELD" })]);
    assert.equal(frames.length, 2);
    assert.equal(frames[0].decisions.length, 2);
    assert.equal(frames[1].decisions.length, 2);
  });

  test("what an agent is still asking for rides on the frame it is about", () => {
    const p = procedure(step("s1", 1), step("s2", 2));
    const j = job([
      outcome("s1", { status: "performed", fields: [field("photo")] }),
      outcome("s2", {
        status: "pending",
        fields: [field("photo")],
        added_fields: [{
          key: "photo_again", kind: "photo", prompt: "Again, wider",
          source: "camera", required_at_strictness: 0,
          acceptance_rule: "must_show", guidance: "step back",
        }],
      }),
    ]);
    const frames = handoverFrames(j, p, []);
    assert.deepEqual(frames[0].issues, []);
    assert.equal(frames[1].issues.length, 1);
    assert.equal(frames[1].issues[0].kind, "evidence");
    assert.match(frames[1].issues[0].ask, /wider/);
  });

  test("a signature is a frame with a value and nothing to fetch", () => {
    // Its media_ref is a NAME. Handing that to storage would build a path out of a person.
    const p = procedure(step("s1", 1));
    const j = job([outcome("s1", {
      status: "performed",
      fields: [field("who", { kind: "signature", media_ref: "Ada", value_text: "Ada" })],
    })]);
    const frames = handoverFrames(j, p, []);
    assert.equal(frames[0].captureId, null);
    assert.equal(frames[0].value, "Ada");
  });

  test("a measurement reads as its number and its unit", () => {
    const p = procedure(step("s1", 1));
    const j = job([outcome("s1", {
      status: "performed",
      fields: [field("torque", { kind: "measurement", media_ref: null, value_number: 7.4, unit: "Nm" })],
    })]);
    assert.equal(handoverFrames(j, p, [])[0].value, "7.4 Nm");
  });

  test("provenance is rendered, never guessed — absent until the Seal stamps it", () => {
    const p = procedure(step("s1", 1));
    const unsealed = job([outcome("s1", { fields: [field("photo")] })]);
    assert.equal(handoverFrames(unsealed, p, [])[0].provenance, null);
    const sealed = job([outcome("s1", {
      fields: [field("photo", { provenance_class: "inferred" })],
    })]);
    assert.equal(handoverFrames(sealed, p, [])[0].provenance, "inferred");
  });
});

describe("how far the fleet has got", () => {
  test("a step with any outcome counts as ruled, not only one that passed", () => {
    // A progress line that counted passes alone would stall for ever on a job that is going
    // to seal deficient — which is precisely the job somebody watches this line on.
    const p = procedure(step("s1", 1), step("s2", 2));
    const j = job([
      outcome("s1", { status: "performed" }),
      outcome("s2", { status: "deferred" }),
    ]);
    assert.deepEqual(verificationProgress(j, p), { ruled: 2, total: 2, settled: true });
  });

  test("a pending step is not ruled on", () => {
    const p = procedure(step("s1", 1), step("s2", 2));
    const j = job([outcome("s1", { status: "performed" }), outcome("s2")]);
    assert.deepEqual(verificationProgress(j, p), { ruled: 1, total: 2, settled: false });
  });

  test("an optional step is not counted, for the reason it cannot hold the seal", () => {
    const p = procedure(step("s1", 1), step("s2", 2, { required_at_strictness: 4 }));
    const j = job([outcome("s1", { status: "performed" }), outcome("s2")]);
    assert.deepEqual(verificationProgress(j, p), { ruled: 1, total: 1, settled: true });
  });
});
