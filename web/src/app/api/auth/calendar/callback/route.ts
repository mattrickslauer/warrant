// Where Google sends the technician back.
//
// The refresh token that arrives here is stored at /user_secrets/{uid} — a top-level root
// with `allow read, write: if false`, reachable only by the Admin SDK. It cannot live under
// /tenants/{t}/** because the recursive read there would hand every colleague a token that
// writes to this person's calendar.

import { NextResponse } from "next/server";
import { requireSession } from "@/auth/session";
import { CALENDAR_SCOPE, storeRefreshToken } from "@/server/calendar";
import { adminDb } from "@/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error")) {
    // Declining is a legitimate answer. Push notifications still reach them.
    return NextResponse.redirect(new URL("/?calendar=declined", request.url));
  }
  if (!code) {
    return NextResponse.json({ error: "No authorisation code." }, { status: 400 });
  }
  // The linkage that makes this safe: the flow must have been started by the account that is
  // finishing it. Without this check a crafted callback could attach an attacker's calendar.
  if (state !== session.uid) {
    return NextResponse.json({ error: "This callback does not belong to this session." }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirect = process.env.GOOGLE_OAUTH_REDIRECT_URI
    ?? new URL("/api/auth/calendar/callback", request.url).toString();
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Calendar is not configured." }, { status: 503 });
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirect, grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Google refused the code exchange." }, { status: 502 });
  }

  const body = (await response.json()) as { refresh_token?: string; scope?: string };
  if (!body.refresh_token) {
    // Google withholds it when the user has consented before. `prompt=consent` on the way out
    // is what prevents this, so reaching here means that parameter was lost.
    return NextResponse.redirect(new URL("/?calendar=no_refresh_token", request.url));
  }

  await storeRefreshToken(session.uid, body.refresh_token, body.scope ?? CALENDAR_SCOPE);

  // The member document records THAT the calendar is linked. Never the token.
  await adminDb()
    .collection("tenants").doc(session.tenant.id)
    .collection("members").doc(session.uid)
    .set({ calendar: { linked: true, linked_at: new Date().toISOString(), calendar_id: "primary" } },
         { merge: true });

  return NextResponse.redirect(new URL("/?calendar=linked", request.url));
}
