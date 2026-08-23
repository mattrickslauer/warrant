import "server-only";

// The Seal. Where a job stops being work in progress and becomes a record.
//
// THIS FILE WAS THE HOLE IN THE MIDDLE OF THE SYSTEM. `data/seal.ts` has held the pure
// functions since day one, and `fixture-source.ts` called them — so the demo sealed and the
// product did not. Nothing wrote `/tenants/{t}/records/{jobId}` on the live path, which meant
// `publishRecord` could only ever throw `NotPublishable`, and record sharing was dead against
// a real backend.
//
// Worse than the missing feature was the missing CONTROL. Three files justify what they allow
// by pointing at a Seal that recomputes provenance:
//
//   firestore.rules            "The Seal recomputes every field's class from the
//                               server-written `readings` collection and never trusts what
//                               arrived on the field document."
//   api/ingest/reading         "the class is stamped by the Seal, which recomputes it from
//                               the readings collection."
//   adjudicate/run.ts          "The Seal decides measured / specified / inferred / asserted."
//
// None of that existed. `provenance_class` was written as `null` by every live path and never
// read back, so no field in production was ever `measured` — the instrument, which is the
// product's whole claim, produced a number that nothing ever credited.
//
// So this is that function, and it recomputes rather than trusts. Everything it stamps is
// derived from a document a client cannot write: `readings` for measured, the verified
// attestation on a capture for the tier, the acceptance rule for specified. What arrived on
// the field document is deliberately ignored.

import { adminDb } from "@/auth/admin";
import { getMember } from "@/auth/members";
import { pinnedVersion } from "@/server/procedures";
import { verificationCeiling, deficienciesOf, machineReleased, readyToSeal } from "@/data/seal";
import type { Tier } from "@/data/source";
import type { Job, StepOutcome, Field, Decision } from "@/generated/types";
import { assemble, type JobHeader } from "@/data/live-source";

export class NotSealable extends Error {}

export interface Sealed {
  recordId: string;
  tier: Tier;
  machineReleased: boolean;
}

/** The tier order, weakest first. A tier is EARNED; a claimed one is only ever a ceiling. */
const TIER_RANK: Record<Tier, number> = { open: 0, attested: 1, instrumented: 2 };

/**
 * What this job's evidence actually supports, regardless of what the job says.
 *
 * `tier` sits on the job header and is written by the client at `startJob`. Nothing in
 * firestore.rules refuses it — the rules refuse `provenance_class`, `capture_surface`,
 * `tool_id` and `status: sealed`, but not this — so a client could claim `instrumented` on a
 * job with no instrument anywhere near it and inflate the ceiling on a public record. The
 * ceiling is the record's headline honesty claim, so it is computed here from evidence:
 *
 *   instrumented  a server-written reading with a tool_id exists for this job. Only
 *                 POST /api/ingest/reading can cause that to be true.
 *   attested      a capture on this job carries MEETS_DEVICE_INTEGRITY, which only
 *                 `verifyIntegrity` writes, from Google's own answer.
 *   open          everything else, which is the honest common case.
 *
 * The claimed tier still caps the result. A shop that opened a job at `open` gets `open`, even
 * if an instrument happened to be paired — the record must not claim more than the job set out
 * to prove.
 */
export function earnedTier(
  claimed: Tier,
  captures: Array<{ attestation_play_integrity?: string | null }>,
  readings: Array<{ tool_id?: string | null }>,
): Tier {
  let earned: Tier = "open";
  if (captures.some((c) => c.attestation_play_integrity === "MEETS_DEVICE_INTEGRITY")) {
    earned = "attested";
  }
  if (readings.some((r) => Boolean(r.tool_id))) earned = "instrumented";
  return TIER_RANK[earned] < TIER_RANK[claimed] ? earned : claimed;
}

export interface ProvenanceSources {
  field: Pick<Field, "key" | "step_id" | "kind" | "resolved_from_order">;
  /** Server-written readings for THIS job and THIS field. Nothing else can make one. */
  readings: Array<{ tool_id?: string | null }>;
  /** The capture the field points at, if it still exists. */
  capture: { capture_surface?: string | null; armor_verdict?: string | null } | null;
  /** Classes the tier puts within reach. A class above the ceiling is not claimable. */
  reachable: ReadonlyArray<string>;
}

/**
 * One field's class, recomputed.
 *
 * The order is strictly weakening, and each rung names the document that has to exist for it:
 *
 *   measured   a `readings` document for this job and field carries a tool_id. That collection
 *              is server-written and POST /api/ingest/reading is its only writer, so this is a
 *              claim only a paired instrument can cause to be true.
 *   specified  the value was resolved from a published figure rather than observed.
 *   inferred   a model read evidence that was screened and came back clean.
 *   asserted   somebody typed it. The floor, and never a failure — an admitted assertion beats
 *              a fabricated measurement.
 *
 * Then it is clamped to the ceiling. A field cannot be `measured` on an `open` job however the
 * number arrived, because the surface could not have proven it.
 */
export function classify(s: ProvenanceSources): "measured" | "specified" | "inferred" | "asserted" {
  const clamp = (c: "measured" | "specified" | "inferred" | "asserted") =>
    s.reachable.includes(c) ? c : "asserted";

  if (s.readings.some((r) => Boolean(r.tool_id))) return clamp("measured");
  if (s.field.resolved_from_order === "spec") return clamp("specified");
  // A model read it, and Model Armor said the image carried no instruction. NOT_SCREENED is
  // deliberately not enough: a class asserted off an unscreened image is a conclusion drawn
  // from evidence nobody checked.
  if (s.capture && s.capture.armor_verdict === "NO_MATCH_FOUND") return clamp("inferred");
  return "asserted";
}

