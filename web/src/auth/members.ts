import "server-only";

// Who the people are.
//
// There is no invite flow and no organisation wizard, for the same reason there is no tenant
// wizard: the directory already exists on Google's side. The first person from acme.com to
// sign in creates the acme.com tenant AND becomes its owner; the second joins as a technician
// by simply being from acme.com.
//
// This file is server-only and writes through the Admin SDK because `/tenants/{t}/members` is
// one of the collections firestore.rules refuses to a client. That refusal is the point: role
// and standing decide who may waive a step, and standing a person can grant themselves is not
// standing. See specs/2026-08-20-firestore-design.md §4.

import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { adminDb, adminApp } from "./admin";
import type { TenantRef } from "./tenant";

export type Role = "owner" | "foreman" | "technician" | "viewer";

export interface Standing {
  /** May waive a step required at or below this strictness. -1 waives nothing. */
  may_waive_to_strictness: number;
  /** May approve a drafted purchase order. A PO is drafted, never sent. */
  may_approve_orders: boolean;
  may_publish_procedures: boolean;
}

export interface MemberDoc {
  schema_version: number;
  uid: string;
  tenant_id: string;
  email: string | null;
  email_verified: boolean;
  display_name: string | null;
  photo_url: string | null;
  photo_ref: string | null;
  photo_fetched_at: string | null;
  role: Role;
  standing: Standing;
  joined_at: string;
  last_seen_at: string;
  disabled: boolean;
  calendar: { linked: boolean; linked_at: string | null; calendar_id: string } | null;
}

export const SCHEMA_VERSION = 1;

/**
 * What each role may do.
 *
 * Deliberately the whole model. A role hierarchy nobody can escalate into is worth more than
 * a rich one anybody can, and every extra rung is another thing to get wrong in a rule.
 */
export function standingFor(role: Role): Standing {
  switch (role) {
    case "owner":
      return { may_waive_to_strictness: 3, may_approve_orders: true, may_publish_procedures: true };
    case "foreman":
      return { may_waive_to_strictness: 2, may_approve_orders: true, may_publish_procedures: true };
    case "technician":
      return { may_waive_to_strictness: 1, may_approve_orders: false, may_publish_procedures: false };
    case "viewer":
      return { may_waive_to_strictness: -1, may_approve_orders: false, may_publish_procedures: false };
  }
}

/** A stated reason is asserted by a named person; a waiver needs standing to match. */
export function mayWaive(member: Pick<MemberDoc, "standing" | "disabled">, strictness: number): boolean {
  return !member.disabled && member.standing.may_waive_to_strictness >= strictness;
}

export interface IdentityInput {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  /** Google's `picture` claim, straight off the verified token. */
  photoUrl: string | null;
}

/**
 * Is this a URL Google serves profile photos from?
 *
 * Exact suffix match on a registrable domain, with the leading dot required — `endsWith` alone
 * would accept `evilgoogleusercontent.com`, which is a domain anybody can register.
 */
export function isGoogleAvatarUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return host === "googleusercontent.com"
    || host.endsWith(".googleusercontent.com")
    || host === "google.com"
    || host.endsWith(".google.com");
}

/** Google returns a small default. The size hint is a query parameter, not a path segment. */
export function sizedPhotoUrl(raw: string | null, px = 192): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!url.hostname.endsWith("googleusercontent.com")) return raw;
    // lh3 accepts either `=s96-c` appended to the path or an `sz` parameter. The path form is
    // what Google itself emits, so rewrite that when present and fall back to the parameter.
    url.pathname = url.pathname.replace(/=s\d+(-c)?$/, `=s${px}`);
    if (!/=s\d+/.test(url.pathname)) url.searchParams.set("sz", String(px));
    return url.toString();
  } catch {
    return raw;
  }
}

/** Google rotates these URLs when someone changes their photo. Re-copy after this long. */
const PHOTO_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function memberRef(tenantId: string, uid: string) {
  return adminDb().collection("tenants").doc(tenantId).collection("members").doc(uid);
}

/**
 * Ensure `/tenants/{t}/members/{uid}` exists, and return it.
 *
 * Idempotent, and called on every sign-in rather than only the first: profile fields drift,
 * `last_seen_at` is worth having, and a member document that only ever gets written once is a
 * member document that is wrong within a month.
 *
 * Role is assigned ONCE, on creation, and never touched here — re-running this must not
 * silently demote an owner back to technician on their next sign-in.
 */
