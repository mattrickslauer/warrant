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
import { adminDb } from "@/auth/admin";
import { getMember } from "@/auth/members";
import type { SealedRecord, StepOutcome, Decision, Capture } from "@/generated/types";

/** 22 chars of base64url ≈ 132 bits. Not derived from the job id, which is enumerable. */
export function newPublicId(): string {
  return randomBytes(16).toString("base64url").slice(0, 22);
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
  const actors = [];
  for (const uid of actorUids) {
    const member = await getMember(tenantId, uid);
    if (!member) continue;
    actors.push({
      display_name: member.display_name ?? "a technician",
      avatar: member.photo_ref ? `/api/r/${publicId}/avatar/${uid}` : null,
      role: member.role,
    });
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
  await recordSnap.ref.set({ public: true, public_id: publicId }, { merge: true });

  return { publicId };
}

/** Unshare. The projection goes, and every media URL under it stops resolving. */
export async function revokeRecord(tenantId: string, jobId: string): Promise<void> {
  const db = adminDb();
  const ref = db.collection("tenants").doc(tenantId).collection("records").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const publicId = (snap.data() as SealedRecord).public_id;
  if (publicId) await db.collection("records").doc(publicId).delete();

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
