// Publish a procedure — freeze the next version.
//
// Server-side because `procedure_versions` is one of the collections firestore.rules refuses
// to a client. That refusal is what makes `may_publish_procedures` standing mean anything:
// a check the client performs is a check the client can skip.
//
// Cookie OR bearer, like `/api/procedures/edit` next door and for its stated reason: the phone
// holds an ID token and has no cookie jar. This route alone took the cookie, which meant a
// technician could interview the Scoper, compile a procedure and edit its fields from the
// handset and then hit a 401 on the one call that freezes the version — authoring right up to
// the point where it counts. `callerSession` verifies the bearer against Firebase with
// `checkRevoked`, exactly as the cookie path does, so nothing is loosened by accepting it.

import { NextResponse } from "next/server";
import { callerSession } from "@/auth/bearer";
import { publishProcedure, NotAllowed } from "@/server/procedures";
import { NotCompilable } from "@/server/procedure-faults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await callerSession(request);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { procedure_id?: string };
  try {
    body = (await request.json()) as { procedure_id?: string };
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!body.procedure_id) {
    return NextResponse.json({ error: "procedure_id is required." }, { status: 400 });
  }

  try {
    const { version } = await publishProcedure(session.tenant.id, body.procedure_id, session.uid);
    return NextResponse.json({ published: true, version });
  } catch (error) {
    // Every reason at once, not the first one. Somebody is looking at a form with seven steps
    // in it, and finding out about one fault per attempt is how you lose them — the same
    // argument `faults()` itself makes for returning a list.
    if (error instanceof NotCompilable) {
      return NextResponse.json({ error: "This procedure is not ready to publish.", faults: error.faults }, { status: 422 });
    }
    if (error instanceof NotAllowed) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
