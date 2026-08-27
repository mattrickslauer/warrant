// The sweep. One cron for the whole system.
//
//   Cloud Scheduler --(OIDC)--> POST /api/tasks/sweep --> push + calendar + adjudication
//
// Chosen over per-task Cloud Tasks because it is one job rather than thousands of scheduled
// callbacks, it is visible in the Console, and it self-heals: if a due time passes while
// nothing is deployed, the next sweep picks it up. Cloud Tasks is more precise. It is not
// more demonstrable, and precision was never the constraint here.
//
// The query is one equality and one inequality on one field — see tasks.ts on `notify_after`.

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { dueTasks, markNotified, attachCalendarEvent, undecidedCaptures,
         stalledSteps, sealableJobs } from "@/server/tasks";
import { sealJobLive } from "@/server/seal";
import { adjudicate } from "@/server/adjudicate/run";
import { dispose } from "@/server/adjudicate/dispose";
import { audit } from "@/server/adjudicate/audit";
import { proceduresDueAnAudit } from "@/server/tasks";
import { pushTask } from "@/server/notify";
import { upsertEvent, RateLimited } from "@/server/calendar";
import { adminDb } from "@/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The longest this is allowed to take.
 *
 * There was no bound at all, which mattered because every leg below is sequential and two of
 * them call models: fifty undecided captures was fifty serial Vertex round trips in one HTTP
 * request. Stated here so the sweep is killed by its own budget rather than by whatever the
 * platform happens to be configured with — and so the number is visible next to the work.
 */
export const maxDuration = 300;

/**
 * How many items of one leg run at once.
 *
 * The loops were strictly serial, so the sweep's wall clock was the SUM of every model call it
 * had to make. Four at a time is chosen against the other end: Cloud Run runs this on 1 CPU and
 * 512 MiB alongside user traffic (infra/deploy-web.sh), and the work is I/O-bound waiting on
 * Vertex rather than CPU-bound, so a small pool collapses the wall clock without competing with
 * the requests a person is waiting on.
 */
const LANES = 4;

/**
 * Run `work` over `items`, `lanes` at a time, and never reject.
 *
 * Each item's failure is its own. A pool that rejected on the first error would abandon the
 * items behind it, which is the opposite of what every leg here wants: a capture that cannot be
 * adjudicated must stay undecided and be retried, not take the rest of the sweep down with it.
 */
async function pool<T>(items: T[], lanes: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await work(items[i]);
      } catch {
        // Counted by the caller, which knows what the failure means for that leg.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, lane));
}

/** How long one sweep may hold the lease before another is allowed to assume it died. */
const LEASE_MS = 10 * 60 * 1000;

/**
 * ONE SWEEP AT A TIME.
 *
 * Nothing prevented two from overlapping, and Cloud Scheduler retries on a slow response — so a
 * sweep that ran long was very likely to be running beside its own retry. Both would read the
 * same due tasks and push the same notifications, both would try to seal the same jobs, and
 * `markNotified` runs AFTER the push, so the window for a duplicate is the whole leg.
 *
 * A lease rather than a lock: a process that dies holding it must not stop the system for ever,
 * so it expires. Taken in a transaction because acquiring it is a read-then-write on one key,
 * which is exactly the race being closed.
 */
async function takeLease(db: FirebaseFirestore.Firestore): Promise<boolean> {
  const ref = db.collection("sweep_cursors").doc("lease");
  return db.runTransaction(async (tx) => {
    const held = Number((await tx.get(ref)).data()?.until ?? 0);
    if (Number.isFinite(held) && held > Date.now()) return false;
    tx.set(ref, { until: Date.now() + LEASE_MS, at: new Date().toISOString() }, { merge: true });
    return true;
  });
}

/** Hand it back, so a fast sweep does not block the next one for the whole lease. */
async function releaseLease(db: FirebaseFirestore.Firestore): Promise<void> {
  await db.collection("sweep_cursors").doc("lease")
    .set({ until: 0, at: new Date().toISOString() }, { merge: true })
    .catch(() => {});
}

/**
 * Cloud Scheduler authenticates with an OIDC token; Cloud Run verifies it before this handler
 * runs, so an unauthenticated request never arrives. The shared secret is a second lock for
 * local runs and for any deployment where the service is public.
 */
