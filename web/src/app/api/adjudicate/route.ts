// Wake the fleet for one capture.
//
// Deliberately reference-only: { job_id, step_id, field_key, capture_id }. The handler
// re-reads every fact from Firestore, so nothing a caller asserts can change what the
// Inspector is shown. A body that could carry the acceptance rule could pass anything.
//
// It does not care WHO woke it. A client calls it fire-and-forget after writing a capture;
// the sweep calls it for anything a dead client left behind; an Eventarc Firestore trigger
// could call it later without this file changing shape.

import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { adjudicate } from "@/server/adjudicate/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  job_id?: string;
  step_id?: string;
  field_key?: string;
  capture_id?: string;
}

/** The cron has no session. The same lock the sweep already uses. */
function fromSweep(request: Request): boolean {
  const expected = process.env.WARRANT_SWEEP_SECRET;
  if (!expected) return false;
  return request.headers.get("x-warrant-sweep") === expected;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { job_id, step_id, field_key, capture_id } = body;
  if (!job_id || !step_id || !field_key || !capture_id) {
    return NextResponse.json(
      { error: "job_id, step_id, field_key and capture_id are all required." },
      { status: 400 },
    );
  }

  // `acme.com/job_9` — the tenant is IN the job id, and it must match the session's tenant or
  // this is a cross-tenant read dressed up as an adjudication request. Admin credentials
  // bypass firestore.rules, so this check is the only thing standing here.
  const slash = job_id.indexOf("/");
  if (slash <= 0) {
    return NextResponse.json({ error: "job_id must be tenant-scoped." }, { status: 400 });
  }
  const tenantId = job_id.slice(0, slash);
  const bareJobId = job_id.slice(slash + 1);
  if (!bareJobId || bareJobId.includes("/")) {
    return NextResponse.json({ error: "job_id must be tenant-scoped." }, { status: 400 });
  }

  if (!fromSweep(request)) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authorised." }, { status: 401 });
    }
    if (session.tenant.id !== tenantId) {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }
  }

  try {
    const result = await adjudicate({
      tenantId,
      jobId: bareJobId,
      stepId: step_id,
      fieldKey: field_key,
      captureId: capture_id,
    });
    // 202: the decisions are already written, but the technician learns through their
    // snapshot listener, not through this response. No screen waits on this call.
    return NextResponse.json(
      { decisions: result.decisionIds, effect: result.effect.kind },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Adjudication failed.", detail: String(error) },
      { status: 500 },
    );
  }
}
