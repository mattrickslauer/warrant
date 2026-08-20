// Where to send a push.
//
// `/tenants/{t}/devices` is client-writable on purpose: an FCM token is refreshed by the
// device, not by a server, and it is not a privilege. It lives here rather than under
// `members` because `members` is server-written — the general pattern is that when part of a
// concept must be client-writable it becomes its own collection rather than a subcollection
// of a protected one.
//
// This route exists so the token is written against a VERIFIED session rather than whatever
// uid a client claims.

import { NextResponse } from "next/server";
import { adminDb } from "@/auth/admin";
import { requireSession } from "@/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { install_id?: string; fcm_token?: string; platform?: string; app_version?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { install_id, fcm_token } = body;
  if (!install_id || !fcm_token) {
    return NextResponse.json({ error: "install_id and fcm_token are required." }, { status: 400 });
  }

  await adminDb()
    .collection("tenants").doc(session.tenant.id)
    .collection("devices").doc(install_id)
    .set({
      uid: session.uid,
      fcm_token,
      platform: body.platform === "android" ? "android" : "web",
      app_version: body.app_version ?? null,
      last_seen_at: new Date().toISOString(),
    }, { merge: true });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const installId = new URL(request.url).searchParams.get("install_id");
  if (!installId) return NextResponse.json({ error: "install_id is required." }, { status: 400 });

  await adminDb()
    .collection("tenants").doc(session.tenant.id)
    .collection("devices").doc(installId)
    .delete();

  return NextResponse.json({ ok: true });
}