function authorised(request: Request): boolean {
  const expected = process.env.WARRANT_SWEEP_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  const presented = request.headers.get("x-warrant-sweep");
  if (!presented) return false;
  // Constant time, like the instrument key in /api/ingest/reading. `===` on a secret leaks its
  // prefix a byte at a time to anyone patient enough to measure, and the two locks in this
  // system should not disagree about whether that matters.
  return timingSafeEqual(
    createHash("sha256").update(presented).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const db = adminDb();
  if (!(await takeLease(db))) {
    // 200, not an error. An overlapping sweep is a normal consequence of the previous one
    // running long, and Cloud Scheduler treats a non-2xx as a failure worth retrying — which
    // would be another overlapping sweep.
    return NextResponse.json({ skipped: "another sweep holds the lease" });
  }

  try {
    return await sweep();
  } finally {
    await releaseLease(db);
  }
}

async function sweep() {
  let tasks;
  try {
    tasks = await dueTasks();
  } catch (error) {
    // The overwhelmingly likely cause is the missing COLLECTION_GROUP index on `tasks`, which
    // Firestore reports with a link to create it. Say so, rather than returning an opaque 500
    // that looks like the sweep found nothing to do.
    return NextResponse.json(
      { error: "Could not read due tasks. Is the COLLECTION_GROUP index on `tasks` deployed?",
        detail: String(error) },
      { status: 500 },
    );
  }

  let pushed = 0;
  let scheduled = 0;
  let deferred = 0;
  /** Calendars that refused for a reason that is not rate limiting. Reported, never fatal. */
  let calendarFailed = 0;

  await pool(tasks, LANES, async (task) => {
    if (!task.tenant_id) return;

    // Push first, and unconditionally. It is the channel that reaches a person, so nothing
    // below is allowed to prevent it.
    pushed += await pushTask({
      tenantId: task.tenant_id,
      title: task.title,
      body: task.detail,
      taskId: task.id,
      assigneeUid: task.assignee_uid,
      assigneeRole: task.assignee_role,
    });

    // A calendar event exists if and only if the task has an OWNER. A role is a queue: three
    // foremen would get three events and claiming would become a distributed delete.
    if (task.assignee_uid && task.due_at) {
      try {
        const eventId = await upsertEvent({
          uid: task.assignee_uid,
          taskId: task.id,
          title: task.title,
          detail: task.detail,
          dueAt: task.due_at,
          links: task.source.job_id ? [`/job/${task.source.job_id}`] : [],
        });
        if (eventId) {
          await attachCalendarEvent(task.tenant_id, task.id, eventId, "primary");
          scheduled += 1;
        }
      } catch (error) {
        if (error instanceof RateLimited) {
          // Burst at 09:00. The push already went; leave the event for the next sweep.
          deferred += 1;
        } else {
          // COUNTED, not rethrown, and not swallowed either.
          //
          // This used to `throw`, which took the entire sweep down over one calendar: the
          // adjudication, disposition and sealing legs below never ran because somebody's OAuth
          // grant had been revoked. It must not be silent either — a sweep reporting a clean run
          // while events quietly stopped being written is the failure `sealError` already exists
          // to prevent — so it is reported in the response instead.
          calendarFailed += 1;
        }
      }
    }

    await markNotified(task.tenant_id, task.id, task.notify_count ?? 0);
  });

  // Evidence whose client died before it could ask for a verdict. This is what makes it
  // acceptable for a client to trigger adjudication at all: nothing depends on the client
  // surviving long enough to make the call.
  //
  // Failures are left undecided ON PURPOSE. A capture that cannot be adjudicated must keep
  // showing up here rather than being marked done to tidy the query — the whole point of the
  // net is that it does not quietly drop anything.
  let adjudicated = 0;
  let stillUndecided = 0;
  try {
    await pool(await undecidedCaptures(2 * 60 * 1000), LANES, async (ref) => {
      try {
        await adjudicate(ref);
        adjudicated += 1;
      } catch {
        stillUndecided += 1;
      }
    });
  } catch (error) {
    // Almost certainly the missing COLLECTION_GROUP index on `captures`. Say so, rather than
    // reporting a clean sweep that adjudicated nothing because it could not look.
    return NextResponse.json(
      { due: tasks.length, pushed, scheduled, deferred,
        error: "Could not read undecided captures. Is the COLLECTION_GROUP index on " +
               "`captures` deployed?",
        detail: String(error) },
      { status: 500 },
    );
  }

  // Steps a technician could not perform, and nobody has ruled on.
  //
  // The Instructor and the Foreman are reached from here rather than from a phone on purpose:
  // somebody who defers a step is walking away from the machine, and what happens to the job
  // next must not depend on their handset staying awake. This is the long-horizon half of the
  // fleet — the half whose unit of time is a purchase-order lead time rather than a step.
  //
  // Failures leave the step undisposed, exactly as a failed adjudication leaves a capture
  // undecided: it keeps turning up here until an agent actually rules on it.
  let disposed = 0;
  let stillStalled = 0;
  try {
    await pool(await stalledSteps(), LANES, async (stall) => {
      try {
        const out = await dispose(stall);
        if (out.action) disposed += 1;
        else stillStalled += 1;
      } catch {
        stillStalled += 1;
      }
    });
  } catch (error) {
    return NextResponse.json(
      { due: tasks.length, pushed, scheduled, deferred, adjudicated, stillUndecided,
        error: "Could not read stalled steps. Is the COLLECTION_GROUP index on " +
               "`step_outcomes` deployed?",
        detail: String(error) },
      { status: 500 },
    );
  }

  // Jobs that finished and were never sealed.
  //
  // The Seal is what turns settled steps into a record, and a record is what the Gate reads to
  // release a machine. A technician who closes the app on the last step must not leave a job
  // complete, unsealed and holding a machine forever — so the sweep seals it, exactly as it
  // adjudicates a capture whose client died. Failures leave the job unsealed and it turns up
  // here again, which is the whole value of the net.
  let sealed = 0;
  let sealError: string | null = null;
  try {
    await pool(await sealableJobs(), LANES, async (job) => {
      try {
        await sealJobLive(job.tenantId, job.jobId);
        sealed += 1;
      } catch {
        // Left unsealed on purpose. Nothing partial was written — the Seal commits in one
        // batch — so there is no half-sealed state to reconcile.
      }
    });
  } catch (error) {
    // A missing index on `jobs` must not take the rest of the sweep down with it — but it must
    // not be SILENT either, and it was. `sealableJobs()` runs an equality on a COLLECTION
    // GROUP, which needs `jobs.status` (COLLECTION_GROUP asc) that `infra/deploy-rules.sh`
    // requests; without it this throws FAILED_PRECONDITION on every sweep and the bare `catch`
    // reported `sealed: 0` — a clean run that had sealed nothing and could never seal anything.
    // A net that cannot say it is torn is worse than no net.
    sealError = "Could not read sealable jobs. Is the COLLECTION_GROUP index on " +
                "`jobs.status` deployed? Run infra/deploy-rules.sh. Detail: " + String(error);
  }

  // The procedure itself, read across weeks of finished jobs.
  //
  // The longest horizon in the system, and the only agent whose subject is the document every
  // other agent measures against. It cannot be triggered by a person finishing a job: a
  // procedure defect is visible only in the aggregate, and the aggregate does not exist until
  // enough jobs have run. So it lives here, on a cadence, which is what "across weeks of
  // asynchronous operations" actually looks like in code.
  let audited = 0;
  const findings: string[] = [];
  try {
    for (const due of await proceduresDueAnAudit()) {
      try {
        const out = await audit(due);
        if (out.decisionId) audited += 1;
        findings.push(...out.findingIds);
      } catch {
        // An audit that failed is retried on the next sweep. Nothing was written, so nothing
        // is half-done — unlike a stalled step, there is no state to leave inconsistent.
      }
    }
  } catch {
    // A missing index on `jobs` must not take the rest of the sweep down with it: the push and
    // calendar legs above have already run, and they are what reaches a person today.
  }

  return NextResponse.json({ due: tasks.length, pushed, scheduled, deferred,
                             adjudicated, stillUndecided, disposed, stillStalled, sealed,
                             audited, findings: findings.length,
                             ...(calendarFailed ? { calendarFailed } : {}),
                             ...(sealError ? { sealError } : {}) });
}

/** Convenience for a human checking the cron is wired, without firing notifications. */
export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  try {
    const tasks = await dueTasks();
    return NextResponse.json({
      due: tasks.length,
      tasks: tasks.map((t) => ({ id: t.id, tenant: t.tenant_id, kind: t.kind, due_at: t.due_at })),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
