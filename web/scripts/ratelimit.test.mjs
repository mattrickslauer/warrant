// The ceiling in front of the two routes that spend money.
//
// This is the only thing in the whole system that answers a person with 429, which makes its
// numbers a product decision rather than a detail: too high and a script drains the model
// budget, too low and the product refuses somebody using it correctly — and a refusal is
// indistinguishable, from the outside, from the thing being broken.
//
//   node --experimental-strip-types --test web/scripts/ratelimit.test.mjs

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { take, resetLimits, MODEL_LIMIT, INTERVIEW_LIMIT } =
  await import("../src/server/ratelimit.ts");

const LIMIT = { max: 3, windowMs: 60_000 };

describe("a fixed window, per caller", () => {
  beforeEach(() => resetLimits());

  test("spends up to the ceiling and then refuses", () => {
    for (let i = 0; i < LIMIT.max; i += 1) {
      assert.equal(take("u:1", LIMIT, 1_000).allowed, true, `request ${i + 1} should be allowed`);
    }
    const refused = take("u:1", LIMIT, 1_000);
    assert.equal(refused.allowed, false);
    assert.ok(refused.retryAfter > 0, "a refusal must say when to come back");
  });

  test("one caller cannot spend another's budget", () => {
    for (let i = 0; i < LIMIT.max; i += 1) take("u:1", LIMIT, 1_000);
    assert.equal(take("u:2", LIMIT, 1_000).allowed, true,
      "the bucket is shared between callers — one busy user locks everybody out");
  });

  test("the window reopens on its own", () => {
    for (let i = 0; i < LIMIT.max; i += 1) take("u:1", LIMIT, 1_000);
    assert.equal(take("u:1", LIMIT, 1_000).allowed, false);
    assert.equal(take("u:1", LIMIT, 1_000 + LIMIT.windowMs).allowed, true,
      "the window never reset, so a caller is refused for ever");
  });

  test("retryAfter counts down within the window rather than being a constant", () => {
    for (let i = 0; i < LIMIT.max; i += 1) take("u:1", LIMIT, 1_000);
    const early = take("u:1", LIMIT, 1_000).retryAfter;
    const late = take("u:1", LIMIT, 1_000 + 45_000).retryAfter;
    assert.ok(late < early, "retry-after does not shrink as the window empties");
    assert.ok(late >= 1, "retry-after must never tell a caller to come back in zero seconds");
  });
});

describe("the ceilings are set for a person, not against one", () => {
  // The numbers themselves, asserted because they were wrong and the wrongness was invisible:
  // a demonstration hitting the limit looks exactly like the product failing.
  test("a person working briskly is nowhere near either ceiling", () => {
    // A capture takes longer than a second to produce, an interview turn much longer. These
    // are floors on "obviously a human", not predictions of typical use.
    assert.ok(MODEL_LIMIT.max >= 60,
      "the adjudication ceiling is low enough that a real run through a procedure can reach it");
    assert.ok(INTERVIEW_LIMIT.max >= 30,
      "the interview ceiling is low enough to interrupt somebody mid-conversation");
  });

  test("the interview stays the tighter of the two, because its turns grow", () => {
    // Each turn carries the whole transcript so far, so turn N costs more than turn N-1.
    assert.ok(INTERVIEW_LIMIT.max < MODEL_LIMIT.max);
  });

  test("both are still ceilings, not an absence of one", () => {
    for (const limit of [MODEL_LIMIT, INTERVIEW_LIMIT]) {
      assert.ok(Number.isFinite(limit.max) && limit.max > 0);
      assert.equal(limit.windowMs, 60_000);
    }
  });
});

describe("a malformed override must not take the product down", () => {
  // The failure this guards against is silent and total: a typo in an env file becoming
  // "no requests allowed", with nothing anywhere saying why.
  const reload = async (value) => {
    if (value === null) delete process.env.WARRANT_MODEL_LIMIT;
    else process.env.WARRANT_MODEL_LIMIT = value;
    // A fresh module instance, because the ceiling is read once at import.
    return import(`../src/server/ratelimit.ts?v=${encodeURIComponent(String(value))}`);
  };

  test("a number is honoured", async () => {
    const m = await reload("7");
    assert.equal(m.MODEL_LIMIT.max, 7);
  });

  test("nonsense falls back to the default instead of to zero", async () => {
    for (const bad of ["nought", "", "-5", "0"]) {
      const m = await reload(bad);
      assert.ok(m.MODEL_LIMIT.max > 0,
        `${JSON.stringify(bad)} produced a ceiling of ${m.MODEL_LIMIT.max} — every request refused`);
    }
    delete process.env.WARRANT_MODEL_LIMIT;
  });
});
