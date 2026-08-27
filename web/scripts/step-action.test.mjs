// What the one big button means, and which field the page is pointed at.
//
// The twin is android/…/ui/job/StepActionTest.kt and this file is the same suite written
// twice, deliberately. The bar is a CLAIM: "Capture" says a lens can satisfy this field,
// "Next step" says nothing is owed, "This can't be answered" says the procedure asked for
// something nobody can produce. A screenshot cannot catch a wrong claim — the button looks
// identical either way — so the claims are pinned here instead.
//
// Every test has a positive control: an implementation that always returned ADVANCE would
// fail, and so would one that always returned CAPTURE.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/step-action.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  primaryActionFor, activeFieldFor, framedFieldFor, usesCamera, usesKeyboard,
  unanswerable, holdsStep, working, requiredAt,
} from "../src/data/step-action.ts";

/** A field, with every contract key present so the types are not being dodged. */
const field = (over = {}) => ({
  key: "k",
  kind: "photo",
  prompt: "Photograph it",
  source: "camera",
  required_at_strictness: 0,
  acceptance_rule: "must_show",
  acceptance_description: "the thing",
  acceptance_min: null,
  acceptance_max: null,
  acceptance_unit: null,
  acceptance_target: null,
  guidance: "What good looks like",
  ...over,
});

const photo = (key = "k") => field({ key });
const measurement = (key = "torque") =>
  field({ key, kind: "measurement", source: "instrument", acceptance_rule: "within" });
const signature = (key = "sig") =>
  field({ key, kind: "signature", source: "human", acceptance_rule: "signed_by" });
const text = (key = "note") =>
  field({ key, kind: "text", source: "human", acceptance_rule: "per_spec" });
const choice = (key = "how", choices = ["Good", "Bad"]) =>
  field({ key, kind: "choice", source: "human", acceptance_rule: "per_spec", choices });

/** The bar, with the instrument absent and nothing typed unless a test says otherwise. */
const bar = (over = {}) =>
  primaryActionFor({
    field: null,
    fieldFilled: false,
    lastStep: false,
    instrumentConnected: false,
    instrumentHasReading: false,
    inputReady: false,
    ...over,
  });

