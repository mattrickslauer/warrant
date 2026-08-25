// The Seal's provenance classifier. It had no tests at all, which is how the `specified`
// rung stayed both FORGEABLE and UNREACHABLE for the whole build.
//
// Two separate defects, one line:
//
//   forgeable    the rung read `field.resolved_from_order`, a value the client writes.
//                firestore.rules refuses a forged `provenance_class` and a forged
//                `capture_surface` and has never refused this one.
//   unreachable  nothing in the product ever wrote that field, so no record could carry
//                `specified` — a quarter of the taxonomy the record renders was decorative.
//
// It now derives from the pinned, frozen procedure's acceptance rule. Every test below has a
// positive control: a suite where `specified` is simply never returned would pass against
// both the old bug and a stub.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/seal.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classify, fieldDefsOf } from "../src/server/seal.ts";

const ALL = ["measured", "specified", "inferred", "asserted"];
const field = { key: "pad_torque", step_id: "b3", kind: "measurement" };
const perSpec = { acceptance_rule: "per_spec", acceptance_target: "the pressure moulded into the sidewall" };
const within = { acceptance_rule: "within", acceptance_target: null };
const clean = { capture_surface: "app", armor_verdict: "NO_MATCH_FOUND" };

const at = (o = {}) => classify({
  field, def: null, readings: [], capture: null, reachable: ALL, ...o,
});

describe("classify — the rungs, strongest first", () => {
  test("a reading with a tool_id is measured", () => {
    assert.equal(at({ readings: [{ tool_id: "A19" }] }), "measured");
  });

  test("a reading with NO tool_id is not measured — it is the tool_id that carries the claim", () => {
    assert.equal(at({ readings: [{ tool_id: null }] }), "asserted");
  });

  test("a per_spec field in the frozen procedure is specified", () => {
    assert.equal(at({ def: perSpec }), "specified");
  });

  test("any other acceptance rule is not specified", () => {
    assert.equal(at({ def: within }), "asserted");
  });

  test("a screened capture is inferred", () => {
    assert.equal(at({ capture: clean }), "inferred");
  });

  test("NOT_SCREENED is not enough for inferred", () => {
    assert.equal(at({ capture: { armor_verdict: "NOT_SCREENED" } }), "asserted");
  });

  test("nothing at all is asserted, and that is not a failure", () => {
    assert.equal(at(), "asserted");
  });

  test("measured outranks specified when both could apply", () => {
    assert.equal(at({ def: perSpec, readings: [{ tool_id: "A19" }] }), "measured");
  });

  test("specified outranks inferred when both could apply", () => {
    assert.equal(at({ def: perSpec, capture: clean }), "specified");
  });
});

describe("classify — what the client writes cannot promote a field", () => {
  // The regression this whole change exists for.
  test("resolved_from_order on the field document is ignored", () => {
    const forged = { ...field, resolved_from_order: "spec" };
    assert.equal(
      classify({ field: forged, def: null, readings: [], capture: null, reachable: ALL }),
      "asserted",
    );
  });

  test("...and it cannot promote past a stronger rung either", () => {
    const forged = { ...field, resolved_from_order: "spec" };
    assert.equal(
      classify({ field: forged, def: within, readings: [], capture: clean, reachable: ALL }),
      "inferred",
    );
  });

  test("a field with no definition in the frozen version falls through, never up", () => {
    assert.equal(at({ def: null, capture: clean }), "inferred");
  });
});

describe("classify — the ceiling clamps", () => {
  const open = ["specified", "inferred", "asserted"];

  test("an open job cannot reach measured however the number arrived", () => {
    assert.equal(at({ readings: [{ tool_id: "A19" }], reachable: open }), "asserted");
  });

  test("specified IS reachable on an open job — it needs no instrument, only a published figure", () => {
    assert.equal(at({ def: perSpec, reachable: open }), "specified");
  });

  test("a tier that cannot reach specified clamps it to asserted", () => {
    assert.equal(at({ def: perSpec, reachable: ["inferred", "asserted"] }), "asserted");
  });
});

describe("fieldDefsOf", () => {
  const version = {
    steps: [
      { id: "b1", fields: [{ key: "wheel_photo", acceptance_rule: "must_show" }] },
      { id: "b3", fields: [
        { key: "pad_torque", acceptance_rule: "within" },
        { key: "tyre_pressure", acceptance_rule: "per_spec", acceptance_target: "the sidewall" },
      ] },
    ],
  };

  test("keys match the {stepId}__{key} identity readings already use", () => {
    const m = fieldDefsOf(version);
    assert.equal(m.get("b3__tyre_pressure").acceptance_rule, "per_spec");
    assert.equal(m.get("b1__wheel_photo").acceptance_rule, "must_show");
  });

  test("the same key in two steps does not collide", () => {
    const m = fieldDefsOf({
      steps: [
        { id: "s1", fields: [{ key: "photo", acceptance_rule: "must_show" }] },
        { id: "s2", fields: [{ key: "photo", acceptance_rule: "per_spec" }] },
      ],
    });
    assert.equal(m.get("s1__photo").acceptance_rule, "must_show");
    assert.equal(m.get("s2__photo").acceptance_rule, "per_spec");
  });

  test("a version that would not load yields an empty map rather than throwing", () => {
    assert.equal(fieldDefsOf(null).size, 0);
    assert.equal(fieldDefsOf({}).size, 0);
    assert.equal(fieldDefsOf({ steps: [{ id: "s1" }] }).size, 0);
  });
});
