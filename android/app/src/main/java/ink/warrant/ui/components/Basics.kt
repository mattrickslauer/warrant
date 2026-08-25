package ink.warrant.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ink.warrant.contract.JobStatus
import ink.warrant.contract.ProvenanceClass
import ink.warrant.design.Tokens
import ink.warrant.design.WarrantTheme
import ink.warrant.instrument.formatReading

/**
 * The small primitives, on Material 3. Every screen is these arranged differently, which is
 * what keeps a second pair of hands from inventing a parallel vocabulary.
 *
 * These mirror `web/src/components/` by name and by behaviour on purpose. If one of them
 * changes here, it changes there too — a chip that means one thing in the app and another on
 * the record is worse than having no chip at all.
 */

/** A hairline. Structure, never decoration. */
@Composable
fun Rule(modifier: Modifier = Modifier, strong: Boolean = false) {
    val colors = WarrantTheme.colors
    Box(
        modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(if (strong) colors.fg3 else colors.hairline),
    )
}

/**
 * One of the four provenance classes, drawn as a Material 3 assist chip: a tonal container in
 * the class's hue, on the small corner, with the dot leading.
 *
 * The label is ALWAYS rendered. Colour never carries the meaning on its own — the classes are
 * the product, and a reader who cannot distinguish green from amber still has to get them.
 *
 * [out] draws the chip outlined and struck through: this class was out of reach on this
 * surface. That is the honest call to action, not a disabled state.
 */
@Composable
fun EvidenceChip(
    cls: ProvenanceClass,
    modifier: Modifier = Modifier,
    out: Boolean = false,
) {
    val colors = WarrantTheme.colors
    val color = if (out) colors.fg3 else colors.of(cls)
    Row(
        modifier
            .heightIn(min = 28.dp)
            .background(
                color = if (out) Color.Transparent else colors.container(colors.of(cls), 0.16f),
                shape = RoundedCornerShape(WarrantTheme.dim.rSm),
            )
            .then(
                if (out) Modifier.border(1.dp, colors.hairline, RoundedCornerShape(WarrantTheme.dim.rSm))
                else Modifier,
            )
            .padding(horizontal = 12.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.size(7.dp).background(color, CircleShape))
        Text(
            text = cls.name.lowercase(),
            style = WarrantTheme.type.monoLabel.copy(
                color = color,
                textDecoration = if (out) TextDecoration.LineThrough else null,
            ),
        )
    }
}

private fun labelOf(status: JobStatus) = when (status) {
    // Named for what it means to the person holding the phone, not for the enum. Nothing runs
    // on a draft until someone says go.
    JobStatus.DRAFT -> "Not started"
    JobStatus.OPEN -> "Open"
    JobStatus.WAITING -> "Waiting on evidence"
    JobStatus.HELD -> "Held"
    JobStatus.SEALED -> "Sealed"
}

/** Where a job stands. `held` beats, because it is the one that has to be noticed. */
@Composable
fun StatusPill(status: JobStatus, modifier: Modifier = Modifier) {
    val color = WarrantTheme.colors.of(status)
    val alpha = if (status == JobStatus.HELD) beatAlpha() else 1f
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(8.dp).alpha(alpha).background(color, CircleShape))
        Text(labelOf(status), style = WarrantTheme.type.label.copy(color = color))
    }
}

/** The slow pulse shared by `held` and a live camera. Not an attention-grab; a heartbeat. */
@Composable
private fun beatAlpha(): Float {
    val transition = androidx.compose.animation.core.rememberInfiniteTransition(label = "beat")
    val a by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.35f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "beat",
    )
    return a
}

/**
 * The one thing on this device that says work is happening RIGHT NOW.
 *
 * Distinct from [SkeletonBar] and [Loading], which stand in for something being read, and
 * distinct again from the `beatAlpha` heartbeat, which says a state persists — a held machine,
 * an open lens. This turns, and a turning ring is the only shape a person reads as "it is
 * still going" rather than "it has stopped here".
 *
 * It is used where the alternative is a screen that looks broken: between the shutter and the
 * frame, and while that frame is being masked on device. Both of those are real seconds of
 * real work, and neither of them used to draw anything at all — the primary bar simply went
 * grey, which reads as a dead button, not as a busy one. It is deliberately NOT used for a
 * verdict: capture never waits on a model, and a spinner over the agents would be a promise
 * this product does not make.
 *
 * The track behind the sweep is what keeps it legible on a live camera frame, where a bare arc
 * disappears against anything pale.
 */
@Composable
fun BusyRing(
    color: Color = WarrantTheme.colors.fg,
    diameter: Dp = 18.dp,
    modifier: Modifier = Modifier,
) {
    val transition = androidx.compose.animation.core.rememberInfiniteTransition(label = "busy")
    val start by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        // Linear, and one turn per 900ms — the same tempo as the heartbeat, so the two do not
        // read as two different clocks running on one screen.
        animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart),
        label = "sweep",
    )

    Canvas(modifier.size(diameter)) {
        val stroke = Stroke(width = size.minDimension * 0.13f, cap = StrokeCap.Round)
        val inset = stroke.width / 2f
        val box = androidx.compose.ui.geometry.Size(
            size.width - stroke.width,
            size.height - stroke.width,
        )
        val at = androidx.compose.ui.geometry.Offset(inset, inset)
        drawArc(
            color = color.copy(alpha = 0.22f),
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = at,
            size = box,
            style = stroke,
        )
        drawArc(
            color = color,
            startAngle = start,
            sweepAngle = 96f,
            useCenter = false,
            topLeft = at,
            size = box,
            style = stroke,
        )
    }
}

