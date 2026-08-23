// Make a procedure public, or take it back down.
//
// Server-side because /public_procedures is world-readable and nobody-writable — there is no
// client path to it, deliberately, and that refusal is what makes the standing check below
// mean anything. See web/src/server/public-procedures.ts.

import { NextResponse } from "next/server";
import { callerSession } from "@/auth/bearer";
import { NotAllowed } from "@/server/procedures";
import { shareProcedure, unshareProcedure } from "@/server/public-procedures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Cookie or bearer, like every other authoring route: the phone holds an ID token and has
  // no cookie jar, and a promise that holds for the browser and not the handset is not the
  // promise that was made.
  const session = await callerSession(request);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { procedure_id?: string; public?: boolean };
  try {
    body = (await request.json()) as { procedure_id?: string; public?: boolean };
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!body.procedure_id) {
    return NextResponse.json({ error: "procedure_id is required." }, { status: 400 });
  }
  // Explicit rather than defaulted. `{procedure_id}` alone must not be read as "make it
  // public" — the direction of this call is the whole decision it carries.
  if (typeof body.public !== "boolean") {
    return NextResponse.json({ error: "public must be true or false." }, { status: 400 });
  }

  try {
    if (!body.public) {
      await unshareProcedure(session.tenant.id, body.procedure_id, session.uid);
      return NextResponse.json({ public: false, public_id: null });
    }
    const { publicId, version } = await shareProcedure(
      session.tenant.id, body.procedure_id, session.uid,
    );
    return NextResponse.json({ public: true, public_id: publicId, version });
  } catch (error) {
    if (error instanceof NotAllowed) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
