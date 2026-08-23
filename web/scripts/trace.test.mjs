// The reasoning trace.
//
// Two claims worth a test. First, that instrumentation NEVER changes behaviour — a span that
// swallows an error or alters a return value is worse than no span. Second, that a line comes
// out even with no collector deployed, because "we added OpenTelemetry" with no exporter is a
// claim about a dependency rather than about observability.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/trace.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.GCP_PROJECT = "warrant-trace-test";
const { newTrace, withSpan } = await import("../src/server/trace.ts");

/** Capture stdout, which is where a structured log line has to go on Cloud Run. */
async function captured(fn) {
  const lines = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    const s = String(chunk);
    if (s.startsWith("{")) { lines.push(JSON.parse(s)); return true; }
    return write(chunk, ...rest);
  };
  try { return { result: await fn(), lines }; }
  finally { process.stdout.write = write; }
}

describe("withSpan", () => {
  test("returns exactly what the work returned", async () => {
    const { result } = await captured(() =>
      withSpan(newTrace(), "work", {}, async () => ({ verdict: "PASS" })));
    assert.deepEqual(result, { verdict: "PASS" });
  });

  test("an error is recorded AND rethrown", async () => {
    // A span that reports ok because the instrumentation ate the exception is worse than none.
    const { lines } = await captured(async () => {
      await assert.rejects(
        () => withSpan(newTrace(), "work", {}, async () => { throw new Error("fleet down"); }),
        /fleet down/);
    });
    assert.equal(lines[0].ok, false);
    assert.equal(lines[0].severity, "ERROR");
    assert.match(lines[0].error, /fleet down/);
  });

  test("a line is emitted with no collector deployed", async () => {
    const { lines } = await captured(() =>
      withSpan(newTrace(), "agent.inspector", { agent: "inspector" }, async () => 1));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].span, "agent.inspector");
    assert.equal(lines[0].agent, "inspector");
    assert.equal(typeof lines[0].duration_ms, "number");
  });

  test("Cloud Logging's trace field has the shape Cloud Logging actually reads", async () => {
    // A bare id is silently ignored, which looks exactly like tracing not working.
    const { lines } = await captured(() =>
      withSpan(newTrace(), "work", {}, async () => 1));
    assert.match(lines[0]["logging.googleapis.com/trace"],
                 /^projects\/warrant-trace-test\/traces\/[0-9a-f]{32}$/);
    assert.match(lines[0]["logging.googleapis.com/spanId"], /^[0-9a-f]{16}$/);
  });

  test("children share the trace and name their parent, so the tree has a shape", async () => {
    const { lines } = await captured(async () => {
      const root = newTrace();
      await withSpan(root, "adjudicate", {}, async (child) => {
        // The two agents that run concurrently. A flat audit log cannot show this.
        await Promise.all([
          withSpan(child, "agent.inspector", {}, async () => 1),
          withSpan(child, "agent.skeptic", {}, async () => 2),
        ]);
      });
    });

    const traces = new Set(lines.map((l) => l["logging.googleapis.com/trace"]));
    assert.equal(traces.size, 1, "one capture is one trace");

    const inspector = lines.find((l) => l.span === "agent.inspector");
    const skeptic = lines.find((l) => l.span === "agent.skeptic");
    const root = lines.find((l) => l.span === "adjudicate");
    assert.equal(inspector.parent_span_id, skeptic.parent_span_id,
                 "siblings hang under the same parent");
    assert.equal(inspector.parent_span_id, root["logging.googleapis.com/spanId"]);
    assert.equal(root.parent_span_id, undefined, "the root has no parent");
  });

  test("null and undefined attributes are not emitted as noise", async () => {
    const { lines } = await captured(() =>
      withSpan(newTrace(), "work", { kept: 1, dropped: null, also: undefined }, async () => 1));
    assert.equal(lines[0].kept, 1);
    assert.equal("dropped" in lines[0], true); // present as null in the log, absent on the span
  });
});
