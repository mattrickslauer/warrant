// Where Google sends the technician back.
//
// The refresh token that arrives here is stored at /user_secrets/{uid} — a top-level root
// with `allow read, write: if false`, reachable only by the Admin SDK. It cannot live under
// /tenants/{t}/** because the recursive read there would hand every colleague a token that
// writes to this person's calendar and drafts mail from their account.

import { NextResponse } from "next/server";
import { requireSession } from "@/auth/session";
import { WORKSPACE_SCOPE, WORKSPACE_STATE_COOKIE, storeRefreshToken,
         linkMember } from "@/server/workspace";
import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";

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
    // Declining is a legitimate answer. Push notifications still reach them, and every task
    // is still waiting in the app.
    return NextResponse.redirect(new URL("/settings?workspace=declined", request.url));
  }
  if (!code) {
    return NextResponse.json({ error: "No authorisation code." }, { status: 400 });
  }
  // The linkage that makes this safe: the flow must have been STARTED BY THIS BROWSER.
  //
  // This once compared `state` against `session.uid`, which is not a secret — it is stable and
  // visible to colleagues — so the check passed for any callback an attacker could get the
  // victim to load, and the attacker's own `code` would then bind the attacker's account to
  // the victim's. The nonce is set httpOnly by the start route and cleared here, so it is
  // single-use and unforgeable by anyone but this browser.
  const jar = await cookies();
  const expected = jar.get(WORKSPACE_STATE_COOKIE)?.value;
  jar.set({ name: WORKSPACE_STATE_COOKIE, value: "", path: "/", maxAge: 0 });
  if (!expected || !state || state.length < 32 || !timingSafeEqualStr(state, expected)) {
    return NextResponse.json({ error: "This callback does not belong to this session." }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  // The redirect URI in a code exchange must be byte-identical to the one that started the
  // flow. `url.pathname` rather than a hardcoded path, so the legacy /api/auth/calendar/callback
  // route — which forwards here — exchanges against the URI Google actually redirected to.
  const redirect = process.env.GOOGLE_OAUTH_REDIRECT_URI
    ?? new URL(url.pathname, request.url).toString();
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Workspace is not configured." }, { status: 503 });
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
    return NextResponse.redirect(new URL("/settings?workspace=no_refresh_token", request.url));
  }

  // WHAT GOOGLE GRANTED, never what we asked for. A user may untick an individual permission
  // on the consent screen, and a grant recorded as complete when it is not produces three
  // features that fail at the moment they are needed instead of one honest "not connected".
  const scope = body.scope ?? WORKSPACE_SCOPE;
  await storeRefreshToken(session.uid, body.refresh_token, scope);
  await linkMember(session.tenant.id, session.uid, scope);

  return NextResponse.redirect(new URL("/settings?workspace=linked", request.url));
}

/** Constant time, and length-safe: timingSafeEqual throws on a mismatch, which is its own oracle. */
function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
