// The Gemma screen's authority, and where ordinary code stops it.
//
// The claim under test is the one that makes putting a small model on the adjudication path
// safe at all: the screen can send a capture BACK, and it can do nothing else. Every test
// below is a way for a screen answer to be wrong, and in every one of them the outcome is
// either "ask for another photograph" or "ask the judge" — never "the step advances".
//
// The mirror tests matter as much as the policy ones. `SCREEN_FLOOR` and the actionable defect
// set are stated twice, in `agents/warrant/screen.py` and in `src/server/adjudicate/screen.ts`,
// for the same reason `THRESHOLD` is: the prompt is rendered by the Python and the decision is
// made by the TypeScript. A drift between them is invisible in production — the screen simply
// starts acting on answers it should have passed through — so it is pinned here.
//
//   cd web && node --experimental-strip-types --test scripts/screen.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SCREEN_FLOOR, ACTIONABLE_DEFECTS, actsOnScreen, inspectorVerdictFromScreen, screenSaving,
} from "../src/server/adjudicate/screen.ts";
import { decideOutcome } from "../src/server/adjudicate/outcome.ts";
import { screenCase } from "../src/server/adjudicate/cases.ts";

const unusable = (over = {}) => ({
  output: {
    screen: "UNUSABLE", confidence: 0.95, defect: "too_blurred",
    retake_prompt: "the caliper is out of focus; photograph it again", rationale: "Blurred.",
    ...over,
  },
  valid: true,
});

const FIELD = { key: "pad_photo", kind: "photo" };

describe("actsOnScreen — the authority stops here", () => {
  test("a confident, actionable UNUSABLE is acted on", () => {
    assert.equal(actsOnScreen(unusable()), true);
  });

  test("NEEDS_JUDGEMENT is never acted on, however confident", () => {
    assert.equal(
      actsOnScreen({ output: { screen: "NEEDS_JUDGEMENT", confidence: 1 }, valid: true }),
      false,
    );
  });

  test("an answer that failed its own contract is never acted on", () => {
    // Same rule decideOutcome applies to the Inspector. A malformed answer is a finding,
    // and a finding is not an instruction.
    assert.equal(actsOnScreen({ ...unusable(), valid: false }), false);
  });

  for (const confidence of [0, 0.5, 0.84, SCREEN_FLOOR - 0.0001]) {
    test(`confidence ${confidence} is below the floor, so the judge is asked`, () => {
      assert.equal(actsOnScreen(unusable({ confidence })), false);
    });
  }

  test("at the floor exactly it is acted on", () => {
    assert.equal(actsOnScreen(unusable({ confidence: SCREEN_FLOOR })), true);
  });

  test("NaN confidence is not acted on", () => {
    assert.equal(actsOnScreen(unusable({ confidence: Number.NaN })), false);
  });

  // The important family. A screen naming a defect about the WORK rather than the FRAME is
  // the cheap model refusing a job it was never shown the rule for.
  for (const defect of ["pads_worn_out", "part_number_mismatch", "work_looks_wrong",
                        "", null, undefined, "unknown"]) {
    test(`defect ${JSON.stringify(defect)} is outside the actionable set and is not obeyed`, () => {
      assert.equal(ACTIONABLE_DEFECTS.has(defect), false);
      assert.equal(actsOnScreen(unusable({ defect })), false);
    });
  }

  for (const retake of ["", "   ", null, undefined]) {
    test(`UNUSABLE with retake ${JSON.stringify(retake)} sends nothing back, so is not acted on`, () => {
      assert.equal(actsOnScreen(unusable({ retake_prompt: retake })), false);
    });
  }

  test("the floor is overridable for a test but defaults high", () => {
    assert.equal(SCREEN_FLOOR, 0.85);
    assert.equal(actsOnScreen(unusable({ confidence: 0.6 }), 0.5), true);
  });
});

describe("the mirror of agents/warrant/screen.py", () => {
  test("the floor is the same number the prompt was rendered with", () => {
    // screen.py: SCREEN_FLOOR = 0.85
    assert.equal(SCREEN_FLOOR, 0.85);
  });

  test("the actionable defect set matches the contract enum exactly", () => {
    // Every one of these is a property of the image. None is a claim about the work.
    assert.deepEqual([...ACTIONABLE_DEFECTS].sort(), [
      "nothing_in_frame", "photograph_of_a_screen", "subject_absent",
      "subject_obstructed", "too_blurred", "too_dark",
    ]);
  });
});

