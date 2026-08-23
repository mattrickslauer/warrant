// Seal a finished job.
//
// Server-side because `records` is one of the collections firestore.rules refuses to a client,
// and that refusal is the point: "written once by the Seal, never updated" is only true if a
// client cannot write it. It is also the only path that may stamp `provenance_class`, which is
// recomputed here from the server-written `readings` collection rather than read off whatever
// arrived on the field document.
//
// Reference-only, like `/api/adjudicate`: the handler re-reads every fact. The tenant comes
// from the verified session and NOTHING else — Admin credentials bypass the rules, so a tenant
// taken from a request body would be a straight tenancy bypass.

import { NextResponse } from "next/server";
import { callerSession } from "@/auth/bearer";
import { sealJobLive, NotSealable } from "@/server/seal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await callerSession(request);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { job_id?: string };
  try {
    body = (await request.json()) as { job_id?: string };
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!body.job_id) {
    return NextResponse.json({ error: "job_id is required." }, { status: 400 });
  }

  // The job id may arrive tenant-scoped (`acme.com/job_9`), which is how ids travel through
  // the DataSource interface. The tenant in it is checked rather than trusted — it names which
  // tenant the caller THINKS they are in, and the session says which one they are.
  const slash = body.job_id.indexOf("/");
  const named = slash > 0 ? body.job_id.slice(0, slash) : null;
  const jobId = slash > 0 ? body.job_id.slice(slash + 1) : body.job_id;
  if (!jobId || jobId.includes("/")) {
    return NextResponse.json({ error: "job_id is not a job." }, { status: 400 });
  }
  if (named && named !== session.tenant.id) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  try {
    const sealed = await sealJobLive(session.tenant.id, jobId);
    return NextResponse.json({
      sealed: true,
      record_id: sealed.recordId,
      ceiling_tier: sealed.tier,
      machine_released: sealed.machineReleased,
    });
  } catch (error) {
    if (error instanceof NotSealable) {
      // Say WHY. "Could not seal" sends someone hunting; "three steps are still pending"
      // tells them what has to happen first.
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
