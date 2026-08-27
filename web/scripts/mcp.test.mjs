// The machine-to-machine surface, driven end to end with no HTTP and no cloud.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/mcp.test.mjs
//
// The handlers in `server/mcp/tools.ts` are plain functions over a DataSource, which is what
// makes this possible: the MCP envelope and the transport are applied once in `server.ts` and
// are not what needs testing. What needs testing is the SURFACE — what it exposes, what it
// refuses to expose, and whether a caller can reach a tenant that is not theirs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { warrantTools } from "../src/server/mcp/tools.ts";
import { FixtureSource } from "../src/data/fixture-source.ts";

const TENANT = "demo.warrant.ink";
const byName = Object.fromEntries(warrantTools().map((t) => [t.name, t]));

const ctx = (tenantId = TENANT) => ({
  caller: { tenantId, uid: "u_test" },
  source: new FixtureSource(),
});

const call = (name, args = {}, c = ctx()) => byName[name].handler(args, c);

describe("the MCP surface", () => {
  // The seven the README promises, and NOT ONE MORE.
  //
  // This test is the reason the file exists. An MCP server over a system that holds machines
  // out of service is an invitation to grow a bypass one convenient tool at a time, and the
  // convenient tool is always the one that seals or releases something. Adding a tool here is
  // meant to be a decision somebody makes on purpose, so it fails this list first.
  test("exposes exactly the seven documented tools", () => {
    assert.deepEqual(Object.keys(byName).sort(), [
      "get_record", "inventory", "list_procedures", "open_job",
      "raise_po", "request", "step_status",
    ]);
  });

  test("nothing on the surface can seal, release, waive or adjudicate", () => {
    for (const forbidden of ["seal", "release", "waive", "adjudicate", "finalize", "approve"]) {
      assert.equal(
        Object.keys(byName).some((n) => n.includes(forbidden)), false,
        `a tool named like \`${forbidden}\` would put the Gate on the machine surface`,
      );
    }
  });

  test("the three writing tools are marked as writing", () => {
    const writes = Object.values(byName).filter((t) => !t.readOnly).map((t) => t.name).sort();
    assert.deepEqual(writes, ["open_job", "raise_po", "request"]);
  });

  test("every tool describes itself, so a model can choose between them", () => {
    for (const t of Object.values(byName)) {
      assert.ok(t.description.length > 40, `${t.name} needs a real description`);
      assert.ok(t.title.length > 0);
    }
  });
});

describe("list_procedures", () => {
  test("returns the tenant's published procedures with their version and tier", async () => {
    const { procedures } = await call("list_procedures");
    assert.ok(procedures.length > 0);
    const brake = procedures.find((p) => p.id === "proc_front_brake_v3");
    assert.ok(brake, "the fixture tenant's brake procedure should be listed");
    assert.equal(brake.minimum_tier, "instrumented");
    assert.equal(typeof brake.version, "number");
    // The honest half: what this version went out WITHOUT.
    assert.ok(Array.isArray(brake.dropped));
  });

  test("does not return another tenant's procedures", async () => {
    const { procedures } = await call("list_procedures", {}, ctx("someone-else.example"));
    assert.equal(procedures.length, 0);
  });
});

describe("open_job", () => {
  // THE HUMAN ACT SURVIVES THE MACHINE INTERFACE.
  //
  // `finalize()` is documented in the contract as the act that lets the fleet see a job, and
  // no tool on this surface calls it. An external system queueing work must not be able to
  // decide that the work has started.
  test("creates a DRAFT, and says so", async () => {
    const out = await call("open_job", { procedure_id: "proc_front_brake_v3" });
    assert.equal(out.status, "draft");
    assert.match(out.note, /draft/i);
    assert.ok(out.job_id);
  });

  test("refuses a tier below the procedure's minimum rather than downgrading", async () => {
    await assert.rejects(
      () => call("open_job", { procedure_id: "proc_front_brake_v3", tier: "open" }),
      /minimum|instrumented/i,
      "a job opened below the minimum could never be performed, so it is refused up front",
    );
  });

  test("refuses a procedure belonging to another tenant", async () => {
    await assert.rejects(
      () => call("open_job", { procedure_id: "proc_front_brake_v3" }, ctx("someone-else.example")),
      /No procedure/,
    );
  });
});

