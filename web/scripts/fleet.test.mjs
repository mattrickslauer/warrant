// The client for the deployed fleet.
//
// The reply from reasoningEngines:query is DOUBLE-NESTED — body.output.output holds the
// verdict. Reading body.output by mistake yields an object that looks entirely plausible,
// has no verdict in it, and produces `undefined` rather than an error. So it is asserted
// here rather than trusted.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/fleet.test.mjs

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { askFleet, FleetUnreachable, retryAfterMs, fleetTimeoutMs,
         INTERVIEW_TIMEOUT_MS } from "../src/server/fleet.ts";

const ENGINE = "projects/1/locations/us-central1/reasoningEngines/9";

beforeEach(() => {
  process.env.WARRANT_FLEET_ENGINE = ENGINE;
  delete process.env.WARRANT_ADJUDICATOR_SA;
  // Same number of rungs as the real ladder, none of the waiting. The thing under test is
  // which statuses are climbed, not how long a person is made to stand there.
  process.env.WARRANT_FLEET_BACKOFF_MS = "0,0";
});

const REPLY = {
  output: {
    output: { verdict: "ADD_FIELD", confidence: 1, rationale: "No photo was captured." },
    usage: { totalTokenCount: 1887 },
    model: "gemini-3.5-flash",
    latency_ms: 6518,
    agent: "inspector",
    valid: true,
    schema_errors: [],
  },
};

