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
import { requireSession } from "@/auth/session";
import { CALENDAR_SCOPE, hasCalendarLink, forgetRefreshToken } from "@/server/calendar";

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
  // The uid is carried in `state` and checked against the session on the way back, so a
  // callback cannot attach somebody else's calendar to this account.
  url.searchParams.set("state", session.uid);

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
  return NextResponse.json({ linked: false });
}