/**
 * A bar standing in for a line that has not arrived yet.
 *
 * Deliberately the size of the text it is holding a place for, so nothing on the page moves
 * when the real thing lands. A layout that jumps at the end of a read is how a person ends up
 * tapping the row below the one they aimed at.
 */
@Composable
fun SkeletonBar(
    fraction: Float = 1f,
    height: Dp = 14.dp,
    modifier: Modifier = Modifier,
) {
    val colors = WarrantTheme.colors
    Box(
        modifier
            .fillMaxWidth(fraction)
            .height(height)
            .alpha(beatAlpha())
            .background(colors.surfaceHighest, RoundedCornerShape(Tokens.Shape.rXs)),
    )
}

/**
 * What a screen shows while its read is still in flight.
 *
 * This exists because the alternative here was worse than a spinner. Every list on this device
 * renders its EMPTY state during the read, so a records list that is merely slow says "Nothing
 * yet" and a record that is merely slow says "No record with that id on this device." Both are
 * false, and both are the kind of false somebody acts on: they back out, or they conclude the
 * seal never took. A record is the one thing in this product that has to be trustworthy when
 * it is looked at, and telling a technician it does not exist for the second and a half
 * Firestore is thinking is exactly the wrong lie to tell.
 *
 * [what] is said in plain language and names the read, not the spinner — "Reading this
 * device's jobs", not "Loading…". If it takes long enough to read, the sentence should be
 * worth having read.
 *
 * The bars breathe on [beatAlpha], the same slow pulse a held job and a live camera use. One
 * heartbeat in the app rather than three different ideas about what waiting looks like.
 */
@Composable
fun Loading(
    what: String,
    modifier: Modifier = Modifier,
    rows: Int = 3,
) {
    // Fixed rather than random: a skeleton that reshuffles on every recomposition reads as a
    // page loading twice.
    val widths = listOf(0.66f, 0.31f, 0.82f, 0.24f, 0.58f, 0.37f, 0.74f, 0.29f)
    Column(
        modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(WarrantTheme.dim.stack),
    ) {
        MonoLabel(what)
        repeat(rows) { row ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SkeletonBar(widths[(row * 2) % widths.size], 16.dp)
                SkeletonBar(widths[(row * 2 + 1) % widths.size], 12.dp)
            }
            Rule()
        }
    }
}

/**
 * The thesis rendered, as a Material filled-tonal container.
 *
 * A number that arrived from a paired instrument, carrying the tool that produced it and the
 * moment it did. Nothing else on any screen gets this treatment, because nothing else earned
 * it: every other value on a form was typed, chosen or photographed by the person being
 * verified. This one was not.
 */
@Composable
fun ReadingBadge(
    value: Double,
    unit: String,
    at: String,
    toolId: String,
    modifier: Modifier = Modifier,
) {
    val colors = WarrantTheme.colors
    val time = if (at.length > 19) at.substring(11, 19) else at
    val shown = formatReading(value)

    Row(
        modifier
            .background(
                colors.container(colors.measured, 0.16f),
                RoundedCornerShape(WarrantTheme.dim.rMd),
            )
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(
            if (unit.isBlank()) shown else "$shown $unit",
            style = WarrantTheme.type.monoValue.copy(color = colors.measured),
        )
        // maxLines, because a long value used to squeeze these until the tool id wrapped one
        // character per line. An identifier broken across five lines is not an identifier.
        Text(
            time,
            style = WarrantTheme.type.monoLabel.copy(color = colors.measured.copy(alpha = 0.85f)),
            maxLines = 1,
        )
        Text(
            "tool #$toolId",
            style = WarrantTheme.type.monoLabel.copy(color = colors.measured.copy(alpha = 0.85f)),
            maxLines = 1,
        )
    }
}

/**
 * The primary action: a Material 3 filled button. Fully rounded, sentence case, label-large.
 *
 * Height is pinned to the 48dp tap target and never shrinks: this is used with gloves on and
 * with dirty hands, and the one thing a technician should never have to do is aim.
 */
@Composable
fun WarrantButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    ghost: Boolean = false,
    tonal: Boolean = false,
    leading: @Composable (RowScope.() -> Unit)? = null,
) {
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim
    val shape = WarrantTheme.pill

    if (ghost) {
        OutlinedButton(
            onClick = onClick,
            modifier = modifier.heightIn(min = dim.tap),
            enabled = enabled,
            shape = shape,
            border = BorderStroke(1.dp, colors.hairline),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.action),
        ) {
            leading?.invoke(this)
            Text(text, style = WarrantTheme.type.label)
        }
    } else {
        Button(
            onClick = onClick,
            modifier = modifier.heightIn(min = dim.tap),
            enabled = enabled,
            shape = shape,
            colors = if (tonal) {
                ButtonDefaults.buttonColors(
                    containerColor = colors.container(colors.action, 0.20f),
                    contentColor = colors.action,
                )
            } else {
                ButtonDefaults.buttonColors(
                    containerColor = colors.action,
                    contentColor = colors.onAction,
                )
            },
        ) {
            leading?.invoke(this)
            Text(text, style = WarrantTheme.type.label)
        }
    }
}

/**
 * A small supporting label. Column heads, section marks, meta.
 *
 * Sentence case and sans: Material 3 retired the tracked-out uppercase micro-label, and the
 * mono face is reserved for values a machine produced.
 */
@Composable
fun MonoLabel(text: String, modifier: Modifier = Modifier, color: Color? = null) {
    Text(
        text,
        modifier = modifier,
        style = WarrantTheme.type.label.copy(color = color ?: WarrantTheme.colors.fg2),
    )
}
