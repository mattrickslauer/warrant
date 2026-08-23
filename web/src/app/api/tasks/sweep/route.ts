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
import { dueTasks, markNotified, attachCalendarEvent, undecidedCaptures,
         stalledSteps } from "@/server/tasks";
import { adjudicate } from "@/server/adjudicate/run";
import { dispose } from "@/server/adjudicate/dispose";
import { audit } from "@/server/adjudicate/audit";
import { proceduresDueAnAudit } from "@/server/tasks";
import { pushTask } from "@/server/notify";
import { upsertEvent, RateLimited } from "@/server/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cloud Scheduler authenticates with an OIDC token; Cloud Run verifies it before this handler
 * runs, so an unauthenticated request never arrives. The shared secret is a second lock for
 * local runs and for any deployment where the service is public.
 */
function authorised(request: Request): boolean {
  const expected = process.env.WARRANT_SWEEP_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.get("x-warrant-sweep") === expected;
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

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

  for (const task of tasks) {
    if (!task.tenant_id) continue;

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
          throw error;
        }
      }
    }

    await markNotified(task.tenant_id, task.id, task.notify_count ?? 0);
  }

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
    for (const ref of await undecidedCaptures(2 * 60 * 1000)) {
      try {
        await adjudicate(ref);
        adjudicated += 1;
      } catch {
        stillUndecided += 1;
      }
    }
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
    for (const stall of await stalledSteps()) {
      try {
        const out = await dispose(stall);
        if (out.action) disposed += 1;
        else stillStalled += 1;
      } catch {
        stillStalled += 1;
      }
    }
  } catch (error) {
    return NextResponse.json(
      { due: tasks.length, pushed, scheduled, deferred, adjudicated, stillUndecided,
        error: "Could not read stalled steps. Is the COLLECTION_GROUP index on " +
               "`step_outcomes` deployed?",
        detail: String(error) },
      { status: 500 },
    );
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
                             adjudicated, stillUndecided, disposed, stillStalled,
                             audited, findings: findings.length });
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
