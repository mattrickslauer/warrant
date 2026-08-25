// The deterministic core, in code, from day one.
//
// Sealing, the verification ceiling and the Gate's release decision are the three things
// this system does that actually protect somebody, and none of them is a model. They live
// here as pure functions so FixtureSource and LiveSource run the SAME logic — the fixture
// is not an approximation of the seal, it is the seal.
import type { Job, Procedure, SealedRecord, Decision, StepOutcome } from "@/generated/types";
import { CLASS_BY_TIER, UNREACHABLE_REASON, type Tier } from "./source";

const ALL_CLASSES = ["measured", "specified", "inferred", "asserted"] as const;
type Cls = (typeof ALL_CLASSES)[number];

/** What this surface could and could not have proven. A lookup, never a judgement. */
export function verificationCeiling(tier: Tier) {
  const reachable = CLASS_BY_TIER[tier];
  const unreachable = ALL_CLASSES.filter((c) => !reachable.includes(c)).map((c) => ({
    class: c,
    reason: UNREACHABLE_REASON[c] ?? "not available at this tier",
  }));
  return { tier, reachable: [...reachable], unreachable };
}

/** A step that was explained rather than performed. Never absent, never silent. */
export function deficienciesOf(job: Job) {
  return job.steps
    .filter((s) => s.status === "deferred" || s.status === "waived" || s.status === "impossible")
    .map((s) => ({
      step_id: s.step_id,
      status: s.status as "deferred" | "waived" | "impossible",
      reason: s.reason_transcript ?? "no reason recorded",
    }));
}

/**
 * The steps whose non-performance is allowed to hold this job.
 *
 * A procedure may declare a step optional — `required_at_strictness: 4`, the level strictness
 * cannot reach — and an optional step is one the shop said the job does not need. It is still
 * SHOWN, still performable, still judged if it is performed; what it does not get is the power
 * to keep a job open or hold a machine. Without this, marking a step optional in the editor
 * would change nothing that matters: the step would go on blocking the seal exactly as before,
 * and "optional" would be a word on a form rather than a fact about the work.
 *
 * The procedure is a parameter rather than something read from the job, because the only
 * procedure this may be answered from is the FROZEN version the job pinned. A job started
 * under v2 is judged by v2's idea of what was optional, even if v3 changed its mind — the same
 * reason every other read in the seal path goes through `pinnedVersion`.
 *
 * Absent procedure means every step binds. That is the safe direction: a step wrongly treated
 * as required holds a job that should have sealed, which somebody notices and fixes. A step
 * wrongly treated as optional seals a job that was never finished, which nobody notices at all.
 */
export function bindingSteps(job: Job, procedure?: Procedure | null): StepOutcome[] {
  if (!procedure) return job.steps;
  const optional = new Set(
    (procedure.steps ?? [])
      .filter((s) => (s.required_at_strictness ?? 0) > job.strictness)
      .map((s) => s.id),
  );
  return job.steps.filter((s) => !optional.has(s.step_id));
}

/**
 * The Gate. `if (!ok) deny()` — a gate you can argue with is not a gate.
 * A waiver signed by someone with standing releases; anything else holds.
 */
export function machineReleased(job: Job, procedure?: Procedure | null): boolean {
  return bindingSteps(job, procedure).every(
    (s) => s.status === "performed" || (s.status === "waived" && !!s.waived_by)
  );
}

export function sealJob(job: Job, decisions: Decision[], opts: { public: boolean }): SealedRecord {
  const at = new Date().toISOString();
  // Computed ONCE and spread nowhere. `...verificationCeiling(tier)` used to sit alongside the
  // three `ceiling_*` fields below, which put `tier`, `reachable` and `unreachable` on the
  // record as well — three keys the contract does not declare, hidden by the `as SealedRecord`
  // at the end. A sealed record is the artifact a stranger reads years later; it should carry
  // what the schema says it carries and nothing that arrived by accident.
  const ceiling = verificationCeiling(job.tier as Tier);
  return {
    id: job.id.replace(/^job_/, "rec_"),
    job_id: job.id,
    tenant_id: job.tenant_id,
    public: opts.public,
    sealed_at: at,
    ceiling_tier: job.tier as Tier,
    ceiling_reachable: ceiling.reachable,
    ceiling_unreachable: ceiling.unreachable,
    deficiencies: deficienciesOf(job),
    machine_released: machineReleased(job),
    steps: job.steps,
    decisions,
  } as SealedRecord;
}

/** Can the job seal at all? Every binding step needs an outcome — pending is not one. */
export function readyToSeal(job: Job, procedure?: Procedure | null): boolean {
  return bindingSteps(job, procedure).every((s: StepOutcome) => s.status !== "pending");
}
