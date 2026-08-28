// Is this person connected, and to what?
//
// Its own route because the connect route answers with a REDIRECT to Google's consent screen,
// and a surface that wanted to render "Connected" would have had to start a consent flow to
// find out. Asking a question must not be an act.
//
// Returns the granted scopes rather than a boolean. A grant is not all-or-nothing — somebody
// may untick Drive on the consent screen, and an account linked back when the calendar was the
// only scope holds a token that cannot write a record — so a surface that offers a feature can
// check for the scope that feature needs.

import { NextResponse } from "next/server";
import { requireSession } from "@/auth/session";
import { WORKSPACE_SCOPES, grantedScopes } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch {
    // Not an error to render. A signed-out visitor is simply not connected, and the settings
    // screen is reachable without an account.
    return NextResponse.json({ linked: false, scopes: [], missing: [...WORKSPACE_SCOPES] });
  }

  const held = await grantedScopes(session.uid);
  const missing = WORKSPACE_SCOPES.filter((s) => !held.has(s));
  return NextResponse.json({
    linked: held.size > 0,
    complete: missing.length === 0,
    scopes: [...held],
    missing,
    configured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
  });
}
