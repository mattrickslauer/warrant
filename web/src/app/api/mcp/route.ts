// The MCP endpoint. `POST /api/mcp`, Streamable HTTP, stateless.
//
// Machine-to-machine, and it authenticates exactly like every other write surface: a Firebase
// ID token as a bearer, verified WITH `checkRevoked`, tenant derived from the claims. There is
// no API key and no service token, and that is deliberate — the README's promise is that when
// an employer disables an account, access ends the same instant. A long-lived key issued to a
// "system" would be an account no directory can disable, which is the one identity this
// product must not mint.
//
//   curl -sX POST https://<service>/api/mcp \
//     -H "authorization: Bearer $ID_TOKEN" \
//     -H 'content-type: application/json' \
//     -H 'accept: application/json, text/event-stream' \
//     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

import { callerSession } from "@/auth/bearer";
import { handleMcpRequest } from "@/server/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A JSON-RPC error, in the shape a client can actually parse. */
function rpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status, headers: { "content-type": "application/json" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const session = await callerSession(request);
  if (!session) {
    // -32001 rather than a bare 401 body: an MCP client reads the JSON-RPC error, and a
    // transport-level failure with no payload surfaces to a model as "the server broke".
    return rpcError(401, -32001,
      "Not signed in. Send a Firebase ID token as `authorization: Bearer <token>`.");
  }
  return handleMcpRequest({ tenantId: session.tenant.id, uid: session.uid }, request);
}

// GET opens the server-to-client SSE stream in Streamable HTTP. Nothing on this surface pushes
// — every tool answers in one shot — so it is refused explicitly rather than left to 405 with
// no explanation.
export async function GET(): Promise<Response> {
  return rpcError(405, -32000,
    "This server does not open a notification stream. POST JSON-RPC requests to this endpoint.");
}
