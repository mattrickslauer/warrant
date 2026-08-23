import "server-only";

// Publishing a sealed record to a capability URL.
//
// The private record stays at /tenants/{t}/records/{jobId} and is never readable by anyone
// outside the tenant. Sharing writes a SECOND document — a redacted projection — at
// /records/{publicId}, which firestore.rules makes world-readable and nobody-writable.
//
// Holding the link is the whole credential. That is the point: a customer, an insurer or a
// buyer checks a service record without an account, which is the thing a paper service book
// has always done and every digital replacement has broken.
//
// Unsharing DELETES the projection, and because media is proxied rather than signed, every
// image URL dies with it. A signed URL would outlive the unshare, which is the entire reason
// the proxy exists. See specs/2026-08-20-firestore-design.md §6.

import { randomBytes } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { adminDb, adminApp } from "@/auth/admin";
import { getMember } from "@/auth/members";
import type { SealedRecord, StepOutcome, Decision, Capture } from "@/generated/types";
import { mediaUri } from "@/server/adjudicate/cases";
import { screenText } from "@/server/adjudicate/armor";
import { GoogleAuth } from "google-auth-library";

/** 16 random bytes = 128 bits, which base64url spells in exactly 22 characters. Not derived
 *  from the job id, which is enumerable. */
export function newPublicId(): string {
  return randomBytes(16).toString("base64url");
}

export interface PublicRecord {
  schema_version: number;
  id: string;
  sealed_at: string;
  procedure_title: string;
  procedure_version: number;
  asset_label: string | null;
  issuer: { display_name: string };
  actors: Array<{ display_name: string; avatar: string | null; role: string }>;
  ceiling_tier: string;
  ceiling_reachable: string[];
  ceiling_unreachable: Array<{ class: string; reason: string }>;
  deficiencies: Array<{ step_id: string; status: string; reason: string }>;
  machine_released: boolean;
  steps: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  revoked: boolean;
}

export class NotPublishable extends Error {}

/**
 * Publish, or refuse.
 *
 * The gate is not a formality. A capture that has not been redacted may carry a face or a
 * plate, and one Model Armor flagged may carry an instruction aimed at whatever reads it
 * next. Either reaching a public URL is worse than not publishing at all, so this throws
 * rather than publishing a partially-safe record.
 */
