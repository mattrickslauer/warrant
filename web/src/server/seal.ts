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
import { bindingSteps, verificationCeiling, deficienciesOf, machineReleased, readyToSeal } from "@/data/seal";
import type { Tier } from "@/data/source";
import type { Job, StepOutcome, Field, Decision, FieldDef, Procedure } from "@/generated/types";
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
  field: Pick<Field, "key" | "step_id" | "kind">;
  /**
   * This field's declaration in the PINNED, FROZEN procedure version — not the live document
   * and never the field document the client wrote. Null when the version could not be loaded
   * or the step/key is not in it, and a null definition can only ever weaken the class.
   */
  def: Pick<FieldDef, "acceptance_rule" | "acceptance_target"> | null;
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
  // `specified` is derived from the FROZEN procedure's acceptance rule, never from the field
  // document. This rung used to read `field.resolved_from_order === "spec"`, which is a value
  // the client writes: firestore.rules refuses a forged `provenance_class` and a forged
  // `capture_surface`, but it has never refused this one, so a technician could have stamped
  // `spec` on a typed-in number and had the Seal promote it out of `asserted`. It also made
  // the class UNREACHABLE in practice — nothing in the product ever wrote the field, so no
  // record has ever carried `specified` despite the class being on screen in the taxonomy.
  //
  // A `per_spec` rule means the figure is printed on the machine or published in a manual and
  // `acceptance_target` says where to read it; the technician transcribes rather than decides.
  // That is exactly "resolved from a published figure rather than observed", and it is now
  // anchored to a document only `publishProcedure` can write.
  if (s.def?.acceptance_rule === "per_spec") return clamp("specified");
  // A model read it, and Model Armor said the image carried no instruction. NOT_SCREENED is
  // deliberately not enough: a class asserted off an unscreened image is a conclusion drawn
  // from evidence nobody checked.
  if (s.capture && s.capture.armor_verdict === "NO_MATCH_FOUND") return clamp("inferred");
  return "asserted";
}

/**
 * Every field declaration in a frozen procedure, keyed the way a Field is keyed.
 *
 * `{stepId}__{key}` is the same identity `readings.field_id` uses, so one map answers both
 * questions. A version that failed to load yields an empty map, and an empty map means every
 * field falls through to the weaker rungs — the safe direction.
 */
export function fieldDefsOf(version: Procedure | null): Map<string, FieldDef> {
  const out = new Map<string, FieldDef>();
  for (const step of version?.steps ?? []) {
    for (const def of step.fields ?? []) out.set(`${step.id}__${def.key}`, def);
  }
  return out;
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

  // The frozen version this job pinned. Loaded HERE rather than further down, because
  // provenance now derives from it: `specified` is a property of what the procedure declared,
  // and the procedure is the one document in this computation the technician cannot edit.
  const version = await pinnedVersion(
    db, tenantId, String(header.procedure_id), header.procedure_version,
  );
  const defs = fieldDefsOf(version);

  // --- provenance, recomputed -----------------------------------------------------------
  const fields: Field[] = fieldSnap.docs.map((d) => {
    const field = d.data() as Field;
    const fieldId = `${field.step_id}__${field.key}`;
    const def = defs.get(fieldId) ?? null;
    const provenance_class = classify({
      field,
      def,
      readings: readings.filter((r) => r.field_id === fieldId),
      capture: field.media_ref ? (captureById.get(field.media_ref) ?? null) : null,
      reachable: ceiling.reachable,
    });
    // The citation, and it is written ONLY when the class actually came out `specified`.
    // Recording where a figure was published on a field that did not resolve that way would
    // be a provenance claim by another name — `resolved_from_cite` is read as "this is the
    // document the value came from", and it must not appear beside a value nobody looked one
    // up for. Clamping is why this is checked against the RESULT and not against the rule:
    // an `open` job cannot reach `specified`, and the citation goes with the class.
    const resolved = provenance_class === "specified"
      ? {
          resolved_from_order: "spec" as const,
          // Where the figure is printed. `compile.ts` refuses to publish a `per_spec` field
          // that does not say, so on a compiled procedure this is never empty.
          resolved_from_cite: (def?.acceptance_target ?? "").trim() || null,
        }
      : {};
    return { ...field, provenance_class, ...resolved };
  });

  const outcomes = outcomeSnap.docs.map((d) => {
    const outcome = d.data() as StepOutcome;
    // A stated reason is always `asserted`: a named human said it, at this time. The contract
    // narrows step-outcome.provenance_class to exactly that one value.
    return outcome.reason_kind ? { ...outcome, provenance_class: "asserted" as const } : outcome;
  });

  const job: Job = assemble({ ...header, tier }, outcomes, fields);

  // `version` is the FROZEN procedure this job pinned, read above. Passing it is what lets a
  // step the procedure declared optional stay pending without holding the job open — see
  // `bindingSteps` in web/src/data/seal.ts for why the frozen version is the only acceptable
  // answer to "was this step optional".
  if (!readyToSeal(job, version)) {
    const pending = bindingSteps(job, version)
      .filter((s) => s.status === "pending").map((s) => s.step_id);
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
    machine_released: machineReleased(job, version),
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
      // Written unconditionally, including as null. A field that resolved from a spec on one
      // seal and does not on a re-seal must lose the citation rather than keep a stale one:
      // `merge: true` leaves absent keys alone, so omitting these would strand the old value
      // beside a class that no longer supports it.
      resolved_from_order: field.resolved_from_order ?? null,
      resolved_from_cite: field.resolved_from_cite ?? null,
    }, { merge: true });
  }
  // `record_id` is on the header because that is where the CLIENTS look for it. Android's
  // job-header listener reads `snap.getString("record_id")` and emits nothing when it is
  // absent — so before this line the phone could watch a job go `sealed` and never be told
  // where the record it just earned had landed. It equals the job id today; the clients are
  // not required to know that, and should not have to guess it.
  // TENANT-SCOPED, like every other id that crosses the DataSource seam. `record.id` stays
  // bare because it is the document id; this one is an ADDRESS a client hands straight back to
  // `getRecord`, and Android's `split()` does `require(i > 0)` — a bare id there is not a
  // wrong lookup, it is a thrown exception on the screen the technician just earned.
  batch.set(jobRef, {
    status: "sealed", sealed_at, tier, record_id: `${tenantId}/${recordId}`,
  }, { merge: true });
  await batch.commit();

  return { recordId, tier, machineReleased: record.machine_released };
}