describe("the primary bar", () => {
  test("no outstanding field means the bar is the way forward", () => {
    const a = bar({ field: null });
    assert.equal(a.kind, "advance");
    assert.equal(a.label, "Next step");
    assert.equal(a.enabled, true);
  });

  test("the last step finishes rather than advancing", () => {
    const a = bar({ field: null, lastStep: true });
    assert.equal(a.kind, "finish");
    assert.equal(a.label, "Finish");
  });

  test("a camera field offers the shutter", () => {
    const a = bar({ field: photo() });
    assert.equal(a.kind, "capture");
    assert.equal(a.label, "Capture");
  });

  test("a frame under review offers a retake instead", () => {
    const a = bar({ field: photo(), fieldFilled: true });
    assert.equal(a.kind, "capture");
    assert.equal(a.label, "Retake");
  });

  test("camera is decided by source as well as kind", () => {
    // A scan on a camera source is still the lens. Deciding on `kind` alone sent it to the
    // keyboard, which is a claim that somebody typed a barcode they in fact photographed.
    const scan = field({ key: "part", kind: "scan", source: "camera", acceptance_rule: "matches" });
    assert.equal(usesCamera(scan), true);
    assert.equal(bar({ field: scan }).kind, "capture");
  });

  test("a measurement never reaches a keyboard", () => {
    // At every combination of connected/reading/typed there is no path to `record`.
    for (const connected of [true, false]) {
      for (const hasReading of [true, false]) {
        for (const inputReady of [true, false]) {
          const a = bar({
            field: measurement(),
            instrumentConnected: connected,
            instrumentHasReading: hasReading,
            inputReady,
          });
          assert.notEqual(a.kind, "record", `connected=${connected} reading=${hasReading}`);
        }
      }
    }
  });

  test("an unpaired measurement sends you to pair rather than pretending", () => {
    const a = bar({ field: measurement(), instrumentConnected: false });
    assert.equal(a.kind, "pair");
    assert.equal(a.enabled, true);
  });

  test("a paired instrument with nothing to say leaves the bar dead but not busy", () => {
    const a = bar({ field: measurement(), instrumentConnected: true, instrumentHasReading: false });
    assert.equal(a.kind, "take_reading");
    assert.equal(a.enabled, false);
    assert.equal(a.busy, false, "idle, not working — the two must render differently");
  });

  test("a reading can be taken onto the form", () => {
    const a = bar({ field: measurement(), instrumentConnected: true, instrumentHasReading: true });
    assert.equal(a.kind, "take_reading");
    assert.equal(a.label, "Take this reading");
    const again = bar({
      field: measurement(), instrumentConnected: true, instrumentHasReading: true,
      fieldFilled: true,
    });
    assert.equal(again.label, "Take it again");
  });

  test("a signature never demands a keystroke, whatever has been typed", () => {
    for (const inputReady of [true, false]) {
      const a = bar({ field: signature(), inputReady });
      assert.equal(a.kind, "advance");
      assert.equal(a.enabled, true);
    }
  });

  test("a signature on the last step finishes rather than advancing", () => {
    assert.equal(bar({ field: signature(), lastStep: true }).kind, "finish");
  });

  test("text records once something has been typed", () => {
    assert.equal(bar({ field: text(), inputReady: false }).enabled, false);
    const ready = bar({ field: text(), inputReady: true });
    assert.equal(ready.kind, "record");
    assert.equal(ready.label, "Record");
    assert.equal(ready.enabled, true);
  });

  test("a choice bar commits only once something has been chosen", () => {
    assert.equal(bar({ field: choice(), inputReady: false }).enabled, false);
    assert.equal(bar({ field: choice(), inputReady: true }).kind, "record");
  });
});

describe("what the keyboard is for", () => {
  test("a choice field never reaches a keyboard", () => {
    assert.equal(usesKeyboard(choice()), false);
  });

  test("the keyboard rule excludes a measurement too", () => {
    assert.equal(usesKeyboard(measurement()), false);
  });

  test("text and signature are what the keyboard is for", () => {
    assert.equal(usesKeyboard(text()), true);
    assert.equal(usesKeyboard(signature()), true);
  });

  test("a field answered through the lens is not answered by typing", () => {
    assert.equal(usesKeyboard(photo()), false);
  });
});

describe("a question with no answers", () => {
  test("a choice with answers is answerable", () => {
    assert.equal(unanswerable(choice("how", ["Good", "Bad"])), null);
  });

  test("a choice with no answers names the fault", () => {
    const fault = unanswerable(choice("how", []));
    assert.ok(fault, "an empty choice list has to be named, not drawn as a text box");
    assert.match(fault, /fixed set/);
  });

  test("effort is not the same as impossibility", () => {
    // A measurement with no tool in the room is hard, not impossible: pairing is a real move.
    assert.equal(unanswerable(measurement()), null);
    assert.equal(unanswerable(photo()), null);
    assert.equal(unanswerable(text()), null);
    assert.equal(unanswerable(signature()), null);
  });

  test("an unanswerable field gets a live bar, never a dead one", () => {
    const a = bar({ field: choice("how", []) });
    assert.equal(a.kind, "declare");
    assert.equal(a.enabled, true, "a grey bar here is indistinguishable from a broken app");
  });

  test("the way out is offered on the last step too", () => {
    assert.equal(bar({ field: choice("how", []), lastStep: true }).kind, "declare");
  });

  test("an unanswerable field holds the step until a reason is given", () => {
    const f = choice("how", []);
    assert.equal(holdsStep(f, 1, false, false), true);
    assert.equal(holdsStep(f, 1, true, false), false);
  });

  test("a reason does not release a field that could have been answered", () => {
    // The escape hatch is scoped to questions with no answers. A photograph somebody simply
    // did not take is still owed after they have explained a different field.
    assert.equal(holdsStep(photo(), 1, true, false), true);
  });

  test("an optional field never holds the step whatever else is true", () => {
    const optional = field({ required_at_strictness: 4 });
    assert.equal(requiredAt(optional, 3), false);
    assert.equal(holdsStep(optional, 3, false, false), false);
  });
});

