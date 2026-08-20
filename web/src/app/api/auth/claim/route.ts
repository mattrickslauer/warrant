// Turn an anonymous tenant into a real one.
//
// Called after the client has run linkWithCredential, which upgrades the anonymous Firebase
// user in place. The uid is unchanged, so this route can trust the session cookie it already
// has to say which anonymous tenant is being claimed — the caller never names it.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth } from "@/auth/admin";
import { claimTenant } from "@/auth/claim";
import { verifyGoogleIdToken, googleSubOf } from "@/auth/google-hd";
import { mintSessionCookie, sessionCookieOptions, getSession, verifyIdToken } from "@/auth/session";
import { normaliseHd, tenantFromClaims } from "@/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const before = await getSession();
  if (!before) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!before.anonymous) {
    return NextResponse.json({ error: "This session is not anonymous." }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    idToken?: string;
    googleIdToken?: string;
  };
  if (!body.idToken) return NextResponse.json({ error: "idToken is required." }, { status: 400 });

  const decoded = await verifyIdToken(body.idToken).catch(() => null);
  if (!decoded) return NextResponse.json({ error: "ID token is not valid." }, { status: 401 });

  // What authorises this move, and why it is not a uid equality check.
  //
  // The source is taken from the anonymous SESSION COOKIE, which is httpOnly and was minted
  // from this browser's own anonymous token — holding it is proof of control over that
  // anonymous tenant, and the caller never gets to name the source. The destination comes
  // from a freshly verified ID token, which is proof of control over the account being moved
  // into. Both ends are proven, so the two uids do not have to match.
  //
  // They usually do: linkWithPopup upgrades the anonymous user in place. They differ only on
  // the credential-already-in-use path, where the visitor turns out to have an existing
  // account — and merging their anonymous work into it is exactly the right outcome.

  let hd = normaliseHd((decoded as { hd?: string }).hd);

  if (body.googleIdToken) {
    const identity = await verifyGoogleIdToken(body.googleIdToken).catch(() => null);
    if (!identity) return NextResponse.json({ error: "Google ID token is not valid." }, { status: 401 });

    const linkedSub = googleSubOf(decoded.firebase?.identities);
    if (!linkedSub || linkedSub !== identity.sub) {
      return NextResponse.json({ error: "Google token does not belong to this user." }, { status: 401 });
    }

    if (identity.hd !== hd) {
      const existing = (await adminAuth().getUser(decoded.uid)).customClaims ?? {};
      await adminAuth().setCustomUserClaims(decoded.uid, { ...existing, hd: identity.hd });
      hd = identity.hd;
    }
  }

  // After linking, sign_in_provider on the refreshed token is google.com — but the token in
  // hand may still say anonymous, so the destination is computed from the identity rather
  // than from the provider string.
  const to = tenantFromClaims({ uid: decoded.uid, hd, sign_in_provider: "google.com" });
  const result = await claimTenant(before.tenant, to);

  const cookie = await mintSessionCookie(body.idToken);
  const jar = await cookies();
  jar.set({ ...sessionCookieOptions(), value: cookie });

  return NextResponse.json({ claim: result, tenant: to });
}
