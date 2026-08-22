// Model Armor's envelope, pinned.
//
// The test that matters is `a dangerous-looking machine part is not refused`. Screened against
// a real photograph of brake pads, rai.dangerous returns MATCH_FOUND and the top-level
// filterMatchState reads MATCH_FOUND with it. Keying off that — the obvious thing to do —
// refuses a routine photograph of a brake, a blade or a torque wrench, which is most of the
// evidence this product exists to collect.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/armor.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readVerdict } from "../src/server/adjudicate/armor.ts";

/** Verbatim from a live call on agents/evals/media/brake/pads-seated-sharp.jpg. */
const REAL_BRAKE_PHOTO = {
  sanitizationResult: {
    filterMatchState: "MATCH_FOUND",
    filterResults: {
      csam: { csamFilterFilterResult: { executionState: "EXECUTION_SUCCESS",
                                        matchState: "NO_MATCH_FOUND" } },
      rai: { raiFilterResult: {
        executionState: "EXECUTION_SUCCESS", matchState: "MATCH_FOUND",
        raiFilterTypeResults: {
          dangerous: { confidenceLevel: "LOW_AND_ABOVE", matchState: "MATCH_FOUND" },
          sexually_explicit: { matchState: "NO_MATCH_FOUND" },
        },
      } },
      pi_and_jailbreak: { piAndJailbreakFilterResult: {
        executionState: "EXECUTION_SUCCESS", matchState: "NO_MATCH_FOUND" } },
    },
  },
};

describe("readVerdict", () => {
  test("a dangerous-looking machine part is NOT refused", () => {
    const r = readVerdict(REAL_BRAKE_PHOTO);
    assert.equal(r.verdict, "NO_MATCH_FOUND",
      "rai.dangerous fires on brake pads; it must not decide this");
  });

  test("prompt injection in the image is refused", () => {
    const injected = structuredClone(REAL_BRAKE_PHOTO);
    injected.sanitizationResult.filterResults.pi_and_jailbreak
      .piAndJailbreakFilterResult.matchState = "MATCH_FOUND";
    const r = readVerdict(injected);
    assert.equal(r.verdict, "MATCH_FOUND");
    assert.match(r.detail, /instruction/);
  });

  test("CSAM is honoured — that is not a judgement call", () => {
    const bad = structuredClone(REAL_BRAKE_PHOTO);
    bad.sanitizationResult.filterResults.csam.csamFilterFilterResult.matchState = "MATCH_FOUND";
    assert.equal(readVerdict(bad).verdict, "MATCH_FOUND");
  });

  test("a filter that did not run is NOT_SCREENED, never clean", () => {
    const broken = structuredClone(REAL_BRAKE_PHOTO);
    broken.sanitizationResult.filterResults.pi_and_jailbreak
      .piAndJailbreakFilterResult.executionState = "EXECUTION_SKIPPED";
    const r = readVerdict(broken);
    assert.equal(r.verdict, "NOT_SCREENED");
  });

  test("an unrecognised envelope is NOT_SCREENED, never clean", () => {
    assert.equal(readVerdict({}).verdict, "NOT_SCREENED");
    assert.equal(readVerdict(null).verdict, "NOT_SCREENED");
    assert.equal(readVerdict({ sanitizationResult: { filterResults: {} } }).verdict,
                 "NOT_SCREENED");
  });

  test("every verdict carries a reason", () => {
    for (const body of [REAL_BRAKE_PHOTO, {}, null]) {
      assert.ok(readVerdict(body).detail.length > 0);
    }
  });
});
