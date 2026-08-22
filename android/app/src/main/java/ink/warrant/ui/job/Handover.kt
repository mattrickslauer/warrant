package ink.warrant.ui.job

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

/** The heading, and the sentence under it. Never "Done" — nothing here is done by itself. */
fun handoverHeadline(state: HandoverState, outstanding: Int): Pair<String, String> = when (state) {
    HandoverState.OUTSTANDING -> "Not finished yet" to
        "$outstanding step${if (outstanding == 1) "" else "s"} still ${
            if (outstanding == 1) "has" else "have"
        } something required and empty. This job cannot seal until every step has an " +
        "outcome. Nothing you captured is lost — go back and finish it whenever you like."

    HandoverState.WAITING -> "Handed to the fleet" to
        "Everything this procedure asked for is captured. Verification runs behind you, and " +
        "the record seals when the last step has a verdict. You can leave; it will not stop."

    HandoverState.SEALED -> "Sealed" to
        "The record is written and cannot be changed. It carries what went right and what " +
        "did not, and it names every agent that touched it."
}
