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
 * The cookie is tried first because it is the common case and costs no round trip; the bearer
 * token is verified against Firebase WITH `checkRevoked`, like the cookie path.
 *
 * It used to be left off, on the argument that "these routes are not the place a revoked
 * session does damage". They are exactly that place. The bearer path is how the phone reaches
 * `/api/adjudicate`, `/api/jobs/seal`, `/api/procedures/seed` and `/api/scoper/turn` — it
 * writes evidence, seals records and wakes the fleet. And the README promises that when an
 * employer disables an account the technician's access ends the same instant; a promise that
 * holds for the browser and not for the handset is not the promise that was made. It costs one
 * lookup, which is what `session.ts` already decided that promise is worth.
 */
export async function callerSession(request: Request): Promise<Session | null> {
  const cookie = await getSession().catch(() => null);
  if (cookie) return cookie;

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  try {
    const decoded = await adminAuth().verifyIdToken(match[1], true);
    return toSession(decoded);
  } catch {
    // An unverifiable token is not an error to report in detail. Saying which part failed
    // tells someone probing exactly how far they got.
    return null;
  }
}
