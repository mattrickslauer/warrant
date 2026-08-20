import "server-only";

// Google Calendar — write only.
//
// Warrant creates events and never reads them back. That is a deliberate scope decision, not
// an unfinished one: reading requires calendar.readonly, a watch channel and conflict
// resolution, and buys nothing the task list does not already know. Warrant is the source of
// truth; the calendar is a projection of it.
//
// THE TOKEN. A refresh token cannot live under /tenants/{t}/** — the recursive read in
// firestore.rules would hand it to every colleague in the tenant. It lives at
// /user_secrets/{uid}, a top-level root with `allow read, write: if false`, reachable only by
// the Admin SDK. The browser never needs it, because events are written here.
//
// See specs/2026-08-20-firestore-design.md §8.4.

import { adminDb } from "@/auth/admin";

/** Write-only needs no read scope, and asking for one we do not use is a worse consent screen. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EVENTS_URL = (calendarId: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

/** Half an hour is a placeholder for "a slot", not an estimate of the work. */
const EVENT_MINUTES = 30;

export interface UserSecret {
  uid: string;
  refresh_token: string;
  scope: string;
  linked_at: string;
}

const secretRef = (uid: string) => adminDb().collection("user_secrets").doc(uid);

/**
 * Store the refresh token from an incremental consent.
 *
 * Incremental, not at sign-in: signing in stays one clean consent screen, and a technician is
 * asked for their calendar the first time they actually receive a dated task. Consent asked
 * for at the moment it is needed is consent that means something.
 */
export async function storeRefreshToken(uid: string, refreshToken: string, scope: string): Promise<void> {
  await secretRef(uid).set(
    { uid, refresh_token: refreshToken, scope, linked_at: new Date().toISOString() } satisfies UserSecret,
    { merge: true },
  );
}

export async function hasCalendarLink(uid: string): Promise<boolean> {
  return (await secretRef(uid).get()).exists;
}

export async function forgetRefreshToken(uid: string): Promise<void> {
  await secretRef(uid).delete();
}

/** Raised when Calendar says slow down. The caller leaves the task for the next sweep. */
export class RateLimited extends Error {
  constructor(public retryAfterMs: number) {
    super("Calendar rate limit");
  }
}

async function accessTokenFor(uid: string): Promise<string | null> {
  const snap = await secretRef(uid).get();
  if (!snap.exists) return null;
  const secret = snap.data() as UserSecret;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: secret.refresh_token,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 400 || response.status === 401) {
    // The user revoked access in their Google account. Forget the token rather than retrying
    // it every minute forever — and let the task keep pushing, which still reaches them.
    await forgetRefreshToken(uid);
    return null;
  }
  if (!response.ok) return null;

  const body = (await response.json()) as { access_token?: string };
  return body.access_token ?? null;
}

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

  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const existingId = await findEventByTaskId(token, calendarId, input.taskId);

  const response = existingId
    ? await fetch(`${EVENTS_URL(calendarId)}/${encodeURIComponent(existingId)}`, {
        method: "PATCH", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      })
    : await fetch(EVENTS_URL(calendarId), {
        method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });

  if (response.status === 403 || response.status === 429) {
    // A fleet of tasks all due at 09:00 arrives as a burst. Leave this one for the next
    // sweep — the push notification has already gone, and that is the channel that reaches a
    // person. A missed calendar event must never suppress it.
    const retry = Number(response.headers.get("retry-after") ?? "60");
    throw new RateLimited(Number.isFinite(retry) ? retry * 1000 : 60_000);
  }
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

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
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

  await fetch(`${EVENTS_URL(calendarId)}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
}
