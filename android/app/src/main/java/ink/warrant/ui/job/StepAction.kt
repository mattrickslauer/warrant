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
 * The field the page is currently pointed at.
 *
 * Normally the first required field that is still empty — the technician is walked forward and
 * never has to choose. [selected] overrides it, which is how the field strip lets somebody go
 * back and retake something already filled. Null means nothing is outstanding, and the bar
 * becomes the way out of the step.
 */
fun activeFieldFor(
    fields: List<FieldDef>,
    strictness: Int,
    selected: String?,
    isFilled: (String) -> Boolean,
): FieldDef? {
    selected?.let { key -> fields.firstOrNull { it.key == key }?.let { return it } }
    return fields.firstOrNull { it.requiredAt(strictness) && !isFilled(it.key) }
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
