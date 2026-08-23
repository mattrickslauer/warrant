// What the compiler refuses, and why each refusal exists.
//
// The Scoper is instructed never to invent a tolerance. This file is where that stops being an
// instruction and becomes something that fails. Every case below is a draft that would LOOK
// finished on the review screen and would decide nothing at all once a job ran against it —
// which is worse than an obviously broken procedure, because it files as a pass.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//       --import ./scripts/ts-resolve.mjs --test scripts/compile.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { faults, tierFor } from "../src/server/compile.ts";

/** A draft with nothing wrong with it. Each test below breaks exactly one thing. */
const good = () => ({
  key: "roll-and-ship-foil",
  title: "Roll and ship a foil order",
  strictness: 2,
  minimum_tier: "instrumented",
  disqualifiers: ["Wrong alloy grade in the box"],
  releases: ["The order may ship"],
  steps: [
    {
      title: "Confirm the grade",
      explanation: "321 and 309 look identical and a customer heat-treating at 2200F with 321 loses the workpiece.",
      max_add_fields: 2,
      fields: [
        {
          key: "grade_label", kind: "photo", prompt: "Photograph the coil label",
          source: "camera", required_at_strictness: 0,
          acceptance_rule: "must_show", acceptance_description: "the alloy grade printed on the coil label",
          guidance: "Get the whole label in frame, square on, close enough to read.",
        },
        {
          key: "thickness", kind: "measurement", prompt: "Measure the foil thickness",
          source: "instrument", required_at_strictness: 1,
          acceptance_rule: "within", acceptance_min: 0.0018, acceptance_max: 0.0022,
          acceptance_unit: "in",
          guidance: "Measure away from the edge, where the roll has not been handled.",
        },
      ],
    },
  ],
});

/** Reach into the first step's second field — the measurement — and break it. */
function withField(patch) {
  const d = good();
  d.steps[0].fields[1] = { ...d.steps[0].fields[1], ...patch };
  return d;
}

describe("faults", () => {
  test("a complete draft has nothing wrong with it", () => {
    assert.deepEqual(faults(good()), []);
  });

  test("`within` with no figure is refused — nobody stated a bound", () => {
    const f = faults(withField({ acceptance_min: null, acceptance_max: null }));
    assert.equal(f.length, 1);
    assert.match(f[0], /nobody stated a figure/);
  });

  test("`within` with no unit is refused — a number without a unit is not a measurement", () => {
    const f = faults(withField({ acceptance_unit: "  " }));
    assert.equal(f.length, 1);
    assert.match(f[0], /no unit/);
  });

  // `must_show` with no description and `signed_by` with no target are ACCEPTED, and that is
  // a correction rather than a gap. Both were refused in the first version of this file; 64
  // drafts the Scoper had actually compiled then showed 41 of them being refused for it. The
  // contract puts the rule in `guidance` ("the same rule the Inspector applies after it") and
  // inspector.py:41-48 shows it to the model on every judgement, so those fields decide fine.
  test("`must_show` carrying its rule in guidance is accepted", () => {
    const d = good();
    d.steps[0].fields[0].acceptance_description = null;
    assert.deepEqual(faults(d), []);
  });

  test("a signature with no stated target is accepted — the member who signed is the target", () => {
    const f = faults(withField({
      kind: "signature", source: "human", acceptance_rule: "signed_by",
      acceptance_target: null, acceptance_min: null, acceptance_max: null, acceptance_unit: null,
    }));
    assert.deepEqual(f, []);
  });

  test("`per_spec` without somewhere to read the figure is refused", () => {
    const f = faults(withField({ acceptance_rule: "per_spec", acceptance_target: null }));
    assert.match(f.join(" "), /does not say where the figure is printed/);
  });

  test("`matches` without a target is refused", () => {
    const f = faults(withField({ acceptance_rule: "matches", acceptance_target: "" }));
    assert.match(f.join(" "), /does not say what it resolves against/);
  });

  test("a choice with one answer cannot record the job going wrong", () => {
    const f = faults(withField({
      kind: "choice", source: "human", acceptance_rule: "matches",
      acceptance_target: "the order", choices: ["Done"],
    }));
    assert.match(f.join(" "), /cannot record the job going wrong/);
  });

  test("a step with no reason to exist is refused", () => {
    const d = good();
    d.steps[0].explanation = "";
    assert.match(faults(d).join(" "), /does not say why it exists/);
  });

  test("a step that captures nothing proves nothing", () => {
    const d = good();
    d.steps[0].fields = [];
    assert.match(faults(d).join(" "), /captures nothing/);
  });

  test("a procedure with no steps cannot be performed", () => {
    const d = good();
    d.steps = [];
    assert.match(faults(d).join(" "), /no steps/);
  });

  test("an unusable key is named rather than silently slugged", () => {
    const d = good();
    d.key = "Roll And Ship";
    assert.match(faults(d).join(" "), /is not a usable key/);
  });

  test("every fault is reported at once, not one per attempt", () => {
    const d = good();
    d.title = "";
    d.steps[0].explanation = "";
    d.steps[0].fields[1].acceptance_unit = null;
    assert.equal(faults(d).length, 3);
  });
});

describe("tierFor", () => {
  test("one instrument field puts the whole procedure out of a browser's reach", () => {
    assert.equal(tierFor(good().steps), "instrumented");
  });

  test("a scan needs an attested surface even with no instrument", () => {
    assert.equal(tierFor([{ fields: [{ kind: "scan", source: "camera" }] }]), "attested");
  });

  test("a location needs an attested surface — place the checked party could fake is not evidence of place", () => {
    assert.equal(tierFor([{ fields: [{ kind: "location", source: "human" }] }]), "attested");
  });

  test("photographs and human answers alone stay open", () => {
    assert.equal(
      tierFor([{ fields: [{ kind: "photo", source: "camera" }, { kind: "text", source: "human" }] }]),
      "open",
    );
  });

  test("instrumented wins over attested when both are present", () => {
    assert.equal(
      tierFor([{ fields: [{ kind: "scan", source: "camera" }, { kind: "measurement", source: "instrument" }] }]),
      "instrumented",
    );
  });
});
