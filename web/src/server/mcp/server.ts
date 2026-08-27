import "server-only";

// The MCP server itself: the seven tools of `tools.ts`, bound to one caller.
//
// Built PER REQUEST and thrown away, which is the stateless Streamable HTTP shape. That is not
// a simplification — Cloud Run runs many instances and routes a caller to whichever is warm, so
// a server holding session state between calls would answer correctly only while the caller
// happened to land on the same container. Stateless is the only shape that is true here.
//
// The caller is bound at construction rather than read inside a handler, so there is no path
// where a tool sees a tenant that did not come from the verified session.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport }
  from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { warrantTools, type McpCaller, type McpContext } from "./tools";
// `@/data/index` rather than `@/data`: Next resolves the directory, the bare Node loader that
// runs `scripts/mcp.test.mjs` does not, and this module is one of the few that runs under both.
import { getDataSource } from "@/data/index";

export const SERVER_NAME = "warrant";

/** Bumped when the TOOL SURFACE changes, which is what a caller pins against. */
export const SERVER_VERSION = "1.0.0";

export function buildMcpServer(caller: McpCaller): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Warrant is a maintenance assurance system: procedures are performed step by step and " +
        "sealed into records whose every field carries a provenance class. This surface is " +
        "read-mostly on purpose. Nothing here can seal a record, release a machine or waive a " +
        "step — those stay with the deterministic core and with people. `open_job` creates a " +
        "DRAFT that a person must finalize, and `raise_po` drafts an order that a person must " +
        "approve.",
    },
  );

  const ctx: McpContext = { caller, source: getDataSource() };

  for (const tool of warrantTools()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          // Nothing on this surface deletes or overwrites anything. `raise_po` and `request`
          // are keyed on their cause and merge, so a retry updates one task rather than
          // raising a second — see `taskIdFor`.
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      // The envelope is applied HERE, once, so the handlers in tools.ts stay plain functions
      // returning plain JSON and remain directly testable.
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.handler(args ?? {}, ctx);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (error) {
          // Returned as a tool error rather than thrown, so a model calling this gets
          // something it can act on instead of a transport fault it cannot see inside.
          return {
            content: [{
              type: "text" as const,
              text: error instanceof Error ? error.message : "The tool failed.",
            }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}

/** One request, answered and closed. */
export async function handleMcpRequest(caller: McpCaller, request: Request): Promise<Response> {
  const server = buildMcpServer(caller);
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session id, so nothing has to be sticky across Cloud Run instances.
    sessionIdGenerator: undefined,
    // Plain JSON responses rather than an SSE stream. Every tool here answers in one shot —
    // there is no long-running call on this surface to stream progress for — and a plain
    // response works with clients that do not implement the streaming half.
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // The server holds the transport; closing it releases both. Without this every request
    // would leak a connected pair for the life of the container.
    await server.close().catch(() => {});
  }
}
