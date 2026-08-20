// The face on a published record.
//
// Served from the FROZEN copy at published/{publicId}/avatar-{slot}, not from the member's
// current photo and not from lh3.googleusercontent.com. Both of those would make an immutable
// record change: one when somebody updates their profile picture, the other when Google
// retires a URL. A record that quietly rewrites who signed it is not a record.
//
// Indexed by slot rather than uid, because the projection is world-readable and a uid in a
// public URL is a uid in a public document.

import { NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";
import { adminApp, adminDb } from "@/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicId: string; slot: string }> },
) {
  const { publicId, slot } = await params;

  if (!/^\d{1,3}$/.test(slot)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // The capability check, before anything touches storage.
  const snap = await adminDb().collection("records").doc(publicId).get();
  if (!snap.exists || (snap.data() as { revoked?: boolean }).revoked) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const file = getStorage(adminApp()).bucket(bucket).file(`published/${publicId}/avatar-${slot}`);
    const [exists] = await file.exists();
    if (!exists) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const [metadata] = await file.getMetadata();
    const [bytes] = await file.download();

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": metadata.contentType ?? "image/jpeg",
        "cache-control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
}
