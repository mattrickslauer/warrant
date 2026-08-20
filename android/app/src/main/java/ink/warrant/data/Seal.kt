package ink.warrant.data

import ink.warrant.contract.CeilingUnreachable
import ink.warrant.contract.Decision
import ink.warrant.contract.Deficiency
import ink.warrant.contract.Job
import ink.warrant.contract.ProvenanceClass
import ink.warrant.contract.SealedRecord
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier

/**
 * The deterministic core, in code, from day one.
 *
 * Sealing, the verification ceiling and the Gate's release decision are the three things this
 * system does that actually protect somebody, and none of them is a model. They live here as
 * pure functions so [FixtureSource] and LiveSource run the SAME logic — the fixture is not an
 * approximation of the seal, it IS the seal.
 *
 * Ported from `web/src/data/seal.ts`. Both stacks must agree, so neither reimplements: this is
 * a translation, and `SealTest` pins the behaviour the TypeScript already has.
 */

private val ALL_CLASSES = listOf(
    ProvenanceClass.MEASURED,
    ProvenanceClass.SPECIFIED,
    ProvenanceClass.INFERRED,
    ProvenanceClass.ASSERTED,
)

data class Ceiling(
    val tier: Tier,
    val reachable: List<ProvenanceClass>,
    val unreachable: List<CeilingUnreachable>,
)

/**
 * What this surface could and could not have proven. A lookup, never a judgement — it must be,
 * because it is the one thing on the public record that tells a stranger how much to believe it.
 */
fun verificationCeiling(tier: Tier): Ceiling {
    val reachable = CLASS_BY_TIER[tier].orEmpty()
    val unreachable = ALL_CLASSES
        .filter { it !in reachable }
        .map { CeilingUnreachable(it, UNREACHABLE_REASON[it] ?: "not available at this tier") }
    return Ceiling(tier, reachable, unreachable)
}

/** A step that was explained rather than performed. Never absent, never silent. */
fun deficienciesOf(job: Job): List<Deficiency> =
    job.steps
        .filter {
            it.status == StepStatus.DEFERRED ||
                it.status == StepStatus.WAIVED ||
                it.status == StepStatus.IMPOSSIBLE
        }
        .map { Deficiency(it.stepId, it.status, it.reasonTranscript ?: "no reason recorded") }

/**
 * The Gate. `if (!ok) deny()` — a gate you can argue with is not a gate.
 *
 * A waiver signed by someone with standing releases the machine; anything else holds it. Note
 * that a waiver WITHOUT a named signer does not release: an unsigned waiver is just a skip,
 * and there is no skip.
 */
fun machineReleased(job: Job): Boolean =
    job.steps.all { step ->
        step.status == StepStatus.PERFORMED ||
            (step.status == StepStatus.WAIVED && !step.waivedBy.isNullOrBlank())
    }

/** Can the job seal at all? Every step needs an outcome — pending is not one. */
fun readyToSeal(job: Job): Boolean = job.steps.all { it.status != StepStatus.PENDING }

/** Written once, never updated. */
fun sealJob(
    job: Job,
    decisions: List<Decision>,
    public: Boolean,
    at: String = nowIso(),
): SealedRecord {
    val ceiling = verificationCeiling(job.tier)
    return SealedRecord(
        id = job.id.replaceFirst(Regex("^job_"), "rec_"),
        jobId = job.id,
        tenantId = job.tenantId,
        public = public,
        sealedAt = at,
        ceilingTier = ceiling.tier,
        ceilingReachable = ceiling.reachable,
        ceilingUnreachable = ceiling.unreachable,
        deficiencies = deficienciesOf(job),
        machineReleased = machineReleased(job),
        steps = job.steps,
        decisions = decisions,
    )
}

internal fun nowIso(): String = java.time.Instant.now().toString()
