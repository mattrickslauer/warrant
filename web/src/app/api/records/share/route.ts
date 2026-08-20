// Share a sealed record, or take it back.
//
// Sharing is a deliberate act by a named person, never a property of a tenant. The old
// contract restricted `public` to anon and demo tenants; a capability URL makes that
// unnecessary — any shop can hand a customer a link to their own service record, and take it
// back later.
//
// The tenant comes from the verified session cookie and NOTHING else. Admin credentials
// bypass firestore.rules, so a tenant read from the request body would be a straight tenancy
// bypass — which is why no such path exists.

import { NextResponse } from "next/server";
import { requireSession } from "@/auth/session";
import { getMember } from "@/auth/members";
import { publishRecord, revokeRecord, NotPublishable } from "@/server/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { job_id?: string; share?: boolean };
  try {
    body = (await request.json()) as { job_id?: string; share?: boolean };
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!body.job_id) {
    return NextResponse.json({ error: "job_id is required." }, { status: 400 });
  }

  // Publishing a record puts a shop's name and a technician's face on the open internet.
  // A viewer must not be able to do that, and a disabled account must not be able to do
  // anything at all.
  const member = await getMember(session.tenant.id, session.uid);
  if (!member || member.disabled || member.role === "viewer") {
    return NextResponse.json({ error: "You do not have standing to share records." }, { status: 403 });
  }

  if (body.share === false) {
    await revokeRecord(session.tenant.id, body.job_id);
    return NextResponse.json({ shared: false });
  }

  try {
    const { publicId } = await publishRecord(session.tenant.id, body.job_id, session.uid);
    return NextResponse.json({ shared: true, public_id: publicId, url: `/r/${publicId}` });
  } catch (error) {
    if (error instanceof NotPublishable) {
      // Say WHY. "Could not publish" sends someone hunting; "capture X has not been redacted"
      // tells them what has to happen first.
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
