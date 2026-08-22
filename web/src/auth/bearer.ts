import "server-only";

// A session, from a cookie OR a bearer token.
//
// The browser has a session cookie, minted by /api/auth/session and sent automatically. A
// phone has neither a cookie jar nor a reason to want one: it holds a Firebase ID token and
// refreshes it itself. Both are the same claim about the same person, verified the same way,
// so the routes should not care which arrived — and before this existed they did care, which
// meant every call from Android was a 401 that looked like a sign-in bug.
//
// The verification is identical in both directions: the token is checked against Firebase, and
// the tenant is derived from the claims rather than taken from anything the caller said.

import { adminAuth } from "@/auth/admin";
import { getSession, toSession, type Session } from "@/auth/session";

/**
 * Resolve who is calling, or null.
 *
 * The cookie is tried first because it is the common case and costs no round trip; a bearer
 * token is verified against Firebase, with `checkRevoked` left off deliberately — it costs a
 * network call on every request, and these routes are not the place a revoked session does
 * damage. The session-cookie path already checks revocation where it matters.
 */
export async function callerSession(request: Request): Promise<Session | null> {
  const cookie = await getSession().catch(() => null);
  if (cookie) return cookie;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  try {
    const decoded = await adminAuth().verifyIdToken(match[1]);
    return toSession(decoded);
  } catch {
    // An unverifiable token is not an error to report in detail. Saying which part failed
    // tells someone probing exactly how far they got.
    return null;
  }
}
