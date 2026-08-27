// What is waiting on a person, and where a reopened job should land.
//
// The rule has a Kotlin twin — android/…/data/Attention.kt — and this file exists because the
// browser had NO version of it. `added_fields`, `escalation_question` and `hold_reason` are
// written by applyEffect() in server/adjudicate/run.ts and are the only place an agent's ask
// exists; nothing on the web read any of them. So an Inspector appending a field, or escalating
// a question to a person, reached the browser and stopped there: the step went back to pending
// and the screen said nothing about why.
//
// Every test below has a positive control — an implementation that always returned [] would
// fail, and so would one that returned everything.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/attention.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { openItems, needsResponse, outstandingCount, firstOwed } from "../src/data/attention.ts";

const def = (key, prompt) => ({
  key,
  kind: "photo",
  prompt,
  source: "camera",
  required_at_strictness: 0,
  acceptance_rule: "must_show",
  guidance: "What good looks like",
});

const outcome = (stepId, over = {}) => ({
  id: `out_${stepId}`,
  job_id: "job_one",
  step_id: stepId,
  status: "pending",
  fields: [],
  ...over,
});

const job = (...steps) => ({
  id: "job_one",
  tenant_id: "anon",
  procedure_id: "proc_brakes",
  procedure_version: 1,
  status: "open",
  strictness: 0,
  tier: "open",
  steps,
});

describe("openItems — the three ways a job waits on a person", () => {
  test("a job nobody has been asked anything about waits on nobody", () => {
    assert.deepEqual(openItems(job(outcome("s1"), outcome("s2"))), []);
    assert.equal(needsResponse(job(outcome("s1"))), false);
  });

  test("an appended field is an ask, and it carries the agent's own prompt", () => {
    const items = openItems(job(
      outcome("s1", { added_fields: [def("pad_closeup", "Photograph the pad from the side")] }),
    ));
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "evidence");
    assert.equal(items[0].ask, "Photograph the pad from the side");
    assert.equal(items[0].field.key, "pad_closeup");
    assert.equal(items[0].outstanding, true);
  });

  test("an appended field that has been answered has stopped waiting", () => {
    const answered = openItems(job(outcome("s1", {
      added_fields: [def("pad_closeup", "Photograph the pad from the side")],
      fields: [{ id: "f1", step_id: "s1", key: "pad_closeup", kind: "photo" }],
    })));
    assert.deepEqual(answered, []);

    // The fleet's own word for it counts too — a capture accepted but not yet mirrored back
    // into `fields` must not read as still outstanding.
    const accepted = openItems(job(outcome("s1", {
      added_fields: [def("pad_closeup", "Photograph the pad from the side")],
      accepted_fields: ["pad_closeup"],
    })));
    assert.deepEqual(accepted, []);
  });

  test("an escalation is a question, and it keeps both halves once answered", () => {
    const unanswered = openItems(job(
      outcome("s1", { escalation_question: "Is this the same disc as in step two?" }),
    ));
    assert.equal(unanswered[0].kind, "question");
    assert.equal(unanswered[0].outstanding, true);
    assert.equal(outstandingCount(job(
      outcome("s1", { escalation_question: "Is this the same disc as in step two?" }),
    )), 1);

    const answered = openItems(job(outcome("s1", {
      escalation_question: "Is this the same disc as in step two?",
      escalation_answer: "No — the second is the nearside.",
      escalation_answered_by: "a technician",
    })));
    assert.equal(answered.length, 1, "it stays on screen: the fleet has still to rule");
    assert.equal(answered[0].outstanding, false);
    assert.equal(answered[0].answer, "No — the second is the nearside.");
    assert.equal(answered[0].ask, "Is this the same disc as in step two?");
  });

  test("a hold is stated, and always outstanding — nobody has answered a hold", () => {
    const items = openItems(job(outcome("s1", { hold_reason: "the Inspector's answer was malformed" })));
    assert.equal(items[0].kind, "hold");
    assert.equal(items[0].outstanding, true);
  });

  test("one step can be waiting on more than one thing at once", () => {
    const items = openItems(job(outcome("s1", {
      escalation_question: "Which disc is this?",
      hold_reason: "the fleet could not be reached",
      added_fields: [def("wider", "One wider shot, please")],
    })));
    assert.deepEqual(items.map((i) => i.kind), ["question", "hold", "evidence"]);
  });

  test("a step that has REACHED AN OUTCOME is waiting on nobody", () => {
    // performed, and the three ways a step ends without being performed. Every one is written
    // by the fleet, and an outcome is not a question — listing it would send somebody back to
    // a decision that has already been made.
    for (const status of ["performed", "deferred", "waived", "impossible"]) {
      const items = openItems(job(outcome("s1", {
        status,
        escalation_question: "Which disc is this?",
        added_fields: [def("wider", "One wider shot, please")],
      })));
      assert.deepEqual(items, [], `${status} should be waiting on nobody`);
    }
    // The positive control for the loop above.
    assert.equal(openItems(job(outcome("s1", {
      status: "pending",
      escalation_question: "Which disc is this?",
    }))).length, 1);
  });

  test("items come back in step order", () => {
    const items = openItems(job(
      outcome("s1", { hold_reason: "first" }),
      outcome("s2", { hold_reason: "second" }),
    ));
    assert.deepEqual(items.map((i) => i.stepId), ["s1", "s2"]);
  });

  test("a job with no step outcomes at all does not throw", () => {
    assert.deepEqual(openItems({ ...job(), steps: undefined }), []);
  });
});

describe("firstOwed — where a reopened job lands", () => {
  const steps = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];

  test("the first step that still owes something, not step one", () => {
    const at = firstOwed(job(
      outcome("s1", { status: "performed" }),
      outcome("s2", { status: "performed" }),
      outcome("s3", { status: "pending" }),
    ), steps);
    assert.equal(at, 2);
  });

  test("a step the fleet closed is not owed, however it closed", () => {
    for (const status of ["performed", "deferred", "waived", "impossible"]) {
      const at = firstOwed(job(outcome("s1", { status }), outcome("s2", { status: "pending" })), steps);
      assert.equal(at, 1, `${status} is not owed`);
    }
  });

  test("nothing owed lands on step one rather than off the end", () => {
    const at = firstOwed(job(
      outcome("s1", { status: "performed" }),
      outcome("s2", { status: "performed" }),
      outcome("s3", { status: "performed" }),
    ), steps);
    assert.equal(at, 0);
  });

  test("a job with no outcomes yet starts at the top", () => {
    assert.equal(firstOwed(job(), steps), 0);
  });
});