export async function publishRecord(
  tenantId: string, jobId: string, byUid: string,
): Promise<{ publicId: string }> {
  const db = adminDb();
  const tenantRef = db.collection("tenants").doc(tenantId);

  const recordSnap = await tenantRef.collection("records").doc(jobId).get();
  if (!recordSnap.exists) throw new NotPublishable(`No sealed record for job ${jobId}.`);
  const record = recordSnap.data() as SealedRecord;

  const captures = await tenantRef.collection("jobs").doc(jobId).collection("captures").get();
  for (const doc of captures.docs) {
    const capture = doc.data() as Capture;
    if (!capture.redacted) {
      throw new NotPublishable(
        `Capture ${capture.id} has not been redacted. A record is not readable until it is.`,
      );
    }
    if (capture.armor_verdict === "MATCH_FOUND") {
      throw new NotPublishable(
        `Capture ${capture.id} was flagged by Model Armor and must not reach a public URL.`,
      );
    }
  }

  // THE TEXT IS EVIDENCE TOO, and it was the half this gate never looked at.
  //
  // Above, every capture is checked for redaction and for a Model Armor match, because an
  // unredacted photograph on a public URL may carry a face or a plate. Directly below,
  // `redactStep` copies `reason_transcript` and `recommendation_text` onto that same public
  // document verbatim — unbounded free text a technician spoke and a model wrote, screened by
  // nothing. Whatever the argument is for screening the image, it is the same argument.
  //
  // A match refuses the publish rather than redacting silently: a record with a hole in it that
  // nobody was told about is the failure this product exists to abolish.
  const armorToken = await armorAccessToken();
  for (const step of record.steps ?? []) {
    for (const [what, text] of [
      ["stated reason", step.reason_transcript],
      ["recommendation", step.recommendation_text],
    ] as const) {
      if (!text) continue;
      const verdict = await screenText(String(text), armorToken);
      if (verdict.verdict === "MATCH_FOUND") {
        throw new NotPublishable(
          `The ${what} on step ${step.step_id} was flagged by Model Armor and must not reach a ` +
          `public URL. ${verdict.detail}`,
        );
      }
    }
  }

  const publicId = record.public_id ?? newPublicId();
  const tenant = (await tenantRef.get()).data() ?? {};

  // Names and avatars are frozen HERE, not resolved at read time. A record is immutable, so
  // it must not change when someone updates their profile photo or leaves the company —
  // and a bare uid renders as nothing to the stranger this page exists for.
  const actorUids = new Set<string>();
  for (const step of record.steps ?? []) {
    if (step.reason_by) actorUids.add(step.reason_by);
    if (step.waived_by) actorUids.add(step.waived_by);
  }
  const actors: PublicRecord["actors"] = [];
  for (const uid of actorUids) {
    const member = await getMember(tenantId, uid);
    if (!member) continue;
    // Indexed, not keyed by uid. The projection is world-readable, so a uid in an avatar URL
    // is a uid in a public document — and the redaction rule says no uids.
    const slot = actors.length;
    const copied = member.photo_ref
      ? await copyIntoPublished(member.photo_ref, publicId, `avatar-${slot}`)
      : false;
    actors.push({
      display_name: member.display_name ?? "a technician",
      avatar: copied ? `/api/r/${publicId}/avatar/${slot}` : null,
      role: member.role,
    });
  }

  // Freeze the evidence alongside the projection. A published record is a self-contained
  // artifact: the tenant's own bucket prefix stays private and untouched, and revoking
  // deletes this copy outright rather than hoping a URL expires.
  for (const doc of captures.docs) {
    const capture = doc.data() as Capture;
    // The SAME path the adjudicator reads and the client wrote — `{captureId}.{ext}`, built by
    // `mediaUri`. This used to interpolate `capture.media_ref`, which is a different thing
    // entirely: on a photo it is the capture id with no extension, and on an instrument
    // capture it is a READING id, which is not a storage object at all. So the copy silently
    // found nothing (copyIntoPublished swallows a miss by design) and the published record
    // rendered a dead image. One builder, used everywhere, is the only way that stays true.
    if (capture.kind === "text") continue;
    const from = mediaUri(bucketName(), { id: capture.id, kind: capture.kind }, tenantId, jobId);
    await copyIntoPublished(from, publicId, capture.id);
  }

  const projection: PublicRecord = {
    schema_version: 1,
    id: publicId,
    sealed_at: record.sealed_at,
    procedure_title: (record as unknown as { procedure_title?: string }).procedure_title ?? "Procedure",
    procedure_version: (record as unknown as { procedure_version?: number }).procedure_version ?? 1,
    asset_label: (record as unknown as { asset_label?: string }).asset_label ?? null,
    issuer: { display_name: (tenant.display_name as string) ?? tenantId },
    actors,
    ceiling_tier: record.ceiling_tier,
    ceiling_reachable: record.ceiling_reachable ?? [],
    ceiling_unreachable: record.ceiling_unreachable ?? [],
    deficiencies: record.deficiencies ?? [],
    machine_released: record.machine_released,
    steps: (record.steps ?? []).map(redactStep),
    decisions: (record.decisions ?? []).map((d) => redactDecision(d, publicId)),
    revoked: false,
  };

  await db.collection("records").doc(publicId).set(projection);
  await recordSnap.ref.set(
    { public: true, public_id: publicId, published_by: byUid, published_at: new Date().toISOString() },
    { merge: true },
  );

  return { publicId };
}

/** Unshare. The projection goes, and every media URL under it stops resolving. */
export async function revokeRecord(tenantId: string, jobId: string): Promise<void> {
  const db = adminDb();
  const ref = db.collection("tenants").doc(tenantId).collection("records").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const publicId = (snap.data() as SealedRecord).public_id;
  if (publicId) {
    await db.collection("records").doc(publicId).delete();
    // The proxy already refuses once the document is gone, so access ends there. Deleting the
    // frozen copy as well is hygiene rather than security: bytes nobody can reach are still
    // bytes somebody pays to store.
    await deletePublished(publicId);
  }

  await ref.set({ public: false, public_id: null }, { merge: true });
}

