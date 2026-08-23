// Turn a finished Scoper interview into a procedure that can be run.
//
// The counterpart to `/api/scoper/turn`. That route runs the conversation and never writes
// anything; this one writes, and so it is where standing is checked and where a draft that
// would decide nothing is refused.
//
// Server-side for the same reason publishing is: `procedure_versions` is a collection
// firestore.rules refuses to every client, and a client that could write its own frozen
// version could write the acceptance rule it is about to be judged against.

import { NextResponse } from "next/server";
import { requireSession } from "@/auth/session";
import { compileProcedure, NotCompilable, type Draft } from "@/server/compile";
import { NotAllowed } from "@/server/procedures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { draft?: Draft };
  try {
    body = (await request.json()) as { draft?: Draft };
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!body.draft) {
    return NextResponse.json({ error: "draft is required." }, { status: 400 });
  }

  try {
    const { procedureId, version, tier } =
      await compileProcedure(session.tenant, session.uid, body.draft);
    return NextResponse.json({
      procedure_id: procedureId, version, minimum_tier: tier, tenant: session.tenant.id,
    });
  } catch (error) {
    // 422, not 400: the request was well formed and the draft was refused on its merits. The
    // faults go back in full because the shop is still sitting there and can answer.
    if (error instanceof NotCompilable) {
      return NextResponse.json({ error: "This draft would not decide anything.",
                                 faults: error.faults }, { status: 422 });
    }
    if (error instanceof NotAllowed) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
