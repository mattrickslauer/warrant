package ink.warrant.ui.job

import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource

/**
 * What the one big button at the bottom of a step means right now.
 *
 * The step page has exactly one primary target and it never moves, so the only thing left to
 * decide is what it *says* and what it *does*. That decision is here, in plain Kotlin with no
 * Compose and no Android, because it is the only part of the layout that can be wrong in a way
 * a screenshot would not show: a bar reading "Next step" on a step that is not finished, or
 * "Capture" pointed at a measurement field, is a lie told by a button.
 */
enum class ActionKind {
    /** Open the shutter on the field the lens is pointed at. */
    CAPTURE,

    /** Take the instrument's latest value onto the form. Never typed. */
    TAKE_READING,

    /** No instrument attached, so the only honest next move is to go and attach one. */
    PAIR,

    /** Commit what the person typed. */
    RECORD,

    /** Commit a name. */
    SIGN,

    /**
     * The procedure asked for something this screen can never produce, so the only honest
     * move is exit two.
     *
     * Not a skip. It opens the same ⚠ sheet the bottom bar already offers and the technician
     * states, in their words, what the procedure asked them for and why it could not be
     * given. The difference from tapping the ⚠ themselves is that the BAR says it — because a
     * grey bar over a question with no answers is indistinguishable from a broken app, and
     * the person standing there stops rather than reaching for a control they have no reason
     * to think is relevant.
     */
    DECLARE,

    /** Every required field is filled. Move on. */
    ADVANCE,

    /** Same, on the last step. */
    FINISH,
}

data class PrimaryAction(
    val label: String,
    val kind: ActionKind,
    val enabled: Boolean,
    /**
     * The device is doing the thing the last tap asked for, and has not finished.
     *
     * Separate from `!enabled`, which this also implies, because the two mean different things
     * to the person looking at the button. "Waiting for the tool" is disabled and idle: nothing
     * is happening, and nothing will until the tool reports. A capture being masked is disabled
     * and *working*. Rendered identically — a grey bar — the second one reads as a hung app,
     * which is exactly the complaint this exists to answer. See [working].
     */
    val busy: Boolean = false,
)

/** Whether this field is satisfied through the lens rather than through a keyboard. */
fun FieldDef.usesCamera(): Boolean =
    kind == FieldKind.PHOTO || kind == FieldKind.VIDEO || source == FieldSource.CAMERA

/**
 * Whether this field is satisfied by typing.
 *
 * Stated as its own rule for the same reason the measurement branch of [primaryActionFor] is:
 * the keyboard is a claim about what kind of answer a field takes, and the two kinds that must
 * never see one are easy to reach by accident. A measurement typed by hand is a lie about
 * provenance. A CHOICE typed by hand is subtler and was live: the step page had no branch for
 * it, so a field carrying three fixed answers fell through to the generic text box — a blank
 * line reading "Type the value" under "How do the brakes perform?", indistinguishable from the
 * signature box below it. The technician typed their name into it, which was then judged
 * against "Responsive and quiet" and escalated. The options were there in [FieldDef.choices]
 * the whole time; nothing drew them.
 *
 * So this answers a keyboard question with a keyboard rule, and everything else — scan on a
 * human source, location — keeps the free text box it always had.
 */
fun FieldDef.usesKeyboard(): Boolean =
    !usesCamera() && kind != FieldKind.MEASUREMENT && kind != FieldKind.CHOICE

/**
 * Why nobody could answer this field on any surface, in the shop's words — or null if they can.
 *
 * The distinction this draws is not "hard" versus "easy". A measurement with no instrument in
 * the room is not in here: pairing a tool is a real move a real person can go and make, and
 * the bar says so. What is in here is a field the PROCEDURE has made unperformable, where no
 * amount of effort, tooling or goodwill produces a value — the question has no answers.
 *
 * That case was live and it wedged a job. `proc_segway_xyber_brake_pad_replacement` shipped a
 * `choice` field whose `choices` array was empty. The page drew a sentence saying it could not
 * be answered and left the bar grey; the bar is the only way forward on a step, so the run
 * stopped there. Every step after it was unreachable, the job could never reach an outcome,
 * and the technician's only remaining option was to close the app — which loses the four
 * captures they had already made.
 *
 * A procedure is allowed to be wrong. It is NOT allowed to trap the person performing it, and
 * those are separate promises: this names the fault so the bar can offer exit two, and the
 * fault itself is then on the record for the fleet to rule on.
 *
 * The final branch is the one that has no known case, and that is why it is there. Every kind
 * the page can draw is listed above it, so a kind added to the contract without a branch on
 * the step page arrives here as a stated fault instead of as a dead button.
 */
fun FieldDef.unanswerable(): String? = when {
    usesCamera() -> null
    kind == FieldKind.MEASUREMENT -> null
    kind == FieldKind.SIGNATURE -> null
    kind == FieldKind.CHOICE ->
        if (choices.isEmpty()) {
            "This step accepts one of a fixed set of answers and the procedure lists none."
        } else {
            null
        }
    usesKeyboard() -> null
    else -> "Nothing on this screen can produce a \"${kind.name.lowercase()}\" answer."
}

/**
 * Whether this field is still holding the step open.
 *
 * Required and empty, in the ordinary case. The exception is the whole point of this function
 * existing separately from [FieldDef.requiredAt]: a field the procedure made [unanswerable]
 * stops holding the step once the technician has stated why — [reasoned].
 *
 * That is not the same as marking it satisfied, and the difference is the product. Nothing is
 * filled, nothing is accepted, and no capture is invented. What changes is who the step is
 * waiting on: before the reason it was waiting on a person who could never produce one, and
 * after it, on the fleet, which will read the reason and rule. The client cannot write
 * `performed`, `waived` or `impossible` — firestore.rules refuses all three — so releasing the
 * hands here cannot release the seal, which is exactly the property that makes it safe.
 */
