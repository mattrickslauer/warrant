import "server-only";

// Google Calendar — write only.
//
// Warrant creates events and never reads them back. That is a deliberate scope decision, not
// an unfinished one: reading requires calendar.readonly, a watch channel and conflict
// resolution, and buys nothing the task list does not already know. Warrant is the source of
// truth; the calendar is a projection of it.
//
// The token, the consent flow and the scope set live in `workspace.ts` — three Google APIs now
// share one grant, and the token stopped belonging to whichever of them was written first.

import { accessTokenFor, googleFetch, hasScope, CALENDAR_SCOPE } from "@/server/workspace";

export { CALENDAR_SCOPE, RateLimited } from "@/server/workspace";

const EVENTS_URL = (calendarId: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

/** Half an hour is a placeholder for "a slot", not an estimate of the work. */
const EVENT_MINUTES = 30;

export interface EventInput {
  uid: string;
  taskId: string;
  title: string;
  detail: string;
  dueAt: string;
  /** Deep links back into Warrant, so the event is useful from the calendar alone. */
  links?: string[];
  calendarId?: string;
}

/**
 * Create or update the event for a task. Returns its id, or null if we could not.
 *
 * Idempotency is via `extendedProperties.private.warrant_task_id` rather than a stored event
 * id. Re-running the sweep finds the event it wrote last time and updates it, which means a
 * lost or stale stored id cannot produce a duplicate on somebody's calendar — and duplicates
 * on a calendar are the failure people actually notice.
 */
export async function upsertEvent(input: EventInput): Promise<string | null> {
  const calendarId = input.calendarId ?? "primary";
  if (!(await hasScope(input.uid, CALENDAR_SCOPE))) return null;
  const token = await accessTokenFor(input.uid);
  if (!token) return null;

  const start = new Date(input.dueAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + EVENT_MINUTES * 60_000);

  const body = {
    summary: input.title,
    description: [input.detail, ...(input.links ?? [])].filter(Boolean).join("\n\n"),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: { private: { warrant_task_id: input.taskId } },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 0 },
        { method: "popup", minutes: 60 },
      ],
    },
  };

  const existingId = await findEventByTaskId(token, calendarId, input.taskId);

  // A 403 or 429 from here throws RateLimited out of googleFetch. That is caught in the sweep,
  // which leaves the event for the next pass — the push notification has already gone, and
  // that is the channel that reaches a person. A missed calendar event must never suppress it.
  const response = existingId
    ? await googleFetch(`${EVENTS_URL(calendarId)}/${encodeURIComponent(existingId)}`, token,
                        { method: "PATCH", body: JSON.stringify(body) })
    : await googleFetch(EVENTS_URL(calendarId), token,
                        { method: "POST", body: JSON.stringify(body) });

  if (!response.ok) return null;

  const created = (await response.json()) as { id?: string };
  return created.id ?? existingId ?? null;
}

async function findEventByTaskId(
  token: string, calendarId: string, taskId: string,
): Promise<string | null> {
  const url = new URL(EVENTS_URL(calendarId));
  url.searchParams.set("privateExtendedProperty", `warrant_task_id=${taskId}`);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("showDeleted", "false");

  const response = await googleFetch(url.toString(), token);
  if (!response.ok) return null;

  const body = (await response.json()) as { items?: Array<{ id?: string }> };
  return body.items?.[0]?.id ?? null;
}

/**
 * Remove the event for a task.
 *
 * Called when a task is closed, dismissed, or un-claimed. Un-claimed matters: the event
 * belongs to the owner, and a task with no owner has no event.
 */
export async function deleteEventForTask(
  uid: string, taskId: string, calendarId = "primary",
): Promise<void> {
  const token = await accessTokenFor(uid);
  if (!token) return;

  const eventId = await findEventByTaskId(token, calendarId, taskId);
  if (!eventId) return;

  await googleFetch(`${EVENTS_URL(calendarId)}/${encodeURIComponent(eventId)}`, token,
                    { method: "DELETE" });
}
