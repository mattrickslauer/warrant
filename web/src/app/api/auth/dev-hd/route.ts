// The Workspace branch, exercisable from a consumer account.
//
// The `hd` claim is what turns a person into an enterprise, and testing that branch normally
// requires owning a Google Workspace domain. This route writes the same custom claim the
// real exchange writes, from the same code path, so everything downstream — the session, the
// tenant document, and crucially firestore.rules, which reads request.auth.token.hd — sees a
// genuine Workspace user. Nothing is special-cased anywhere else in the system.
//
// Fenced three ways: it 404s unless WARRANT_DEV_AUTH=1, it refuses to exist in a production
// build, and it only ever acts on the caller's own already-authenticated uid.

import { NextResponse } from "next/server";
import { adminAuth } from "@/auth/admin";
import { ensureTenant } from "@/auth/provision";
import { mintSessionCookie, sessionCookieOptions, verifyIdToken } from "@/auth/session";
import { normaliseHd, tenantFromClaims } from "@/auth/tenant";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function enabled(): boolean {
  return process.env.WARRANT_DEV_AUTH === "1" && process.env.NODE_ENV !== "production";
}

export async function POST(request: Request) {
  if (!enabled()) return new NextResponse(null, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { idToken?: string; hd?: string | null };
  if (!body.idToken) return NextResponse.json({ error: "idToken is required." }, { status: 400 });

  let decoded;
  try {
    decoded = await verifyIdToken(body.idToken);
  } catch {
    return NextResponse.json({ error: "ID token is not valid." }, { status: 401 });
  }

  // null clears it, which is how you get back to the solo-tenant branch.
  const hd = body.hd === null ? null : normaliseHd(body.hd);
  // `body.hd &&` has already excluded null, so the third clause could never fire.
  if (body.hd && !hd) {
    return NextResponse.json({ error: `Not a usable hosted domain: ${body.hd}` }, { status: 400 });
  }

  const existing = (await adminAuth().getUser(decoded.uid)).customClaims ?? {};
  await adminAuth().setCustomUserClaims(decoded.uid, { ...existing, hd });

  const tenant = tenantFromClaims({
    uid: decoded.uid,
    hd,
    sign_in_provider: decoded.firebase?.sign_in_provider ?? null,
  });
  await ensureTenant(tenant);

  // The caller must refresh its ID token before Firestore rules will honour the new claim.
  return NextResponse.json({ tenant, needsRefresh: true });
}

/** Re-mint the session cookie once the client has refreshed and carries the new claim. */
export async function PUT(request: Request) {
  if (!enabled()) return new NextResponse(null, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { idToken?: string };
  if (!body.idToken) return NextResponse.json({ error: "idToken is required." }, { status: 400 });

  const decoded = await verifyIdToken(body.idToken).catch(() => null);
  if (!decoded) return NextResponse.json({ error: "ID token is not valid." }, { status: 401 });

  const cookie = await mintSessionCookie(body.idToken);
  const jar = await cookies();
  jar.set({ ...sessionCookieOptions(), value: cookie });

  return NextResponse.json({
    tenant: tenantFromClaims({
      uid: decoded.uid,
      hd: normaliseHd((decoded as { hd?: string }).hd),
      sign_in_provider: decoded.firebase?.sign_in_provider ?? null,
    }),
  });
}