/**
 * Seal one job.
 *
 * Runs under Admin credentials, which bypass firestore.rules — so `tenantId` must arrive from
 * a verified session and never from a request body. The caller's job is to prove the tenant;
 * this function's job is to trust nothing else.
 */
export async function sealJobLive(
  tenantId: string,
  jobId: string,
  db: FirebaseFirestore.Firestore = adminDb(),
): Promise<Sealed> {
  const tenantRef = db.collection("tenants").doc(tenantId);
  const jobRef = tenantRef.collection("jobs").doc(jobId);

  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) throw new NotSealable(`No such job: ${jobId}.`);
  const header = jobSnap.data() as JobHeader;

  const [outcomeSnap, fieldSnap, captureSnap] = await Promise.all([
    jobRef.collection("step_outcomes").get(),
    jobRef.collection("fields").get(),
    jobRef.collection("captures").get(),
  ]);

  // Readings for THIS JOB. The job scope is not decoration: `field_id` is `{stepId}__{key}`,
  // which is identical across every job running the same procedure, so a tenant-wide query
  // would credit one job's instrument reading to another job's field.
  const readingSnap = await tenantRef.collection("readings").where("job_id", "==", jobId).get();
  const readings = readingSnap.docs.map((d) => d.data() as {
    field_id?: string; tool_id?: string | null;
  });

  const captures = captureSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as {
    id: string; field_id?: string; capture_surface?: string | null;
    armor_verdict?: string | null; attestation_play_integrity?: string | null;
  });
  const captureById = new Map(captures.map((c) => [c.id, c]));

  const claimed = (header.tier ?? "open") as Tier;
  const tier = earnedTier(claimed, captures, readings);
  const ceiling = verificationCeiling(tier);

  // --- provenance, recomputed -----------------------------------------------------------
  const fields: Field[] = fieldSnap.docs.map((d) => {
    const field = d.data() as Field;
    const fieldId = `${field.step_id}__${field.key}`;
    return {
      ...field,
      provenance_class: classify({
        field,
        readings: readings.filter((r) => r.field_id === fieldId),
        capture: field.media_ref ? (captureById.get(field.media_ref) ?? null) : null,
        reachable: ceiling.reachable,
      }),
    };
  });

  const outcomes = outcomeSnap.docs.map((d) => {
    const outcome = d.data() as StepOutcome;
    // A stated reason is always `asserted`: a named human said it, at this time. The contract
    // narrows step-outcome.provenance_class to exactly that one value.
    return outcome.reason_kind ? { ...outcome, provenance_class: "asserted" as const } : outcome;
  });

  const job: Job = assemble({ ...header, tier }, outcomes, fields);

  if (!readyToSeal(job)) {
    const pending = job.steps.filter((s) => s.status === "pending").map((s) => s.step_id);
    throw new NotSealable(
      `This job is not finished. ${pending.length} step(s) are still pending: ${pending.join(", ")}.`,
    );
  }

  // --- the record ------------------------------------------------------------------------
  const decisions = (
    await tenantRef.collection("decisions").where("job_id", "==", `${tenantId}/${jobId}`).get()
  ).docs.map((d) => d.data() as Decision);

  // Names frozen at seal time, for the same reason `publishRecord` freezes them: a record is
  // immutable, so it must not change when somebody updates their photo or leaves the company.
  const actorUids = new Set<string>();
  for (const step of job.steps) {
    if (step.reason_by) actorUids.add(step.reason_by);
    if (step.waived_by) actorUids.add(step.waived_by);
  }
  const actors = [];
  for (const uid of actorUids) {
    const member = await getMember(tenantId, uid);
    if (!member) continue;
    actors.push({
      uid,
      display_name: member.display_name ?? "a technician",
      photo_ref: member.photo_ref ?? null,
      role: member.role,
    });
  }

  const version = await pinnedVersion(
    db, tenantId, String(header.procedure_id), header.procedure_version,
  );
  const tenant = (await tenantRef.get()).data() ?? {};
  const sealed_at = new Date().toISOString();
  const recordId = jobId;

  const record = {
    schema_version: 1,
    id: recordId,
    job_id: `${tenantId}/${jobId}`,
    tenant_id: tenantId,
    public: false,
    public_id: null,
    sealed_at,
    procedure_title: version?.title ?? null,
    procedure_version: header.procedure_version ?? version?.version ?? 1,
    asset_label: header.asset_urn ?? null,
    issuer: { display_name: (tenant.display_name as string) ?? tenantId },
    actors,
    ceiling_tier: tier,
    ceiling_reachable: ceiling.reachable,
    ceiling_unreachable: ceiling.unreachable,
    deficiencies: deficienciesOf(job),
    machine_released: machineReleased(job),
    steps: job.steps,
    decisions,
  };

  const batch = db.batch();
  batch.set(tenantRef.collection("records").doc(recordId), record);
  // The recomputed class goes back onto the field documents, so the running surfaces show the
  // same provenance the record claims. This write is the reason `provenance_class` is on the
  // list a client may not claim: only this path may set it.
  for (const field of fields) {
    batch.set(jobRef.collection("fields").doc(field.id), {
      provenance_class: field.provenance_class,
    }, { merge: true });
  }
  batch.set(jobRef, { status: "sealed", sealed_at, tier }, { merge: true });
  await batch.commit();

  return { recordId, tier, machineReleased: record.machine_released };
}
