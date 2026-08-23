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
  // A DOCUMENT ID, checked rather than trusted.
  //
  // `.doc()` takes a PATH, so an install_id containing slashes writes somewhere else entirely:
  // `x/readings/y` lands at /tenants/{t}/devices/x/readings/y, which is a `readings` collection
  // nested one level down. firestore.rules warns about exactly this shape — a `{document=**}`
  // wildcard binds to the OUTER collection name, so a nested collection escapes the
  // server-written list — and the way to not depend on that subtlety is to not let an id from a
  // request body become a path in the first place.
  if (!isDocumentId(install_id)) {
    return NextResponse.json({ error: "install_id is not a valid device id." }, { status: 400 });
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
  if (!isDocumentId(installId)) {
    return NextResponse.json({ error: "install_id is not a valid device id." }, { status: 400 });
  }

  await adminDb()
    .collection("tenants").doc(session.tenant.id)
    .collection("devices").doc(installId)
    .delete();

  return NextResponse.json({ ok: true });
}

/**
 * A Firestore document id and nothing that could escape one.
 *
 * No slashes, so it cannot become a path; not `.` or `..`, which Firestore reserves; and
 * bounded, because an id is an identifier rather than a payload.
 */
function isDocumentId(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(value) && value !== "." && value !== "..";
}
