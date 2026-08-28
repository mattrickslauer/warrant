import "server-only";

// The Google Workspace link. One grant, three APIs, one place that knows about the token.
//
// This began life inside `calendar.ts`, because the calendar was the only Google API Warrant
// called. It is not any more: a sealed record is written to Drive, a row lands in the shop's
// ledger, and the Foreman's reorder is drafted in Gmail. Three callers wanting the same access
// token is exactly when the token stops belonging to any one of them.
//
// THE TOKEN. A refresh token cannot live under /tenants/{t}/** — the recursive read in
// firestore.rules would hand it to every colleague in the tenant. It lives at
// /user_secrets/{uid}, a top-level root with `allow read, write: if false`, reachable only by
// the Admin SDK. The browser never needs it, because every call that uses it is made here.
//
// See specs/2026-08-20-firestore-design.md §8.4.

import { adminDb } from "@/auth/admin";

/**
 * Everything Warrant asks for, and nothing else.
 *
 * Each of these is a WRITE scope for a thing Warrant creates, and none of them is a read scope
 * for a thing it does not. That is not tidiness; it is the difference between a consent screen
 * a technician can reasonably accept and one that asks to read their mail.
 *
 *   calendar.events   create the event for a dated task. Warrant never reads a calendar back.
 *   gmail.compose     create a DRAFT. `compose` cannot send, and cannot read the inbox — the
 *                     narrowest scope that can put a purchase order in front of a person, and
 *                     the one that makes "drafted, never sent" a property of the grant rather
 *                     than a promise in a comment.
 *   drive.file        per-file access to files THIS APP CREATED. Warrant can write the records
 *                     folder and the ledger it made and cannot see one other thing in the
 *                     person's Drive. It also covers the Sheets API for a sheet Warrant made,
 *                     which is why the ledger costs no extra scope.
 *
 * gmail.send is deliberately absent even though notification emails are a feature: those go out
 * through the tenant's own notifier, not by borrowing a person's mailbox. See `gmail.ts`.
 */
export const WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/drive.file",
] as const;

export const WORKSPACE_SCOPE = WORKSPACE_SCOPES.join(" ");

/** Kept so an older grant, made when the calendar was the only scope, still identifies itself. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** The single-use CSRF nonce for the consent round trip. httpOnly, so only this browser has it. */
export const WORKSPACE_STATE_COOKIE = "warrant_workspace_state";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface UserSecret {
  uid: string;
  refresh_token: string;
  /** Space-separated, exactly as Google returned it. Never what we asked for. */
  scope: string;
  linked_at: string;
}

const secretRef = (uid: string) => adminDb().collection("user_secrets").doc(uid);

/**
 * Store the refresh token from an incremental consent.
 *
 * Incremental, not at sign-in: signing in stays one clean consent screen asking for identity
 * and nothing else, and the Workspace grant is asked for from Settings by somebody who has
 * decided they want it. Consent asked for at the moment it is wanted is consent that means
 * something, and a sign-in screen listing scopes the product has not yet used is how people
 * learn to click through them.
 */
export async function storeRefreshToken(uid: string, refreshToken: string, scope: string): Promise<void> {
  tokenCache.delete(uid);
  await secretRef(uid).set(
    { uid, refresh_token: refreshToken, scope, linked_at: new Date().toISOString() } satisfies UserSecret,
    { merge: true },
  );
}

export async function hasWorkspaceLink(uid: string): Promise<boolean> {
  return (await secretRef(uid).get()).exists;
}

/**
 * What this person's grant actually covers.
 *
 * Google returns the scopes it granted, which are not necessarily the ones asked for: a user
 * can decline an individual checkbox, and an older grant made before Drive existed here covers
 * only the calendar. Every caller checks before it acts, so a partial grant degrades one
 * feature rather than producing three confusing failures.
 */
export async function grantedScopes(uid: string): Promise<Set<string>> {
  const snap = await secretRef(uid).get();
  if (!snap.exists) return new Set();
  return new Set(String((snap.data() as UserSecret).scope ?? "").split(/\s+/).filter(Boolean));
}