export async function ensureMember(tenant: TenantRef, identity: IdentityInput): Promise<MemberDoc> {
  const ref = memberRef(tenant.id, identity.uid);
  const snap = await ref.get();
  const now = new Date().toISOString();
  const photoUrl = sizedPhotoUrl(identity.photoUrl);

  if (snap.exists) {
    const existing = snap.data() as MemberDoc;
    const patch: Partial<MemberDoc> = {
      last_seen_at: now,
      email: identity.email,
      email_verified: identity.emailVerified,
      display_name: identity.displayName,
      photo_url: photoUrl,
    };

    // Re-copy the avatar when Google's URL changed, or when ours has gone stale enough that
    // it may have been retired underneath us.
    const stale =
      !existing.photo_ref ||
      existing.photo_url !== photoUrl ||
      !existing.photo_fetched_at ||
      Date.now() - Date.parse(existing.photo_fetched_at) > PHOTO_MAX_AGE_MS;

    if (stale && photoUrl) {
      const ref2 = await copyAvatar(identity.uid, photoUrl);
      if (ref2) {
        patch.photo_ref = ref2;
        patch.photo_fetched_at = now;
      }
    }

    await ref.set(patch, { merge: true });
    return { ...existing, ...patch } as MemberDoc;
  }

  const photoRef = photoUrl ? await copyAvatar(identity.uid, photoUrl) : null;

  // First member of a tenant owns it. This is the entire provisioning model — and it is
  // decided INSIDE a transaction, because it is a read-then-write on a contended key.
  //
  // Two people from the same new domain signing in together both saw an empty collection and
  // both became owner, which hands a second unintended person `may_waive_to_strictness: 3` on
  // the day the tenant is created. Rare, silent, and exactly the kind of thing nobody goes
  // looking for afterwards. The transaction reads the sibling query and the write is
  // contingent on it, so the second signer loses the race and joins as a technician.
  const member = await adminDb().runTransaction(async (tx) => {
    const mine = await tx.get(ref);
    if (mine.exists) return withDefaults(mine.data() as MemberDoc);

    const isFirst = (await tx.get(ref.parent.limit(1))).empty;
    const role: Role = isFirst ? "owner" : "technician";

    const fresh: MemberDoc = {
      schema_version: SCHEMA_VERSION,
      uid: identity.uid,
      tenant_id: tenant.id,
      email: identity.email,
      email_verified: identity.emailVerified,
      display_name: identity.displayName,
      photo_url: photoUrl,
      photo_ref: photoRef,
      photo_fetched_at: photoRef ? now : null,
      role,
      standing: standingFor(role),
      joined_at: now,
      last_seen_at: now,
      disabled: false,
      calendar: null,
    };
    tx.set(ref, { ...fresh, created_at: FieldValue.serverTimestamp() }, { merge: true });
    return fresh;
  });
  return member;
}

/**
 * Take our own copy of the Google profile image.
 *
 * `lh3.googleusercontent.com` URLs rotate when someone changes their photo and can 404
 * outright. A sealed record is supposed to be readable by a stranger years from now, so
 * pointing it at a URL Google may retire is exactly the dangling evidence this product exists
 * to abolish — the record points here instead.
 *
 * Never throws. An absent bucket, an unreachable network and a 404 from Google are all
 * ordinary states: a member without an avatar is fine, a sign-in that fails because of one is
 * not.
 */
