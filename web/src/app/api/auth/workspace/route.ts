// Linking Workspace. INCREMENTAL consent, deliberately.
//
// Signing in stays one clean consent screen asking for identity and nothing else. The
// Workspace grant is asked for from Settings, by somebody who has gone looking for it —
// consent asked for at the moment it is wanted is consent that means something, and a sign-in
// screen listing scopes the product has not yet used is how people learn to click through
// them.
//
// ONE grant covering three APIs rather than three separate flows. Warrant asks for the
// calendar, drafts and its own files together because they are one feature — "Workspace is
// where the answers turn up" — and because three consent screens spread across three moments
// is not more informed consent, it is the same consent with worse odds of being finished.
//
// Every scope is a WRITE scope for a thing Warrant creates. There is no read scope in the set:
// it cannot read a calendar, cannot read a mailbox, and cannot see a file it did not make.
// See WORKSPACE_SCOPES in server/workspace.ts.

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireSession } from "@/auth/session";
import { WORKSPACE_SCOPE, WORKSPACE_STATE_COOKIE, hasWorkspaceLink, grantedScopes,
         forgetRefreshToken, unlinkMember } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Where Google sends them back.
 *
 * `GOOGLE_OAUTH_REDIRECT_URI` wins when set, because a redirect URI has to match what is
 * registered in the Cloud console CHARACTER FOR CHARACTER — a deployment whose console still
 * names the old `/api/auth/calendar/callback` keeps working, and that path is still served.
 */
function redirectUri(request: Request): string {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI
    ?? new URL("/api/auth/workspace/callback", request.url).toString();
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
    return NextResponse.json({ error: "Workspace is not configured on this deployment." }, { status: 503 });
  }

  // A link that predates a scope is not a link. An account granted only the calendar, back when
  // that was all Warrant asked for, must be able to come back through here and pick up Drive
  // and Gmail — so the short-circuit tests the SCOPES, not merely the presence of a token.
  if (await hasWorkspaceLink(session.uid)) {
    const held = await grantedScopes(session.uid);
    const missing = WORKSPACE_SCOPE.split(" ").filter((s) => !held.has(s));
    if (missing.length === 0) {
      return NextResponse.json({ linked: true, scopes: [...held] });
    }
  }

  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", WORKSPACE_SCOPE);
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
  // tenant, and a `state === session.uid` check therefore passes for ANY request that reaches
  // the callback in the victim's browser. So an attacker could start their own consent flow,
  // take their own `code`, and get the victim to load the callback with it — the check passes,
  // and the ATTACKER's refresh token is stored as the victim's link. Every task the sweep
  // schedules would land on the attacker's calendar, and every drafted order in their mailbox.
  //
  // The nonce is held in an httpOnly cookie the attacker cannot read or set, so the callback
  // is comparing something only this browser could have.
  const state = randomBytes(32).toString("base64url");
  const jar = await cookies();
  jar.set({
    name: WORKSPACE_STATE_COOKIE,
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
  // `linked: true` on the member forever, so the surface reported a link that no longer
  // existed and the route above short-circuited — nobody could re-link. The same drift happens
  // when `accessTokenFor` forgets a token Google has revoked, which is why `unlinkMember` is
  // shared rather than inlined here.
  await unlinkMember(session.tenant.id, session.uid);
  return NextResponse.json({ linked: false });
}
