// Media for a published record.
//
// Every byte is proxied through here rather than served from a signed URL, and that costs
// real money at scale (see specs/2026-08-20-firestore-design.md §14.2). It buys one thing
// that cannot be bought any other way: **unsharing actually revokes.**
//
// A signed URL, once issued, is valid until it expires. Somebody who opened a record last
// week keeps their link working after the shop unshares it, and there is nothing the shop can
// do about it. Here, the check happens on every request — if /records/{publicId} is gone or
// marked revoked, the image stops resolving immediately.
//
// The bucket itself stays private. storage.rules grants nothing to an unauthenticated caller,
// and this handler reads under Admin credentials after it has checked the capability.

import { NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { adminApp, adminDb } from "@/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicId: string; captureId: string }> },
) {
  const { publicId, captureId } = await params;

  // The capability check, on every single request. This is the whole security model of the
  // endpoint and it deliberately comes before anything touches storage.
  const snap = await adminDb().collection("records").doc(publicId).get();
  if (!snap.exists || (snap.data() as { revoked?: boolean }).revoked) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) return NextResponse.json({ error: "No media store." }, { status: 404 });

  // The capture id is a Firestore document id and cannot contain a slash, but it arrives from
  // a URL, so it is checked rather than trusted. A traversal here would read any object in
  // the bucket with the credentials of a service account.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(captureId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const record = snap.data() as { media_prefix?: string };
  const prefix = record.media_prefix ?? `published/${publicId}`;

  try {
    const file = getStorage(adminApp()).bucket(bucketName).file(`${prefix}/${captureId}`);
    const [exists] = await file.exists();
    if (!exists) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const [metadata] = await file.getMetadata();
    const [bytes] = await file.download();

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": metadata.contentType ?? "application/octet-stream",
        // Short. A long cache would outlive a revocation in the reader's browser, which is
        // the exact failure the proxy exists to prevent.
        "cache-control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
}
