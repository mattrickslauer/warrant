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
)

/** Whether this field is satisfied through the lens rather than through a keyboard. */
fun FieldDef.usesCamera(): Boolean =
    kind == FieldKind.PHOTO || kind == FieldKind.VIDEO || source == FieldSource.CAMERA

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
