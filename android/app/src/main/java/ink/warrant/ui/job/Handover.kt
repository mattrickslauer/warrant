package ink.warrant.ui.job

import ink.warrant.contract.Decision
import ink.warrant.contract.Field
import ink.warrant.contract.FieldKind
import ink.warrant.contract.Job
import ink.warrant.contract.Procedure
import ink.warrant.contract.ProvenanceClass
import ink.warrant.contract.StepStatus
import ink.warrant.data.OpenItem
import ink.warrant.data.openItems

/**
 * Where a job actually stands the moment the technician taps Finish.
 *
 * Finish is not the same event as the seal, and pretending otherwise is the bug this file
 * exists to prevent. The technician's last capture ends *their* work; the record seals later,
 * once every step has an outcome and the fleet has said so. Between those two moments the
 * screen has to say something true, and there are only three true things it can say.
 *
 * Like [primaryActionFor], this is plain Kotlin with no Compose in it, because it is the part
 * of the handover that can be wrong in a way a screenshot would not show: a page reading
 * "Sealed" over a job with a step still owed is a lie told by a heading.
 */
enum class HandoverState {
    /** A step still has a required field empty. The job cannot seal, and saying so is the point. */
    OUTSTANDING,

    /** Everything is captured. The fleet has not finished, so there is no record id yet. */
    WAITING,

    /** The record exists and has an id. This is the only state that may offer to open it. */
    SEALED,
}

fun handoverStateFor(outstanding: Int, sealedRecordId: String?): HandoverState = when {
    // Outstanding wins even when a record id has somehow arrived: what the person in front of
    // the machine can still do outranks what the backend has already decided.
    outstanding > 0 -> HandoverState.OUTSTANDING
    sealedRecordId != null -> HandoverState.SEALED
    else -> HandoverState.WAITING
}

/**
 * The heading, and the sentence under it. Never "Done" — nothing here is done by itself.
 *
 * [explained] is how many steps ended with a stated reason instead of with evidence, and it
 * only changes the WAITING sentence — which used to read "Everything this procedure asked for
 * is captured" whatever had happened. On a job where a step could not be performed that was
 * false, and falsely reassuring in the one direction that matters: the technician walks away
 * believing the job will seal clean when it is going to seal deficient. The count is said
 * plainly instead, and the seal is still the fleet's to decide.
 */
fun handoverHeadline(
    state: HandoverState,
    outstanding: Int,
    explained: Int = 0,
): Pair<String, String> = when (state) {
    HandoverState.OUTSTANDING -> "Not finished yet" to
        "$outstanding step${if (outstanding == 1) "" else "s"} still ${
            if (outstanding == 1) "has" else "have"
        } something required and empty. This job cannot seal until every step has an " +
        "outcome. Nothing you captured is lost — go back and finish it whenever you like."

    HandoverState.WAITING -> "Handed to the fleet" to
        if (explained > 0) {
            "Nothing is left for you to do. $explained step${if (explained == 1) "" else "s"} " +
                "ended with a stated reason rather than with evidence, and the fleet rules on " +
                "${if (explained == 1) "it" else "those"} — the record may well seal deficient. " +
                "Verification runs behind you. You can leave; it will not stop."
        } else {
            "Everything this procedure asked for is captured. Verification runs behind you, " +
                "and the record seals when the last step has a verdict. You can leave; it " +
                "will not stop."
        }

    HandoverState.SEALED -> "Sealed" to
        "The record is written and cannot be changed. It carries what went right and what " +
        "did not, and it names every agent that touched it."
}

// ------------------------------------------------------------------ what the carousel holds

/**
 * One page of the handover's evidence carousel.
 *
 * The TypeScript twin is `HandoverFrame` in web/src/data/handover.ts, and the two must keep
 * agreeing about one thing above all: WHICH VERDICT BELONGS UNDER WHICH PHOTOGRAPH. The
 * handover used to be a headline, two lists of step names and a flat trace — a summary of the
 * work rather than the work — and putting the evidence on the page means a verdict is now
 * printed directly beneath a capture. A frame that carried the wrong step's decisions would
 * show a technician a rejection of one photograph underneath a different one, which reads as
 * the fleet being wrong about something it never looked at.
 *
 * A frame is per CAPTURE, not per step, because a step can hold more than one — the Inspector
 * appends a field and the step then carries two photographs that were judged separately. A
 * step that produced nothing still gets exactly one frame, carrying its reason: a job where
 * step three was explained rather than performed must not look, on the last screen anybody
 * reads, like a job where step three does not exist.
 */
