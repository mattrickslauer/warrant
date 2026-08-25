package ink.warrant.data

import ink.warrant.contract.Job
import ink.warrant.contract.StepOutcome
import ink.warrant.contract.StepStatus

/**
 * What is waiting on a person, derived rather than flagged.
 *
 * The fleet raises questions asynchronously — an Inspector runs long after the technician put
 * the phone in their pocket — so "there is something for you" cannot be a boolean somebody
 * remembers to set. It is a property of the step outcomes, computed the same way on every
 * surface, which is why this is a pure function over the contract and not a field on the job.
 *
 * Pure and Compose-free, like [ink.warrant.data.sealJob] beside it, so the rule can be tested
 * without a device. A screen that decided for itself what counted as outstanding would drift
 * from the one that decided what counted as sealed, and the two must agree.
 */

/** What kind of thing is waiting, which decides what a person can do about it. */
enum class AttentionKind {
    /** An agent asked a person a question it could not answer from the evidence. */
    QUESTION,

    /**
     * An agent DID answer and the answer could not be acted on — a malformed verdict, an
     * unreachable fleet. Distinct from [QUESTION] because nobody asked anything: what is
     * needed is a person deciding, not a person explaining.
     */
    HOLD,

    /**
     * The form grew. An agent appended a field because the declared evidence was insufficient,
     * and that field is still empty.
     *
     * The one kind that CANNOT be answered in words. You cannot photograph a brake disc from a
     * records list, so this is surfaced and pointed back at the job rather than given a text
     * box that would produce a sentence where a measurement belongs.
     */
    EVIDENCE,
}

/**
 * One thing waiting on a person.
 *
 * Carries the answer as well as the ask, because a question with its answer deleted is
 * unreadable to whoever checks this later — and that reader is the only one who matters.
 */
data class OpenItem(
    val stepId: String,
    val kind: AttentionKind,
    /** What is being asked, in the words it was asked in. */
    val ask: String,
    /** What somebody already said, if anybody has. */
    val answer: String? = null,
    val answeredBy: String? = null,
    val answeredAt: String? = null,
) {
    /**
     * Whether a person can settle this from a records screen, with a keyboard and nothing else.
     *
     * [AttentionKind.EVIDENCE] cannot: it needs the camera, and usually the machine.
     */
    val answerable: Boolean get() = kind != AttentionKind.EVIDENCE

    /** Nobody has said anything yet. */
    val outstanding: Boolean get() = answer.isNullOrBlank()
}

/**
 * A step is only ever waiting on somebody while it is PENDING.
 *
 * Every other status is an outcome — performed, or one of the three that explain why not — and
 * an outcome is not a question. This is the same line [readyToSeal] draws, deliberately: if a
 * step can seal, nothing is owed on it, and two screens disagreeing about that is how a job
 * ends up nagging about a step it has already closed.
 */
private fun StepOutcome.isOpen(): Boolean = status == StepStatus.PENDING

/**
 * Everything waiting on a person in this job, in step order.
 *
 * An answered question stays in the list. It has not gone away — the fleet has still to rule
 * on what was said — and dropping it the moment somebody typed would make the screen claim a
 * settlement that has not happened.
 */
fun openItems(job: Job): List<OpenItem> = job.steps.filter { it.isOpen() }.flatMap { step ->
    buildList {
        step.escalationQuestion?.takeIf { it.isNotBlank() }?.let { question ->
            add(
                OpenItem(
                    stepId = step.stepId,
                    kind = AttentionKind.QUESTION,
                    ask = question,
                    answer = step.escalationAnswer,
                    answeredBy = step.escalationAnsweredBy,
                    answeredAt = step.escalationAnsweredAt,
                ),
            )
        }

        step.holdReason?.takeIf { it.isNotBlank() }?.let { reason ->
            add(OpenItem(stepId = step.stepId, kind = AttentionKind.HOLD, ask = reason))
        }

        // A field an agent added and nobody has filled. `accepted_fields` is the fleet's word
        // for "this one is done", and a filled field that has not been accepted yet is still
        // in flight rather than outstanding — so both count as satisfied here.
        val satisfied = step.acceptedFields.toSet() +
            step.fields.filter { it.isFilled }.map { it.key }
        for (added in step.addedFields) {
            if (added.key in satisfied) continue
            add(OpenItem(stepId = step.stepId, kind = AttentionKind.EVIDENCE, ask = added.prompt))
        }
    }
}

/** Whether anything in this job is waiting on a person. The badge on a list row. */
fun needsResponse(job: Job): Boolean = openItems(job).any { it.outstanding }

/** How many things are waiting and nobody has spoken to. */
fun outstandingCount(job: Job): Int = openItems(job).count { it.outstanding }