export async function hasScope(uid: string, scope: string): Promise<boolean> {
  return (await grantedScopes(uid)).has(scope);
}

export async function forgetRefreshToken(uid: string): Promise<void> {
  tokenCache.delete(uid);
  await secretRef(uid).delete();
}

/**
 * Clear the member document's record that Workspace is linked.
 *
 * Separate from the token because they live in different places for a good reason — the token
 * is at /user_secrets/{uid} where no colleague can reach it, the flag is on the member where
 * the UI can — and because the two drift the moment one is cleared without the other. Never
 * throws: a member row that is briefly out of date is a cosmetic problem, and an unlink that
 * failed because a document was missing would leave the token behind, which is not.
 */
export async function unlinkMember(tenantId: string, uid: string): Promise<void> {
  try {
    await adminDb()
      .collection("tenants").doc(tenantId).collection("members").doc(uid)
      .set({ calendar: { linked: false, linked_at: null, calendar_id: "primary" },
             workspace: { linked: false, linked_at: null, scopes: [] } },
           { merge: true });
  } catch {
    // Nothing to do. The token is what grants access, and it is already gone.
  }
}

/** Record on the member THAT a link exists. Never the token. */
export async function linkMember(tenantId: string, uid: string, scope: string): Promise<void> {
  const now = new Date().toISOString();
  const scopes = scope.split(/\s+/).filter(Boolean);
  await adminDb()
    .collection("tenants").doc(tenantId).collection("members").doc(uid)
    .set({
      workspace: { linked: true, linked_at: now, scopes },
      // The old shape, still written, because the member document is read by two surfaces and
      // an Android build in the field does not update the moment this deploys.
      calendar: { linked: scopes.includes(CALENDAR_SCOPE), linked_at: now, calendar_id: "primary" },
    }, { merge: true });
}

/** Raised when Google says slow down. The caller leaves the work for the next sweep. */
export class RateLimited extends Error {
  // Declared and assigned rather than written as a constructor parameter property. Node's
  // strip-only TypeScript — which is what `scripts/smoke.sh` runs the suites under — refuses
  // `constructor(public x)` outright, so the shorthand made this file unloadable by every test
  // that imports anything downstream of it. It cost nothing here and it costs a suite.
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("Google rate limit");
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Access tokens, cached for the life of one sweep.
 *
 * A refresh-token exchange is a network round trip to Google, and it used to happen once per
 * calendar write. Now three APIs want a token for the same person in the same pass — a sweep
 * over forty tasks would pay for a hundred and twenty exchanges to get the same string back
 * every time. Google issues these with an hour of life; sixty seconds is far short of that, so
 * a token revoked mid-sweep still stops working almost immediately.
 *
 * In-process, so it dies with the container and is never shared between tenants by accident.
 */
const tokenCache = new Map<string, { token: string; until: number }>();
const TOKEN_TTL_MS = 60_000;

export async function accessTokenFor(uid: string): Promise<string | null> {
  const hit = tokenCache.get(uid);
  if (hit && hit.until > Date.now()) return hit.token;

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
  if (!body.access_token) return null;

  tokenCache.set(uid, { token: body.access_token, until: Date.now() + TOKEN_TTL_MS });
  return body.access_token;
}

/** Only for tests, which must not see one test's token in the next test's cache. */
export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * One place that knows what a Google error means.
 *
 * 403 and 429 are the burst — forty tasks all due at 09:00 arrive as forty writes — and they
 * are the only status worth interrupting a caller for, because they are the only one where
 * trying the same thing later is the right answer. Everything else is reported by returning
 * the response and letting the caller decide, because "the folder was deleted" and "the sheet
 * was renamed" are not the same problem and must not produce the same log line.
 */
export async function googleFetch(
  url: string, token: string, init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 403 || response.status === 429) {
    const retry = Number(response.headers.get("retry-after") ?? "60");
    throw new RateLimited(Number.isFinite(retry) ? retry * 1000 : 60_000);
  }
  return response;
}