data class HandoverFrame(
    /** Stable across re-reads, so the pager does not jump when a verdict lands. */
    val id: String,
    /**
     * The job these bytes belong to, scoped, carried on the frame rather than passed beside it.
     *
     * The same reasoning as [ink.warrant.ui.components.StepEvidence], which reads it off the
     * outcome: a renderer given the job id as a separate argument can be handed one job's id
     * and another job's frames, and the failure — a photograph from the wrong run — looks
     * exactly like a correct page.
     */
    val jobId: String,
    val stepId: String,
    val stepIndex: Int,
    val stepTitle: String,
    val status: StepStatus,
    /**
     * The filled field this page is about, or null on the placeholder a step with no evidence
     * gets.
     *
     * NOT called `field`, which is what the browser twin calls it, and the reason is a Kotlin
     * trap rather than a difference of opinion: inside a property accessor `field` names the
     * backing field, so the three computed properties below would silently fail to see a
     * constructor property of that name.
     */
    val answered: Field?,
    /** What the technician said, when the step was explained rather than performed. */
    val reason: String?,
    /**
     * What the fleet said about THIS step, oldest first.
     *
     * Scoped to the step rather than the field, because that is the finest grain a [Decision]
     * actually carries — `stepId` and nothing below it. Pretending otherwise by matching on
     * rationale text would put a verdict about one photograph under another one.
     */
    val decisions: List<Decision>,
    /** What is still waiting on a person, on this step. */
    val issues: List<OpenItem>,
) {
    /** What to fetch the bytes with, or null when there is nothing to fetch. */
    val captureId: String?
        get() = answered
            ?.takeIf { it.kind == FieldKind.PHOTO || it.kind == FieldKind.VIDEO || it.kind == FieldKind.SCAN }
            ?.mediaRef

    /** A value field's answer, for the kinds that have no object behind them. */
    val value: String?
        get() {
            val f = answered ?: return null
            if (captureId != null) return null
            return when {
                f.valueNumber != null ->
                    listOfNotNull(trimZero(f.valueNumber!!), f.unit).joinToString(" ")
                !f.valueChoice.isNullOrBlank() -> f.valueChoice
                else -> f.valueText
            }
        }

    /** Stamped by the Seal, absent until then. Never guessed here. */
    val provenance: ProvenanceClass? get() = answered?.provenanceClass
}

/**
 * Every page of the carousel, in the order the work happened.
 *
 * Job-level decisions — the ones with a null `stepId`, which is how the Foreman's disposition
 * arrives — belong to no frame and are deliberately left out. They are still on the page,
 * under the full trace; what they are not is attached to a photograph they were not about.
 */
fun handoverFrames(
    job: Job,
    procedure: Procedure,
    decisions: List<Decision>,
): List<HandoverFrame> {
    val waiting = openItems(job)
    val outcomes = job.steps.associateBy { it.stepId }

    return procedure.steps.flatMap { step ->
        val outcome = outcomes[step.id]
        val here = decisions.filter { it.stepId == step.id }
        val issues = waiting.filter { it.stepId == step.id }
        val reason = outcome?.reasonTranscript?.takeIf { it.isNotBlank() }
        val filled = outcome?.fields.orEmpty().filter { it.isFilled }

        fun frame(answered: Field?) = HandoverFrame(
            id = "${step.id}:${answered?.key ?: "-"}",
            jobId = job.id,
            stepId = step.id,
            stepIndex = step.index,
            stepTitle = step.title,
            status = outcome?.status ?: StepStatus.PENDING,
            answered = answered,
            reason = reason,
            decisions = here,
            issues = issues,
        )

        // The placeholder. A step nobody answered is a page like any other, and the reason it
        // was not answered is the most useful line on it.
        if (filled.isEmpty()) listOf(frame(null)) else filled.map { frame(it) }
    }
}

/** Trailing zeroes off a whole number. `4.0 mm` reads as a rounding; `4 mm` reads as a value. */
private fun trimZero(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()

/**
 * How far the fleet has got, for the line that has to keep moving while somebody watches it.
 *
 * [ruled] counts steps that have reached an outcome, NOT steps that passed — a deferred step
 * has been ruled on, and a progress line that only counted passes would stall for ever on a
 * job that is going to seal deficient, which is precisely the job somebody watches this line
 * on. Optional steps are excluded from the total for the same reason they cannot hold the seal
 * open.
 */
data class Progress(val ruled: Int, val total: Int) {
    val settled: Boolean get() = ruled >= total
}

fun verificationProgress(job: Job, procedure: Procedure): Progress {
    val outcomes = job.steps.associateBy { it.stepId }
    val counted = procedure.steps.filter { it.requiredAtStrictness <= job.strictness }
    val ruled = counted.count { (outcomes[it.id]?.status ?: StepStatus.PENDING) != StepStatus.PENDING }
    return Progress(ruled = ruled, total = counted.size)
}
