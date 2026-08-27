// Who works here, and what they may sign for.
//
// THE HALF OF THE STANDING MODEL THAT WAS NEVER BUILT.
//
// `members.ts` has always had roles, standing derived from them, `mayWaive`, and a `disabled`
// flag that `session.ts` and `bearer.ts` both pay a lookup per request to honour. What it did
// not have was any way to CHANGE any of it: `setRole` had no caller, `listMembers` had no
// caller, and `disabled` was written `false` once when a member was created and never again.
//
// So the first person from a domain to sign in became its owner permanently, nobody could ever
// be promoted to foreman, and the only way to end a departed technician's access was to delete
// their Firebase user by hand in the console. The README's offboarding promise rested on an
// operation the product did not offer, and `mayWaive` consulted a flag nothing could set.
//
// Server-side because `/tenants/{t}/members` is one of the collections firestore.rules refuses
// to every client, and that refusal is the whole point: standing a person can grant themselves
// is not standing.

import { NextResponse } from "next/server";
import { callerSession } from "@/auth/bearer";
import {
  getMember, listMembers, setRole, setDisabled, enabledOwners, canChangeMember,
  type Role,
} from "@/auth/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: Role[] = ["owner", "foreman", "technician", "viewer"];

/** The shop's directory. Every member may see who their colleagues are and what they may sign. */
export async function GET(request: Request) {
  const session = await callerSession(request);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const members = await listMembers(session.tenant.id);
  return NextResponse.json({
    members: members.map((m) => ({
      uid: m.uid,
      display_name: m.display_name,
      email: m.email,
      role: m.role,
      standing: m.standing,
      disabled: m.disabled,
      joined_at: m.joined_at,
      last_seen_at: m.last_seen_at,
      // NOT photo_url, and not the calendar link. A directory answers "who may sign this"; a
      // colleague's Google avatar URL and whether they linked a personal calendar are not part
      // of that question.
    })),
  });
}

interface Body {
  uid?: string;
  role?: Role;
  disabled?: boolean;
}

export async function POST(request: Request) {
  const session = await callerSession(request);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!body.uid) return NextResponse.json({ error: "uid is required." }, { status: 400 });
  if (body.role === undefined && body.disabled === undefined) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }
  if (body.role !== undefined && !ROLES.includes(body.role)) {
    return NextResponse.json({ error: `Not a role: ${body.role}` }, { status: 400 });
  }

  const tenantId = session.tenant.id;

  const [actor, target] = await Promise.all([
    getMember(tenantId, session.uid),
    getMember(tenantId, body.uid),
  ]);

  // The owners are only counted when the change could actually cost one. It is a collection
  // read, and every ordinary promotion would otherwise pay for it.
  const couldLoseAnOwner = target?.role === "owner" && !target.disabled;
  const owners = couldLoseAnOwner ? await enabledOwners(tenantId) : [];

  const verdict = canChangeMember(actor, target, { role: body.role, disabled: body.disabled }, owners);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: verdict.status });
  }

  // Role first: if both are being set, a member being enabled AND promoted should not spend an
  // instant enabled at their old standing.
  if (body.role !== undefined) await setRole(tenantId, body.uid, body.role);
  if (body.disabled !== undefined) await setDisabled(tenantId, body.uid, body.disabled);

  const updated = await getMember(tenantId, body.uid);
  return NextResponse.json({
    uid: body.uid,
    role: updated?.role,
    standing: updated?.standing,
    disabled: updated?.disabled,
    // Said back plainly, because disabling somebody is the one act here with an immediate
    // consequence for a person mid-shift: both session paths check revocation every request.
    ...(body.disabled === true
      ? { note: "Their access ends on their next request, on both the web and the handset." }
      : {}),
  });
}
