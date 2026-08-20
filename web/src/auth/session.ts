import "server-only";

// The server's view of who is signed in.
//
// The browser holds a Firebase ID token, which is short-lived and refreshed by the client
// SDK. The server holds a session cookie minted from it, which is httpOnly and therefore
// readable during server rendering without a round trip to the client. Both describe the
// same user; the cookie is what lets a server component know the tenant before it renders.

import { cookies } from "next/headers";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "./admin";
import { tenantFromClaims, type TenantRef } from "./tenant";

export const SESSION_COOKIE = "warrant_session";

/** Five days. Long enough that a technician is not signed out mid-shift. */
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export interface Session {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  tenant: TenantRef;
  /** True when this session belongs to an unclaimed anonymous visitor. */
  anonymous: boolean;
}

function toSession(decoded: DecodedIdToken): Session {
  const provider = decoded.firebase?.sign_in_provider ?? null;
  const tenant = tenantFromClaims({
    uid: decoded.uid,
    hd: (decoded as DecodedIdToken & { hd?: string }).hd ?? null,
    sign_in_provider: provider,
  });
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    name: (decoded.name as string | undefined) ?? null,
    picture: (decoded.picture as string | undefined) ?? null,
    tenant,
    anonymous: provider === "anonymous",
  };
}

/** Mint a session cookie from a Firebase ID token the caller has already obtained. */
export async function mintSessionCookie(idToken: string): Promise<string> {
  return adminAuth().createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  };
}

/**
 * The current session, or null.
 *
 * `checkRevoked` is deliberately on. The README promises that when an employer disables an
 * account the technician's access ends the same instant, and that promise is only true if
 * every request re-checks revocation rather than trusting the cookie's own expiry. It costs
 * one lookup per request and buys the offboarding story.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    return toSession(decoded);
  } catch {
    // Expired, revoked, or forged. All three mean "not signed in".
    return null;
  }
}

/**
 * The tenant every server-side Firestore call must be scoped to.
 *
 * This is the ONLY sanctioned source of a tenant id on the server. Admin credentials bypass
 * firestore.rules, so a tenant read from a request body would be a straight tenancy bypass —
 * which is why no such path exists.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  return session;
}

/** Verify a raw ID token, for route handlers that receive one directly. */
export async function verifyIdToken(idToken: string): Promise<DecodedIdToken> {
  return adminAuth().verifyIdToken(idToken, true);
}

export { toSession };

/**
 * The session, or null, without ever throwing.
 *
 * Server components call this. The product is required to render with no Google Cloud
 * project at all — that is the whole point of the fixture path — so an absent Admin
 * credential, an unreachable metadata server and a missing project id are all ordinary
 * states here rather than errors.
 */
export async function getSessionSafe(): Promise<Session | null> {
  try {
    const { adminConfigured } = await import("./admin");
    if (!adminConfigured()) return null;
    return await getSession();
  } catch {
    return null;
  }
}