describe("which field the page is pointed at", () => {
  const filledNone = () => false;

  test("the active field is the first required one still empty", () => {
    const fields = [photo("a"), photo("b")];
    assert.equal(activeFieldFor(fields, 1, null, false, (k) => k === "a")?.key, "b");
  });

  test("an optional field does not hold the step open", () => {
    const fields = [field({ key: "a", required_at_strictness: 4 }), photo("b")];
    assert.equal(activeFieldFor(fields, 1, null, false, filledNone)?.key, "b");
  });

  test("tapping the strip overrides the walk-forward order", () => {
    const fields = [photo("a"), photo("b")];
    assert.equal(activeFieldFor(fields, 1, "a", false, filledNone)?.key, "a");
  });

  test("a selection naming nothing falls back to the outstanding field", () => {
    const fields = [photo("a"), photo("b")];
    assert.equal(activeFieldFor(fields, 1, "gone", false, filledNone)?.key, "a");
  });

  test("nothing outstanding means the bar is the way out", () => {
    const fields = [photo("a")];
    assert.equal(activeFieldFor(fields, 1, null, false, () => true), null);
  });

  test("the page walks past an unanswerable field once it has been explained", () => {
    const fields = [choice("how", []), photo("b")];
    assert.equal(activeFieldFor(fields, 1, null, false, filledNone)?.key, "how");
    assert.equal(activeFieldFor(fields, 1, null, true, filledNone)?.key, "b");
  });

  test("a step whose only field was unanswerable becomes the way forward", () => {
    const fields = [choice("how", [])];
    assert.equal(activeFieldFor(fields, 1, null, true, filledNone), null);
  });

  test("the field strip can still point back at an explained question", () => {
    const fields = [choice("how", []), photo("b")];
    assert.equal(activeFieldFor(fields, 1, "how", true, filledNone)?.key, "how");
  });
});

describe("the frame on screen, and what Redo would throw away", () => {
  test("the frame on screen belongs to the field in front of you", () => {
    const fields = [photo("a"), photo("b")];
    assert.equal(framedFieldFor(fields, fields[1], (k) => k === "b")?.key, "b");
  });

  test("a lens field with nothing taken yet has no frame to redo", () => {
    const fields = [photo("a")];
    assert.equal(framedFieldFor(fields, fields[0], () => false), null);
  });

  test("a field answered another way never offers redo", () => {
    const fields = [text("note")];
    assert.equal(framedFieldFor(fields, fields[0], () => true), null);
  });

  test("a finished step still offers redo on the frame it is resting on", () => {
    const fields = [photo("a")];
    assert.equal(framedFieldFor(fields, null, () => true)?.key, "a");
  });

  test("a finished step with no camera field has nothing to redo", () => {
    const fields = [text("note")];
    assert.equal(framedFieldFor(fields, null, () => true), null);
  });

  test("redo stays on one field when the step has several lenses", () => {
    // Both have frames. Pointed at `b`, redo must offer `b` — never the first one it finds.
    const fields = [photo("a"), photo("b")];
    assert.equal(framedFieldFor(fields, fields[1], () => true)?.key, "b");
  });
});

describe("the bar while the browser is still working", () => {
  test("a bar with work behind it says so and cannot be fired again", () => {
    const a = working(bar({ field: photo() }), "Saving this capture…");
    assert.equal(a.label, "Saving this capture…");
    assert.equal(a.enabled, false);
    assert.equal(a.busy, true);
    assert.equal(a.kind, "capture", "the kind is what the tap MEANT and does not change");
  });

  test("nothing in flight leaves the bar exactly as it was", () => {
    const idle = bar({ field: photo() });
    assert.deepEqual(working(idle, null), idle);
  });
});
