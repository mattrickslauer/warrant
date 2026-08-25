// Waive a step, on a named person's standing.
//
// THIS ROUTE IS THE MISSING HALF OF A CONTROL THAT WAS ONLY EVER ENFORCED.
//
// `waived` is one of the three statuses that settle a step, and the system was careful about
// it from both sides: firestore.rules refuses `status: "waived"` and `waived_by` from every
// client, and `dispose.ts` refuses to write `waived` from a cron because "an agent reached by
// a cron has nobody's standing". Both refusals are right. But nothing was left that COULD
// write one — so `mayWaive()` and `may_waive_to_strictness` sat in members.ts with no caller,
// and the state was unreachable.
//
// That is not a missing feature, it is a stuck machine. `machineReleased` in data/seal.ts
// releases only on `performed` or a SIGNED `waived`, so any job with a step somebody could not
// perform held its machine for ever, with no path to the one outcome the model provides for
// letting it go. A workshop would have discovered this on the first bolt it could not turn.
//
// What makes a waiver a waiver, and all three are checked here:
//
//   a NAMED person      `waived_by` is the verified session uid, never a body field.
//   who holds STANDING  `mayWaive` against the pinned procedure's strictness, not the job's
//                       claim about it.
//   who says WHY        an unexplained waiver is a skip, and the record has to carry the
//                       reason a stranger will read years later.

import { NextResponse } from "next/server";
import { callerSession } from "@/auth/bearer";
import { adminDb } from "@/auth/admin";
import { getMember, mayWaive } from "@/auth/members";
import { pinnedVersion } from "@/server/procedures";
import { sealIfFinished } from "@/server/seal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  job_id?: string;
  step_id?: string;
  reason?: string;
}

export async function POST(request: Request) {
  const session = await callerSession(request);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { job_id, step_id } = body;
  const reason = (body.reason ?? "").trim();
  if (!job_id || !step_id) {
    return NextResponse.json({ error: "job_id and step_id are required." }, { status: 400 });
  }
  // An unsigned, unexplained waiver is just a skip with better branding.
  if (reason.length < 10) {
    return NextResponse.json(
      { error: "A waiver has to say why, in a sentence a stranger reading this record can use." },
      { status: 400 },
    );
  }

  const slash = job_id.indexOf("/");
  const named = slash > 0 ? job_id.slice(0, slash) : null;
  const jobId = slash > 0 ? job_id.slice(slash + 1) : job_id;
  if (!jobId || jobId.includes("/")) {
    return NextResponse.json({ error: "job_id is not a job." }, { status: 400 });
  }
  if (named && named !== session.tenant.id) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const tenantId = session.tenant.id;
  const db = adminDb();
  const jobRef = db.collection("tenants").doc(tenantId).collection("jobs").doc(jobId);

  const [jobSnap, member] = await Promise.all([
    jobRef.get(),
    getMember(tenantId, session.uid),
  ]);
  if (!jobSnap.exists) return NextResponse.json({ error: "No such job." }, { status: 404 });
  const job = jobSnap.data()!;

  // The strictness comes from the PINNED VERSION, not from the job header.
  //
  // `job.strictness` is copied onto the job by the client at startJob, and a client that could
  // name the strictness it is waived against could name 0 and waive anything. The frozen
  // version is server-written and is what the step is actually judged by.
  const version = await pinnedVersion(
    db, tenantId, String(job.procedure_id), job.procedure_version,
  );
  const strictness = Number(version?.strictness ?? job.strictness ?? 1);

  const step = (version?.steps ?? []).find((s: { id?: string }) => s.id === step_id);
  if (!step) {
    return NextResponse.json(
      { error: `Step ${step_id} is not in the pinned procedure version.` },
      { status: 409 },
    );
  }

  if (!member || member.disabled) {
    return NextResponse.json({ error: "You do not have standing to waive." }, { status: 403 });
  }
  if (!mayWaive(member, strictness)) {
    // Say what was missing. "Forbidden" sends somebody hunting; naming the two numbers tells
    // them who in the shop can actually sign this.
    return NextResponse.json(
      {
        error:
          `Waiving a step on a strictness-${strictness} procedure needs standing to ` +
          `${strictness}, and yours reaches ${member.standing.may_waive_to_strictness}. ` +
          `Someone with that standing has to sign this.`,
      },
      { status: 403 },
    );
  }

  const outRef = jobRef.collection("step_outcomes").doc(step_id);
  const now = new Date().toISOString();

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(outRef);
      const current = String(snap.data()?.status ?? "pending");
      // A settled step is settled. Re-waiving a performed step would rewrite history, and
      // waiving one a Foreman ruled impossible would launder a deficiency into a release.
      if (["performed", "waived", "impossible"].includes(current)) {
        throw new AlreadySettled(current);
      }
      tx.set(outRef, {
        status: "waived",
        // The signature. The verified session uid, never anything the caller sent.
        waived_by: session.uid,
        waived_at: now,
        reason_kind: "text",
        reason_transcript: reason,
        reason_by: session.uid,
        reason_at: now,
        // A stated reason is always asserted: a named human said it, at this time.
        provenance_class: "asserted",
        hold_reason: null,
        escalation_question: null,
      }, { merge: true });
    });
  } catch (error) {
    if (error instanceof AlreadySettled) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  // A signed waiver settles the step, and the step it settles may be the last one. The waiver
  // is already durable above; this cannot fail the request — see `sealIfFinished`.
  const sealed = await sealIfFinished(tenantId, jobId, db);

  return NextResponse.json({
    waived: true, step_id, waived_by: session.uid, at: now,
    // Told, not inferred. The caller who signed the last waiver on a job should learn that a
    // record now exists rather than discover it by polling for one.
    sealed: sealed ? { record_id: sealed.recordId, machine_released: sealed.machineReleased } : null,
  });
}

class AlreadySettled extends Error {
  constructor(public status: string) {
    super(`This step is already ${status}.`);
  }
}
