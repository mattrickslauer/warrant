// The deterministic core, in code, from day one.
//
// Sealing, the verification ceiling and the Gate's release decision are the three things
// this system does that actually protect somebody, and none of them is a model. They live
// here as pure functions so FixtureSource and LiveSource run the SAME logic — the fixture
// is not an approximation of the seal, it is the seal.
import type { Job, SealedRecord, Decision, StepOutcome } from "@/generated/types";
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
 * The Gate. `if (!ok) deny()` — a gate you can argue with is not a gate.
 * A waiver signed by someone with standing releases; anything else holds.
 */
export function machineReleased(job: Job): boolean {
  return job.steps.every(
    (s) => s.status === "performed" || (s.status === "waived" && !!s.waived_by)
  );
}

export function sealJob(job: Job, decisions: Decision[], opts: { public: boolean }): SealedRecord {
  const at = new Date().toISOString();
  return {
    id: job.id.replace(/^job_/, "rec_"),
    job_id: job.id,
    tenant_id: job.tenant_id,
    public: opts.public,
    sealed_at: at,
    ...verificationCeiling(job.tier as Tier),
    ceiling_tier: job.tier as Tier,
    ceiling_reachable: verificationCeiling(job.tier as Tier).reachable,
    ceiling_unreachable: verificationCeiling(job.tier as Tier).unreachable,
    deficiencies: deficienciesOf(job),
    machine_released: machineReleased(job),
    steps: job.steps,
    decisions,
  } as SealedRecord;
}

/** Can the job seal at all? Every step needs an outcome — pending is not one. */
export function readyToSeal(job: Job): boolean {
  return job.steps.every((s: StepOutcome) => s.status !== "pending");
}