describe("step_status", () => {
  test("reports what the job is waiting on, derived from the step outcomes", async () => {
    const c = ctx();
    const opened = await call("open_job", { procedure_id: "proc_front_brake_v3" }, c);
    const status = await call("step_status", { job_id: opened.job_id }, c);
    assert.equal(status.job_id, opened.job_id);
    assert.ok(status.steps_total > 0);
    assert.equal(status.steps_performed, 0);
    assert.equal(status.record_id, null, "an unsealed job has no record");
    assert.ok(Array.isArray(status.waiting_on));
  });

  test("a job id carrying another tenant is refused, not rescoped", async () => {
    const c = ctx();
    const opened = await call("open_job", { procedure_id: "proc_front_brake_v3" }, c);
    await assert.rejects(
      () => call("step_status", { job_id: `acme.example/${opened.job_id}` }, c),
      /does not belong to this tenant/,
    );
  });

  test("an unknown job is not found rather than empty", async () => {
    await assert.rejects(() => call("step_status", { job_id: "job_nope" }), /No job/);
  });
});

describe("get_record", () => {
  test("an unsealed job has no record to return", async () => {
    const c = ctx();
    const opened = await call("open_job", { procedure_id: "proc_front_brake_v3" }, c);
    await assert.rejects(
      () => call("get_record", { record_id: opened.job_id }),
      /No sealed record/,
    );
  });
});

// --- the protocol itself ------------------------------------------------------------------
//
// Everything above tests the SURFACE. This tests that the surface is reachable over MCP:
// a real JSON-RPC request, through the real Streamable HTTP transport, against the real
// server object. No HTTP listener and no auth — `route.ts` resolves the caller and this is
// everything after that.
describe("the MCP protocol", () => {
  const rpc = async (body) => {
    const { handleMcpRequest } = await import("../src/server/mcp/server.ts");
    const response = await handleMcpRequest(
      { tenantId: TENANT, uid: "u_test" },
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
      }),
    );
    return { response, json: JSON.parse(await response.text()) };
  };

  test("initialize returns the server identity and its capabilities", async () => {
    const { response, json } = await rpc({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    assert.equal(response.status, 200);
    assert.equal(json.result.serverInfo.name, "warrant");
    assert.ok(json.result.capabilities.tools, "the server has to advertise tools");
  });

  test("tools/list returns all seven over the wire, with their input schemas", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = json.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "get_record", "inventory", "list_procedures", "open_job",
      "raise_po", "request", "step_status",
    ]);
    const openJob = json.result.tools.find((t) => t.name === "open_job");
    // A client decides what needs consent from this, so it has to survive the transport.
    assert.equal(openJob.annotations.readOnlyHint, false);
    assert.equal(openJob.inputSchema.type, "object");
    assert.ok(openJob.inputSchema.properties.procedure_id);
  });

  test("tools/call runs a tool and returns structured content", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "list_procedures", arguments: {} },
    });
    assert.ok(!json.result.isError);
    assert.ok(Array.isArray(json.result.structuredContent.procedures));
    assert.ok(json.result.structuredContent.procedures.length > 0);
  });

  // A tool that throws must reach the caller as a TOOL error it can read and act on, not as a
  // transport fault. A model handed "the server broke" cannot recover; one handed "no such
  // procedure in this tenant" can call list_procedures.
  test("a failing tool answers with isError rather than breaking the transport", async () => {
    const { response, json } = await rpc({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "step_status", arguments: { job_id: "job_nope" } },
    });
    assert.equal(response.status, 200);
    assert.equal(json.result.isError, true);
    assert.match(json.result.content[0].text, /No job/);
  });
});