fun FieldDef.holdsStep(strictness: Int, reasoned: Boolean, filled: Boolean): Boolean {
    if (!requiredAt(strictness)) return false
    if (filled) return false
    return !(reasoned && unanswerable() != null)
}

/**
 * The field the page is currently pointed at.
 *
 * Normally the first required field that is still empty — the technician is walked forward and
 * never has to choose. [selected] overrides it, which is how the field strip lets somebody go
 * back and retake something already filled. Null means nothing is outstanding, and the bar
 * becomes the way out of the step.
 *
 * [reasoned] is whether exit two has already been taken on this step. It is passed in rather
 * than inferred because it is the one thing that can retire an unanswerable field: without it
 * the page points at the same impossible question forever, and a technician who has already
 * said why they cannot answer it is asked again on every return to the step.
 */
fun activeFieldFor(
    fields: List<FieldDef>,
    strictness: Int,
    selected: String?,
    reasoned: Boolean = false,
    isFilled: (String) -> Boolean,
): FieldDef? {
    selected?.let { key -> fields.firstOrNull { it.key == key }?.let { return it } }
    return fields.firstOrNull { it.holdsStep(strictness, reasoned, isFilled(it.key)) }
}

/**
 * The camera field whose frame is currently filling the screen, if any.
 *
 * A step can hold more than one lens field, and the backdrop can only draw one of them. While
 * something is still outstanding that is the active field — the picture you have just taken
 * and are deciding about. Once nothing is outstanding the step's own last frame stays up
 * behind "Next step", so you can still see what you recorded.
 *
 * It is also the answer to "what would Redo throw away". Redo is scoped to exactly this field
 * on exactly this step: the frame on screen goes, the lens comes back, and every other field
 * and every other step is left alone.
 */
fun framedFieldFor(
    fields: List<FieldDef>,
    active: FieldDef?,
    hasFrame: (String) -> Boolean,
): FieldDef? {
    if (active != null) return active.takeIf { it.usesCamera() && hasFrame(it.key) }
    return fields.firstOrNull { it.usesCamera() && hasFrame(it.key) }
}

/**
 * The label and behaviour of the primary bar.
 *
 * [fieldFilled] is not redundant with a null [field]: a filled field can still be the active
 * one when the technician has deliberately gone back to redo it, and the bar has to offer the
 * retake rather than pretend there is nothing to do.
 */
fun primaryActionFor(
    field: FieldDef?,
    fieldFilled: Boolean,
    lastStep: Boolean,
    instrumentConnected: Boolean,
    instrumentHasReading: Boolean,
    inputReady: Boolean,
): PrimaryAction {
    if (field == null) {
        return if (lastStep) {
            PrimaryAction("Finish", ActionKind.FINISH, enabled = true)
        } else {
            PrimaryAction("Next step", ActionKind.ADVANCE, enabled = true)
        }
    }

    // Before anything else, including the lens.
    //
    // A field nobody can answer must never reach the branches below, because every one of
    // them ends in a control that does nothing: a keyboard for a question with no answers, a
    // "Record" that stays grey however long you look at it. The bar names the fault and opens
    // the way out instead. See [FieldDef.unanswerable].
    if (field.unanswerable() != null) {
        return PrimaryAction("This can't be answered", ActionKind.DECLARE, enabled = true)
    }

    if (field.usesCamera()) {
        return PrimaryAction(
            label = if (fieldFilled) "Retake" else "Capture",
            kind = ActionKind.CAPTURE,
            enabled = true,
        )
    }

    return when (field.kind) {
        // The measurement branch is the one that matters. There is no path through here that
        // reaches a keyboard, at any strictness, in any state — including the state where no
        // instrument is attached. "Cannot be satisfied" is a real outcome; a typed number
        // wearing the measured chip is not.
        FieldKind.MEASUREMENT -> when {
            !instrumentConnected ->
                PrimaryAction("Pair an instrument", ActionKind.PAIR, enabled = true)
            !instrumentHasReading ->
                PrimaryAction("Waiting for the tool", ActionKind.TAKE_READING, enabled = false)
            else -> PrimaryAction(
                label = if (fieldFilled) "Take it again" else "Take this reading",
                kind = ActionKind.TAKE_READING,
                enabled = true,
            )
        }

        FieldKind.SIGNATURE -> PrimaryAction("Sign", ActionKind.SIGN, enabled = inputReady)

        else -> PrimaryAction(
            label = if (fieldFilled) "Change it" else "Record",
            kind = ActionKind.RECORD,
            enabled = inputReady,
        )
    }
}

/**
 * The bar while the device is finishing what the last tap started.
 *
 * [what] is the work, named in plain language — "Masking faces…", not "Loading…". Null means
 * nothing is in flight and the bar is left exactly as [primaryActionFor] computed it.
 *
 * Here rather than in the composable for the same reason everything else in this file is:
 * the label on the one big button is a claim about what the device is doing, and a claim that
 * outlives the work — a bar still reading "Masking faces…" over a finished capture — is a lie
 * a screenshot would not catch. The disable is not belt-and-braces either: the shutter fires
 * on the *camera handle*, which is still wired up while the frame is being processed, so a
 * second tap during that second would take a second photograph into a slot that already has
 * one under review.
 */
fun PrimaryAction.working(what: String?): PrimaryAction =
    if (what == null) this else copy(label = what, enabled = false, busy = true)