export async function copyAvatar(uid: string, photoUrl: string): Promise<string | null> {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) return null;

  // WHERE THE URL IS ALLOWED TO POINT, checked before anything is fetched.
  //
  // `picture` looks like a Google-issued claim and is not one: the Firebase client SDK lets a
  // signed-in user set it to anything with `updateProfile({ photoURL })`, and the value lands
  // in their next ID token. This function then fetched it — server-side, from Cloud Run, with
  // no host restriction, because `sizedPhotoUrl` passes non-Google hosts through unchanged.
  // That is an ordinary authenticated user aiming the server at http://169.254.169.254/ or at
  // anything else inside the perimeter.
  //
  // The docstring already says what this is for — "our copy of the GOOGLE profile image" — so
  // the allowlist is not a restriction on the feature, it is the feature written down.
  if (!isGoogleAvatarUrl(photoUrl)) return null;

  try {
    const response = await fetch(photoUrl, {
      signal: AbortSignal.timeout(5000),
      // A 30x to an internal address would walk straight back out of the allowlist.
      redirect: "error",
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    // Avatars are small. Anything this large is not a profile photo.
    if (bytes.byteLength > 2 * 1024 * 1024) return null;

    const path = `avatars/${uid}`;
    await getStorage(adminApp())
      .bucket(bucketName)
      .file(path)
      .save(bytes, { contentType, resumable: false });

    return `gs://${bucketName}/${path}`;
  } catch {
    return null;
  }
}

/** Every member of a tenant. Used by the sweep to fan a role-assigned task out to a queue. */
export async function listMembers(tenantId: string): Promise<MemberDoc[]> {
  const snap = await adminDb().collection("tenants").doc(tenantId).collection("members").get();
  return snap.docs.map((d) => withDefaults(d.data() as MemberDoc));
}

export async function getMember(tenantId: string, uid: string): Promise<MemberDoc | null> {
  const snap = await memberRef(tenantId, uid).get();
  return snap.exists ? withDefaults(snap.data() as MemberDoc) : null;
}

/** Everyone holding a role, for a task that is still an unclaimed queue item. */
export async function membersWithRole(tenantId: string, role: Role): Promise<MemberDoc[]> {
  const snap = await adminDb()
    .collection("tenants").doc(tenantId).collection("members")
    .where("role", "==", role)
    .get();
  return snap.docs.map((d) => withDefaults(d.data() as MemberDoc)).filter((m) => !m.disabled);
}

/**
 * Promotion. An owner-only act, and the only way a role ever changes.
 *
 * Standing is recomputed from the role rather than passed in, so the two cannot drift apart
 * and nobody can be handed a technician's role with an owner's waiver limit.
 */
export async function setRole(tenantId: string, uid: string, role: Role): Promise<void> {
  await memberRef(tenantId, uid).set(
    { role, standing: standingFor(role), schema_version: SCHEMA_VERSION },
    { merge: true },
  );
}

/**
 * Offboarding, and the thing the README already promised.
 *
 * `session.ts` passes `checkRevoked` on every request and `bearer.ts` does the same for the
 * phone, both so that "when an employer disables an account the technician's access ends the
 * same instant" is true. But `disabled` had NO WRITER — it was set false when a member was
 * created and never touched again — so the only way to actually end someone's access was to
 * delete their Firebase user by hand in the console. A flag that nothing can set is not a
 * control, and `mayWaive` and every standing check read it as though it were one.
 *
 * This does not delete the member. A record names the people who signed it and looks them up
 * years later; removing the document would make an immutable record lose the name on it.
 */
export async function setDisabled(tenantId: string, uid: string, disabled: boolean): Promise<void> {
  await memberRef(tenantId, uid).set(
    { disabled, schema_version: SCHEMA_VERSION },
    { merge: true },
  );
}

/**
 * How many people can still administer this tenant.
 *
 * Used to refuse the change that leaves nobody able to make another one. A tenant whose last
 * owner demotes themselves is not recoverable from inside the product — the first-signer rule
 * in `ensureMember` only fires on an EMPTY member collection, so nobody would ever become owner
 * again — and the tenant's procedures, standing and waivers would be frozen for good.
 */
export async function enabledOwners(tenantId: string): Promise<string[]> {
  return (await listMembers(tenantId))
    .filter((m) => m.role === "owner" && !m.disabled)
    .map((m) => m.uid);
}

export interface MemberChange {
  role?: Role;
  disabled?: boolean;
}

export type ChangeVerdict = { ok: true } | { ok: false; status: number; error: string };

/**
 * May this person make this change to that person? No I/O, so the whole rule is testable.
 *
 * Separated from the route for the same reason `instruments.ts` separates attestation from the
 * endpoint: this is the entire access-control decision for the standing model, and a decision
 * that can only be exercised by standing up a Firestore and an auth session is a decision
 * nobody writes the awkward tests for.
 *
 * `enabledOwnerUids` is passed in rather than read, so the caller decides when to pay for it.
 */
export function canChangeMember(
  actor: Pick<MemberDoc, "uid" | "role" | "disabled"> | null,
  target: Pick<MemberDoc, "uid" | "role" | "disabled"> | null,
  change: MemberChange,
  enabledOwnerUids: string[],
): ChangeVerdict {
  // A disabled owner is not an owner. The flag exists so access ends without the document being
  // deleted; honouring it everywhere except here would make it decorative.
  if (!actor || actor.disabled || actor.role !== "owner") {
    return { ok: false, status: 403, error: "Only an owner can change who works here." };
  }
  if (!target) {
    return { ok: false, status: 404, error: "No such member of this tenant." };
  }
  if (change.role === undefined && change.disabled === undefined) {
    return { ok: false, status: 400, error: "Nothing to change." };
  }
  // Nobody acts on themselves. Not because self-promotion is reachable — the actor is already
  // an owner — but because every way this goes wrong goes wrong through their own document.
  if (actor.uid === target.uid) {
    return { ok: false, status: 409,
             error: "Somebody else has to change your own role or standing." };
  }

  // NEVER THE LAST OWNER. `ensureMember` only makes somebody an owner when the member
  // collection is EMPTY, so a tenant that loses its last one can never grow another from
  // inside the product: nothing could be published and no waiver above a technician's standing
  // could ever be signed again.
  const losingAnOwner = target.role === "owner" && !target.disabled
    && ((change.role !== undefined && change.role !== "owner") || change.disabled === true);
  if (losingAnOwner && enabledOwnerUids.filter((uid) => uid !== target.uid).length === 0) {
    return { ok: false, status: 409,
             error: "This is the only owner left. Promote somebody else first, or this tenant "
                    + "can never be administered again." };
  }
  return { ok: true };
}

/** Read tolerance: a document written before a field existed is still a valid member. */
function withDefaults(m: MemberDoc): MemberDoc {
  return {
    ...m,
    schema_version: m.schema_version ?? 1,
    standing: m.standing ?? standingFor(m.role ?? "technician"),
    disabled: m.disabled ?? false,
    calendar: m.calendar ?? null,
  };
}
