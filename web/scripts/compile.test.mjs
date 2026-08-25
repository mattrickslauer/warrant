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
import { faults, prune, tierFor } from "../src/server/compile.ts";

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

describe("prune", () => {
  // The failure this whole mechanism answers.
  //
  // `proc_segway_xyber_brake_pad_replacement` shipped a `choice` field with an empty
  // `choices` array. On the step page that is a question with nothing to tap, and the bar —
  // which is the only way forward on a step — had nothing to offer. The run stopped on that
  // step, every step behind it became unreachable, and a refusal at publish would not have
  // helped the technician standing there: the version was already frozen, and frozen versions
  // do not change.
  //
  // So the unperformable part goes and the rest of the procedure runs, with a list of what
  // went. These tests pin both halves — that it is removed, and that the removal is said.
  const choiceField = (choices) => ({
    key: "test_ride_performance", kind: "choice", prompt: "How do the brakes perform?",
    source: "human", required_at_strictness: 0,
    acceptance_rule: "matches", acceptance_target: "the shop's road test",
    choices,
    guidance: "Ride it at walking pace and stop hard once.",
  });

  test("a complete draft is returned untouched with nothing dropped", () => {
    const { draft, dropped } = prune(good());
    assert.deepEqual(dropped, []);
    assert.equal(draft.steps[0].fields.length, 2);
  });

  test("a choice with no answers is removed rather than refused", () => {
    const d = good();
    d.steps[0].fields.push(choiceField([]));

    const { draft, dropped } = prune(d);
    assert.equal(draft.steps[0].fields.length, 2, "the two good fields survive");
    assert.equal(dropped.length, 1);
    assert.match(dropped[0], /test_ride_performance/);
    assert.match(dropped[0], /could never have been satisfied/);

    // And the point of the whole exercise: what is left publishes.
    assert.deepEqual(faults(draft), []);
  });

  test("a choice with one answer goes the same way — it cannot record a failure", () => {
    const d = good();
    d.steps[0].fields.push(choiceField(["Fine"]));
    const { draft, dropped } = prune(d);
    assert.equal(draft.steps[0].fields.length, 2);
    assert.match(dropped.join(" "), /cannot record the job going wrong/);
  });

  test("a choice that offers a real answer and a real failure is kept", () => {
    const d = good();
    d.steps[0].fields.push(choiceField(["Responsive and quiet", "Grabs", "Squeals"]));
    const { draft, dropped } = prune(d);
    assert.deepEqual(dropped, []);
    assert.equal(draft.steps[0].fields.length, 3);
  });

  test("a numeric band on a photograph is removed — nothing can read a number off one", () => {
    // Not hypothetical either: v3 of the same Segway procedure shipped `caliper_torque` as a
    // photo judged `within` 7.5 Nm, and no run of it was ever able to satisfy the step.
    const d = good();
    d.steps[0].fields[0] = {
      ...d.steps[0].fields[0],
      acceptance_rule: "within", acceptance_min: 7, acceptance_max: 8, acceptance_unit: "Nm",
    };
    const { draft, dropped } = prune(d);
    assert.equal(draft.steps[0].fields.length, 1);
    assert.match(dropped.join(" "), /nothing can read a number off one/);
  });

  test("a backwards band is removed — no reading is above the floor and below the ceiling", () => {
    const { draft, dropped } = prune(withField({ acceptance_min: 0.9, acceptance_max: 0.1 }));
    assert.equal(draft.steps[0].fields.length, 1);
    assert.match(dropped.join(" "), /backwards/);
  });

  test("a band of exactly one figure is removed — a real tool never lands on it", () => {
    const { dropped } = prune(withField({ acceptance_min: 0.002, acceptance_max: 0.002 }));
    assert.match(dropped.join(" "), /accepts exactly 0.002/);
  });

  test("a `within` with no figure at all is NOT pruned — it is still refused", () => {
    // The mirror image, and the reason `prune` is narrow. A missing bound cannot FAIL, so
    // everything sent to it files as a pass. Dropping it would silently delete the check;
    // refusing it makes somebody type the figure the shop actually works to.
    const d = withField({ acceptance_min: null, acceptance_max: null });
    const { draft, dropped } = prune(d);
    assert.deepEqual(dropped, []);
    assert.match(faults(draft).join(" "), /nobody stated a figure/);
  });

  test("a step emptied by pruning goes too, and says so", () => {
    const d = good();
    d.steps.push({
      title: "Test ride it",
      explanation: "A pad that grabs is only found by riding it, and it is found in the bay or on the road.",
      max_add_fields: 1,
      fields: [choiceField([])],
    });

    const { draft, dropped } = prune(d);
    assert.equal(draft.steps.length, 1, "the emptied step is gone");
    assert.match(dropped.join(" "), /had nothing left to capture/);
    assert.match(dropped.join(" "), /Test ride it/);
    assert.deepEqual(faults(draft), []);
  });

  test("a step authored with no fields is left for `faults` to name", () => {
    // Two different mistakes. Pruning emptied one of them; the other arrived empty, and
    // quietly deleting it takes away the one message that tells the author what they did.
    const d = good();
    d.steps[0].fields = [];
    const { draft, dropped } = prune(d);
    assert.deepEqual(dropped, []);
    assert.equal(draft.steps.length, 1);
    assert.match(faults(draft).join(" "), /captures nothing/);
  });

  test("pruning does not rescue a procedure that was wrong in a fixable way", () => {
    // The boundary. A missing explanation is a question for a person, not something to delete.
    const d = good();
    d.steps[0].explanation = "";
    d.steps[0].fields.push(choiceField([]));
    const { draft, dropped } = prune(d);
    assert.equal(dropped.length, 1);
    assert.match(faults(draft).join(" "), /does not say why it exists/);
  });

  test("the input draft is not mutated", () => {
    const d = good();
    d.steps[0].fields.push(choiceField([]));
    prune(d);
    assert.equal(d.steps[0].fields.length, 3, "the caller's draft is left alone");
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
