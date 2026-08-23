// Linking a calendar. INCREMENTAL consent, deliberately.
//
// Signing in stays one clean consent screen asking for identity and nothing else. The
// technician is asked for their calendar the first time they actually receive a dated task —
// consent asked for at the moment it is needed is consent that means something, and a
// sign-in screen listing scopes the product has not yet used is how people learn to click
// through them.
//
// The scope is calendar.events and nothing more. Warrant writes events and never reads them
// back, so asking for a read scope we do not use would be asking for access we cannot
// justify.

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireSession } from "@/auth/session";
import { CALENDAR_SCOPE, CALENDAR_STATE_COOKIE, hasCalendarLink, forgetRefreshToken,
         unlinkMember } from "@/server/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function redirectUri(request: Request): string {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI
    ?? new URL("/api/auth/calendar/callback", request.url).toString();
}

/** Start the consent flow. */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Calendar is not configured on this deployment." }, { status: 503 });
  }

  if (await hasCalendarLink(session.uid)) {
    return NextResponse.json({ linked: true });
  }

  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALENDAR_SCOPE);
  // Without both of these Google returns an access token and no refresh token, and the link
  // silently stops working an hour later — which looks like a bug in the sweep.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("login_hint", session.email ?? "");

  // A RANDOM, SINGLE-USE STATE — not the uid, which is what this used to send.
  //
  // `state` is a CSRF token, and a CSRF token has to be unguessable to the attacker and known
  // to this browser. The uid is neither: it is stable, it is visible to every colleague in the
  // tenant, and the callback's `state === session.uid` check therefore passes for ANY request
  // that reaches it in the victim's browser. So an attacker could start their own consent
  // flow, take their own `code`, and get the victim to load
  // `/api/auth/calendar/callback?code=<attacker's>&state=<victim's uid>` — the check passes,
  // and the ATTACKER's refresh token is stored as the victim's calendar link. Every task the
  // sweep schedules, with its title and detail, lands on the attacker's calendar.
  //
  // The nonce is held in an httpOnly cookie the attacker cannot read or set, so the callback
  // is comparing something only this browser could have.
  const state = randomBytes(32).toString("base64url");
  const jar = await cookies();
  jar.set({
    name: CALENDAR_STATE_COOKIE,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Long enough to read a consent screen, short enough that a stale one is not lying around.
    maxAge: 600,
  });
  url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}

/** Unlink. The token is deleted outright rather than marked inactive. */
export async function DELETE() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  await forgetRefreshToken(session.uid);
  // AND the member document, which is what the UI reads. Deleting only the token left
  // `calendar.linked: true` on the member forever, so the surface reported a link that no
  // longer existed and `/api/auth/calendar` short-circuited with `{ linked: true }` — nobody
  // could re-link. The same drift happens when `accessTokenFor` forgets a token Google has
  // revoked, which is why `unlinkMember` is shared rather than inlined here.
  await unlinkMember(session.tenant.id, session.uid);
  return NextResponse.json({ linked: false });
}
