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
import { askFleet, FleetUnreachable } from "../src/server/fleet.ts";

const ENGINE = "projects/1/locations/us-central1/reasoningEngines/9";

beforeEach(() => {
  process.env.WARRANT_FLEET_ENGINE = ENGINE;
  delete process.env.WARRANT_ADJUDICATOR_SA;
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
});
