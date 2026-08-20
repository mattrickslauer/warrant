// POST   — exchange a Firebase ID token for a session cookie, resolving the tenant.
// DELETE — sign out.
//
// The interesting work is the `hd` exchange described in auth/google-hd.ts. It costs one
// extra round trip on the FIRST sign-in of a Workspace account and none thereafter, because
// the custom claim persists on the user record.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth } from "@/auth/admin";
import { verifyGoogleIdToken, googleSubOf } from "@/auth/google-hd";
import { ensureTenant } from "@/auth/provision";
import { ensureMember } from "@/auth/members";
import { mintSessionCookie, sessionCookieOptions, toSession, verifyIdToken, SESSION_COOKIE } from "@/auth/session";
import { normaliseHd, tenantFromClaims } from "@/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  idToken?: string;
  /** Google's own ID token from GoogleAuthProvider.credentialFromResult(). Carries `hd`. */
  googleIdToken?: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!body.idToken) {
    return NextResponse.json({ error: "idToken is required." }, { status: 400 });
  }

  let decoded;
  try {
    decoded = await verifyIdToken(body.idToken);
  } catch {
    return NextResponse.json({ error: "ID token is not valid." }, { status: 401 });
  }

  const currentHd = normaliseHd((decoded as { hd?: string }).hd);

  // --- The hd exchange -----------------------------------------------------------------
  // Only attempted when the client supplied Google's own token. Without it a Workspace user
  // is indistinguishable from a consumer one, so they land in a solo tenant — wrong, but
  // safe, and self-correcting the moment a proper sign-in supplies the token.
  if (body.googleIdToken) {
    let identity;
    try {
      identity = await verifyGoogleIdToken(body.googleIdToken);
    } catch {
      return NextResponse.json({ error: "Google ID token is not valid." }, { status: 401 });
    }

    // The linkage that makes this safe: the Google token must belong to the same Google
    // account as the Firebase user. Without this check a valid token from any Google account
    // would let a caller assert somebody else's hosted domain.
    const linkedSub = googleSubOf(decoded.firebase?.identities);
    if (!linkedSub || linkedSub !== identity.sub) {
      return NextResponse.json(
        { error: "Google token does not belong to this user." },
        { status: 401 },
      );
    }

    if (identity.hd !== currentHd) {
      const existing = (await adminAuth().getUser(decoded.uid)).customClaims ?? {};
      await adminAuth().setCustomUserClaims(decoded.uid, { ...existing, hd: identity.hd });
      // The claim is on the user record but not in the token we were handed. The client has
      // to refresh before Firestore rules will see it, and it re-POSTs when it has.
      return NextResponse.json({ needsRefresh: true }, { status: 202 });
    }
  }

  const tenant = tenantFromClaims({
    uid: decoded.uid,
    hd: currentHd,
    sign_in_provider: decoded.firebase?.sign_in_provider ?? null,
  });

  await ensureTenant(tenant);

  // Who they are, not just which tenant they land in. Called on EVERY sign-in rather than the
  // first: profile fields drift, the Google avatar URL rotates, and a member document written
  // once is wrong within a month. Role is assigned on creation and never touched again here.
  //
  // Failure here must not block sign-in. A member row is recoverable on the next request; a
  // technician locked out of the workshop because a bucket was unreachable is not.
  try {
    await ensureMember(tenant, {
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: decoded.email_verified ?? false,
      displayName: (decoded.name as string | undefined) ?? null,
      photoUrl: (decoded.picture as string | undefined) ?? null,
    });
  } catch (error) {
    console.error("ensureMember failed; sign-in continues", error);
  }

  const cookie = await mintSessionCookie(body.idToken);
  const jar = await cookies();
  jar.set({ ...sessionCookieOptions(), value: cookie });

  return NextResponse.json({ session: toSession(decoded), needsRefresh: false });
}

export async function DELETE() {
  const jar = await cookies();
  jar.set({ ...sessionCookieOptions(), value: "", maxAge: 0 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE)?.value;
  if (!cookie) return NextResponse.json({ session: null });
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    return NextResponse.json({ session: toSession(decoded) });
  } catch {
    return NextResponse.json({ session: null });
  }
}