/**
 * Seal this job IF it is finished, and stay quiet if it is not.
 *
 * The Seal could always run. Nothing ever ASKED it to. `/api/jobs/seal` had no caller in
 * either client — Android's `Api.kt` never had a method for it and the web app never fetched
 * it — so the only path to a record was the sweep's safety net, and a net is not a mechanism.
 * A technician watched the last step go green and the record simply never arrived.
 *
 * So every server-side path that SETTLES a step now calls this: the Inspector accepting the
 * last field, the Foreman disposing a stalled step, a foreman signing a waiver. That covers
 * both surfaces at once and for the same reason the adjudicator does — a step's status is
 * decided on the server, so the seal that follows from it belongs on the server too. Neither
 * client needs a line of code, and neither client can forget.
 *
 * It is deliberately QUIET. On every call but the last the job still has pending steps, and
 * that is the ordinary case rather than an error. It is also deliberately UNTHROWN: the caller
 * has already durably settled a step, and failing their request because the seal could not run
 * would lose the step in order to save the record. The sweep remains the net for the settle
 * that died before it reached this line.
 *
 * Already-sealed is checked FIRST. A record is immutable — the artifact a stranger reads years
 * later — and a second `sealed_at` stamped over it by a late retry is exactly the kind of
 * quiet rewrite the rest of this file exists to prevent. `sealJobLive` itself still permits a
 * deliberate re-seal through `/api/jobs/seal`; this path never asks for one.
 */
export async function sealIfFinished(
  tenantId: string,
  jobId: string,
  db: FirebaseFirestore.Firestore = adminDb(),
): Promise<Sealed | null> {
  try {
    const snap = await db
      .collection("tenants").doc(tenantId)
      .collection("jobs").doc(jobId)
      .get();
    if (!snap.exists) return null;
    // `draft` is held back from the fleet and must not seal; `sealed` is already done. The
    // middle three are jobs the fleet can see, which is exactly the set that may finish.
    const status = String((snap.data() as JobHeader | undefined)?.status ?? "");
    if (status !== "open" && status !== "waiting" && status !== "held") return null;

    // Whether the job is FINISHED is not decided here. `sealJobLive` answers it against the
    // frozen procedure version, which is the only thing that knows which steps were optional
    // — a cheap "any outcome still pending?" pre-check would be stricter than the real rule
    // and would hold open exactly the jobs `bindingSteps` was written to release.
    return await sealJobLive(tenantId, jobId, db);
  } catch (error) {
    if (error instanceof NotSealable) return null;
    // Logged, not raised. The next settle on this job tries again, and the sweep tries after
    // that; what must not happen is the technician's write failing because of this.
    console.warn(`[seal] ${tenantId}/${jobId} did not seal:`, error);
    return null;
  }
}