/** No uids, no storage refs, no tenant. What is left is what a stranger needs. */
function redactStep(step: StepOutcome): Record<string, unknown> {
  return {
    step_id: step.step_id,
    status: step.status,
    reason_transcript: step.reason_transcript ?? null,
    recommendation_text: step.recommendation_text ?? null,
    provenance_class: step.provenance_class ?? null,
    fields: (step.fields ?? []).map((f) => ({
      key: f.key,
      kind: f.kind,
      value_number: f.value_number ?? null,
      value_text: f.value_text ?? null,
      value_choice: f.value_choice ?? null,
      unit: f.unit ?? null,
      provenance_class: f.provenance_class ?? null,
      // A proxied URL, never a gs:// ref. The bucket stays private.
      media: f.media_ref ? `media/${f.media_ref}` : null,
    })),
  };
}

/** The reasoning is the point of the page. The cost of producing it is nobody else's business. */
function redactDecision(decision: Decision, _publicId: string): Record<string, unknown> {
  return {
    agent: decision.agent,
    agent_version: decision.agent_version,
    model: decision.model ?? null,
    verdict: decision.verdict,
    rationale: decision.rationale,
    at: decision.at,
  };
}

/**
 * The published projection, or null.
 *
 * Never throws. A record page must render for a reader with no session, no project
 * credentials and no network to Google — the fixture path is the whole reason this
 * repository is clonable — so an unreachable Admin SDK means "not published", not an error
 * page.
 */
export async function readPublicRecord(publicId: string): Promise<PublicRecord | null> {
  try {
    const { adminConfigured } = await import("@/auth/admin");
    if (!adminConfigured()) return null;
    const snap = await adminDb().collection("records").doc(publicId).get();
    if (!snap.exists) return null;
    const record = snap.data() as PublicRecord;
    return record.revoked ? null : record;
  } catch {
    return null;
  }
}


// ---------------------------------------------------------------- published media
//
// `published/{publicId}/…` is a frozen copy, deliberately separate from the tenant's own
// prefix. The tenant's evidence is append-only and private; this is a redacted snapshot that
// exists only while the record is shared.

function bucketName(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";
}

/** Copy one object into the published prefix. False when there was nothing to copy. */
async function copyIntoPublished(from: string, publicId: string, name: string): Promise<boolean> {
  const bucket = bucketName();
  if (!bucket) return false;
  try {
    const source = from.startsWith("gs://") ? from.replace(`gs://${bucket}/`, "") : from;
    const store = getStorage(adminApp()).bucket(bucket);
    const file = store.file(source);
    const [exists] = await file.exists();
    if (!exists) return false;
    await file.copy(store.file(`published/${publicId}/${name}`));
    return true;
  } catch {
    // A missing avatar or an unreachable bucket must not stop a record being published. The
    // page renders without the image; the evidence it describes is unaffected.
    return false;
  }
}

async function deletePublished(publicId: string): Promise<void> {
  const bucket = bucketName();
  if (!bucket) return;
  try {
    await getStorage(adminApp()).bucket(bucket).deleteFiles({ prefix: `published/${publicId}/` });
  } catch {
    // Nothing to do. The capability document is already gone, which is what governs access.
  }
}


/**
 * A credential for Model Armor, or null.
 *
 * Null is a real answer and not an error: `screenText` returns NOT_SCREENED without one, and
 * NOT_SCREENED does not block a publish — the same posture the evidence path takes. A shop
 * unable to share a record because a screening API was unreachable would be a worse failure
 * than the one this guards, and the gap is recorded rather than hidden.
 */
async function armorAccessToken(): Promise<string | null> {
  try {
    const client = await new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }).getClient();
    const token = await client.getAccessToken();
    return typeof token === "string" ? token : (token?.token ?? null);
  } catch {
    return null;
  }
}
