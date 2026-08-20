// Publish a procedure — freeze the next version.
//
// Server-side because `procedure_versions` is one of the collections firestore.rules refuses
// to a client. That refusal is what makes `may_publish_procedures` standing mean anything:
// a check the client performs is a check the client can skip.

import { NextResponse } from "next/server";
import { requireSession } from "@/auth/session";
import { publishProcedure, NotAllowed } from "@/server/procedures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

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
    if (error instanceof NotAllowed) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