describe("the synthesised verdict goes through the real gate", () => {
  test("it is an ADD_FIELD and never anything else", () => {
    const v = inspectorVerdictFromScreen(unusable(), FIELD, 0);
    assert.equal(v.output.verdict, "ADD_FIELD");
    assert.equal(v.output.escalation_question, null);
    assert.equal(v.output.observed, null);
  });

  test("within budget it asks for the retake the screen named", () => {
    const e = decideOutcome({
      inspector: inspectorVerdictFromScreen(unusable(), FIELD, 0),
      skeptic: null, addFieldsUsed: 0, maxAddFields: 2, strictness: 1,
    });
    assert.equal(e.kind, "add_field");
    assert.match(e.prompt, /out of focus/);
    assert.equal(e.fieldKind, "photo");
  });

  test("a screened capture NEVER accepts the field, at any strictness", () => {
    // The load-bearing test in this file. There is no strictness, no budget and no
    // confidence at which this path advances a step.
    for (const strictness of [0, 1, 2, 3]) {
      for (const addFieldsUsed of [0, 1, 2, 5]) {
        const e = decideOutcome({
          inspector: inspectorVerdictFromScreen(unusable({ confidence: 1 }), FIELD, addFieldsUsed),
          skeptic: null, addFieldsUsed, maxAddFields: 2, strictness,
        });
        assert.notEqual(e.kind, "accept_field");
      }
    }
  });

  test("with the budget spent it escalates to a person, exactly as the Inspector would", () => {
    // The screen borrows the Inspector's circuit breaker rather than having its own, so the
    // ADD FIELD pathology cannot be reached through it.
    const e = decideOutcome({
      inspector: inspectorVerdictFromScreen(unusable(), FIELD, 2),
      skeptic: null, addFieldsUsed: 2, maxAddFields: 2, strictness: 1,
    });
    assert.equal(e.kind, "escalate");
    assert.match(e.question, /still insufficient/);
  });

  test("the retake key is new, and unique per attempt", () => {
    const first = inspectorVerdictFromScreen(unusable(), FIELD, 0).output.add_field_key;
    const second = inspectorVerdictFromScreen(unusable(), FIELD, 1).output.add_field_key;
    assert.notEqual(first, FIELD.key);
    assert.notEqual(first, second);
  });

  test("the retake keeps the field's own kind — the screen may not reshape the form", () => {
    const v = inspectorVerdictFromScreen(unusable(), { key: "clip", kind: "video" }, 0);
    assert.equal(v.output.add_field_kind, "video");
  });
});

describe("screenCase withholds what the judge is given", () => {
  const sources = {
    step: { id: "s1", title: "remove wheel", explanation: "so the caliper is reachable" },
    fieldDef: {
      key: "pad_photo", kind: "photo", prompt: "photograph the caliper",
      acceptance_rule: "matches", acceptance_target: "X004X2NVXZ",
      acceptance_min: 26, acceptance_max: 30, acceptance_unit: "Nm",
      acceptance_description: "the label must be legible",
    },
    capture: {}, job: {}, strictness: 3, addFieldsUsed: 0,
    reading: { value: 28.4, unit: "Nm", source: "instrument" },
    answer: null, mediaUris: ["gs://b/c.jpg"], priorMediaUris: [], referenceUris: [],
    asset: null,
  };

  test("the expected value never crosses the wire to the cheap model", () => {
    // The `matches` trap that made inspector.py withhold the target applies with MORE force
    // to a smaller model. inspectorCase correctly passes fieldDef whole; this must not.
    const wire = JSON.stringify(screenCase(sources));
    for (const leaked of ["X004X2NVXZ", "matches", "28.4", "26", "legible"]) {
      assert.equal(wire.includes(leaked), false, `the screen was sent ${leaked}`);
    }
  });

  test("it carries what the screen actually needs, and the frame", () => {
    const c = screenCase(sources);
    assert.equal(c.field.prompt, "photograph the caliper");
    assert.equal(c.field.kind, "photo");
    assert.equal(c.step.title, "remove wheel");
    assert.deepEqual(c.media, ["gs://b/c.jpg"]);
  });

  test("strictness is withheld too — a frame is blurred whatever the procedure demands", () => {
    assert.equal("strictness" in screenCase(sources), false);
  });
});

describe("screenSaving — the saving has to be countable", () => {
  test("it names the defect when the screen fired", () => {
    assert.deepEqual(screenSaving(unusable()), { screened: true, defect: "too_blurred" });
  });

  test("it is null when the judge was asked anyway", () => {
    assert.equal(screenSaving(unusable({ confidence: 0.1 })), null);
  });
});