/** Answers with each status in turn, and records how many times it was asked. */
function flakyFetch(statuses, body, seen) {
  let n = 0;
  return async () => {
    const status = statuses[Math.min(n, statuses.length - 1)];
    n += 1;
    if (seen) seen.calls = n;
    return {
      ok: status === 200,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

function fakeFetch(status, body, seen) {
  return async (url, init) => {
    if (seen) { seen.url = url; seen.init = init; }
    return {
      ok: status === 200,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

/** Answers after `ms`, and gives up the moment the caller's signal says so. */
function slowFetch(ms, body) {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({
        ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
      }), ms);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(init.signal.reason ?? new Error("aborted"));
      });
    });
}

describe("askFleet", () => {
  test("unwraps the double nesting to the verdict", async () => {
    const reply = await askFleet("inspector", { step: {} }, fakeFetch(200, REPLY));
    assert.equal(reply.output.verdict, "ADD_FIELD");
    assert.equal(reply.model, "gemini-3.5-flash");
    assert.equal(reply.latencyMs, 6518);
    assert.equal(reply.valid, true);
    assert.deepEqual(reply.schemaErrors, []);
    assert.equal(reply.usage.totalTokenCount, 1887);
  });

  test("sends the classMethod envelope the API requires", async () => {
    const seen = {};
    await askFleet("skeptic", { asset: { id: "bike-04" } }, fakeFetch(200, REPLY, seen));
    assert.match(seen.url, /\/v1\/projects\/1\/.*reasoningEngines\/9:query$/);
    const body = JSON.parse(seen.init.body);
    assert.equal(body.classMethod, "query");
    assert.equal(body.input.agent, "skeptic");
    assert.deepEqual(body.input.case, { asset: { id: "bike-04" } });
  });

  test("a schema-invalid answer is returned, not thrown", async () => {
    // runtime.py hands validation failures back rather than raising, precisely so the caller
    // can refuse the answer and say why. Throwing here would lose the text.
    const invalid = {
      output: { ...REPLY.output, valid: false, schema_errors: ["verdict: required"] },
    };
    const reply = await askFleet("inspector", {}, fakeFetch(200, invalid));
    assert.equal(reply.valid, false);
    assert.deepEqual(reply.schemaErrors, ["verdict: required"]);
  });

  test("a 403 becomes FleetUnreachable", async () => {
    // The identity trap: .env's service account is least-privilege and cannot call Vertex.
    // A 403 that reads as "the model does not exist" has already cost hours once.
    await assert.rejects(
      () => askFleet("inspector", {}, fakeFetch(403, { error: { message: "denied" } })),
      (e) => e instanceof FleetUnreachable && /403/.test(e.message),
    );
  });

  test("a reply with no envelope is refused rather than returned empty", async () => {
    await assert.rejects(
      () => askFleet("inspector", {}, fakeFetch(200, { nothing: true })),
      (e) => e instanceof FleetUnreachable,
    );
  });

  test("refuses to run with no engine configured", async () => {
    delete process.env.WARRANT_FLEET_ENGINE;
    await assert.rejects(() => askFleet("inspector", {}, fakeFetch(200, REPLY)),
      /WARRANT_FLEET_ENGINE/);
  });

  test("a 429 is waited out rather than reported as a failure", async () => {
    // Vertex publishes quota per minute. A capture judged at the wrong moment is not a
    // capture the fleet refused — it is one the fleet was never asked about, and holding the
    // step for it puts a stall in front of a mechanic for no reason at all.
    const seen = {};
    const reply = await askFleet("inspector", {}, flakyFetch([429, 429, 200], REPLY, seen));
    assert.equal(reply.output.verdict, "ADD_FIELD");
    assert.equal(seen.calls, 3);
  });

  test("a 503 is waited out too — a replica coming back up is not a verdict", async () => {
    const seen = {};
    const reply = await askFleet("inspector", {}, flakyFetch([503, 200], REPLY, seen));
    assert.equal(reply.valid, true);
    assert.equal(seen.calls, 2);
  });

  test("quota that never clears gives up, and says it was quota", async () => {
    // Holding is the safe outcome and run.ts already implements it. What matters is that the
    // reason reaching the record says 429, because "the fleet could not be reached" sends
    // whoever reads it to check credentials and the network, neither of which is wrong here.
    const seen = {};
    await assert.rejects(
      () => askFleet("inspector", {}, flakyFetch([429], { error: { message: "quota" } }, seen)),
      (e) => e instanceof FleetUnreachable && /429/.test(e.message),
    );
    assert.equal(seen.calls, 3, "one attempt plus the two rungs of the ladder");
  });

  test("a 403 is never retried — it will say the same thing three times", async () => {
    const seen = {};
    await assert.rejects(
      () => askFleet("inspector", {}, flakyFetch([403], { error: { message: "denied" } }, seen)),
      (e) => e instanceof FleetUnreachable,
    );
    assert.equal(seen.calls, 1);
  });

  test("retry-after is honoured, and capped", () => {
    // A quota refusal sometimes carries a RetryInfo measured in hours. It is accurate and it
    // is useless to a request someone is waiting on, so the cap wins over the server.
    assert.equal(retryAfterMs({ headers: { get: () => "2" } }), 2_000);
    assert.equal(retryAfterMs({ headers: { get: () => "3600" } }), 5_000);
    assert.equal(retryAfterMs({ headers: { get: () => "later" } }), null);
    assert.equal(retryAfterMs({ headers: { get: () => null } }), null);
    // The fakes above have no `headers` at all, which is exactly the shape that used to make
    // the 429 handler throw a TypeError of its own.
    assert.equal(retryAfterMs({}), null);
  });
});

// --- How long the caller waits, and why it may not match the engine ----------------------

describe("the fleet timeout", () => {
  test("the mechanic's default is unchanged", () => {
    // `adjudicate/run.ts` is a person standing at a machine. 45s is the right budget there
    // and this change must not have moved it.
    assert.equal(fleetTimeoutMs(), 45_000);
  });

  test("a caller may ask for a different budget", () => {
    assert.equal(fleetTimeoutMs(120_000), 120_000);
  });

  test("the interview waits longer than the engine's own call budget", async () => {
    // THE BUG THIS LOCKS SHUT.
    //
    // `model.py` gives one Gemini call CALL_TIMEOUT seconds and then retries it. This side
    // used to abort at exactly the same number, so the engine's retry could never run — the
    // caller had already given up at the instant the inner call did. A long Scoper interview
    // is the slowest turn there is, so it is where the two equal budgets collided first: a
    // real 22-minute authoring session died on it and could not be recovered.
    //
    // Read from model.py rather than hard-coded, so lowering either one fails here.
    const py = await readFile(new URL("../../agents/warrant/model.py", import.meta.url), "utf8");
    const engineSeconds = Number(/CALL_TIMEOUT = int\(os\.environ\.get\("WARRANT_TIMEOUT", "(\d+)"\)\)/.exec(py)[1]);
    assert.ok(engineSeconds > 0, "could not read CALL_TIMEOUT out of model.py");
    assert.ok(
      INTERVIEW_TIMEOUT_MS > engineSeconds * 1000,
      `the interview budget (${INTERVIEW_TIMEOUT_MS}ms) must exceed the engine's own ` +
        `call budget (${engineSeconds * 1000}ms), or the engine's retry never runs`,
    );
  });

  test("an overrun aborts the call rather than hanging", async () => {
    // The fake honours the signal, so this exercises the real plumbing rather than asserting
    // a number was passed somewhere.
    await assert.rejects(
      () => askFleet("scoper", {}, slowFetch(400, REPLY), { timeoutMs: 25 }),
      (e) => e instanceof FleetUnreachable && /did not answer/.test(e.message),
    );
  });

  test("a call that answers inside its budget is not aborted", async () => {
    const reply = await askFleet("scoper", {}, slowFetch(20, REPLY), { timeoutMs: 2_000 });
    assert.equal(reply.output.verdict, "ADD_FIELD");
  });
});
