// The sweep. One cron for the whole system.
//
//   Cloud Scheduler --(OIDC)--> POST /api/tasks/sweep --> push + calendar
//
// Chosen over per-task Cloud Tasks because it is one job rather than thousands of scheduled
// callbacks, it is visible in the Console, and it self-heals: if a due time passes while
// nothing is deployed, the next sweep picks it up. Cloud Tasks is more precise. It is not
// more demonstrable, and precision was never the constraint here.
//
// The query is one equality and one inequality on one field — see tasks.ts on `notify_after`.

import { NextResponse } from "next/server";
import { dueTasks, markNotified, attachCalendarEvent } from "@/server/tasks";
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

  return NextResponse.json({ due: tasks.length, pushed, scheduled, deferred });
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
