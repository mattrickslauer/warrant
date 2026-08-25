package ink.warrant.ui.job

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ink.warrant.contract.ProvenanceClass
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.BusyRing
import ink.warrant.ui.components.EvidenceChip

/**
 * Something the technician needs to know that is not the step in front of them.
 *
 * Holds, errors and late verdicts all arrive as one of these. They used to be full-width
 * banners stacked above the work, which is what forced the page to scroll — and a page that
 * scrolls is a page where the shutter is sometimes off-screen. So they collapse to a single
 * pill and expand on a tap. A blocking one expands itself.
 */
data class Notice(
    val headline: String,
    val detail: String,
    val blocking: Boolean = false,
    val goToLabel: String? = null,
    val onGoTo: (() -> Unit)? = null,
    val onDismiss: (() -> Unit)? = null,
)

/** One field of the current step, as the strip above the bar draws it. */
data class FieldPip(
    val key: String,
    val label: String,
    val filled: Boolean,
    val required: Boolean,
)

/**
 * One step, one screen, no scrolling.
 *
 * The whole page is a stack: the lens (or the workshop ground) fills it edge to edge, and
 * everything else is drawn over the top. Three rules hold it together.
 *
 *  1. **It never scrolls.** Top chrome, a flexible middle, bottom chrome. Prose that will not
 *     fit is truncated and the full text moves behind the ⓘ — a step whose explanation pushed
 *     the shutter below the fold was the old layout's real failure.
 *  2. **The primary bar never moves.** Same place, same size, on every step and every field
 *     kind. Only the label changes — see [primaryActionFor]. A technician with dirty hands
 *     should never have to aim, and a button that moves is a button you have to look for.
 *  3. **Both exits stay on the surface.** Satisfy the step with the bar, or say why you cannot
 *     with the ⚠ beside it. There is still no third way out and no skip.
 *
 * [onRedo] is the one control that appears and disappears: it is offered only while a frame
 * from this step is on the backdrop, and it throws that frame away so the lens can be pointed
 * at the same field again. It sits above the bar rather than in it, so nothing the thumb has
 * already learned moves when it arrives.
 */
@Composable
fun StepPage(
    stepIndex: Int,
    stepCount: Int,
    title: String,
    prompt: String?,
    guidance: String?,
    evidence: ProvenanceClass,
    notices: List<Notice>,
    primary: PrimaryAction,
    onPrimary: () -> Unit,
    onExit: () -> Unit,
    onBrief: () -> Unit,
    onBlocked: () -> Unit,
    onTrace: () -> Unit,
    onBack: (() -> Unit)?,
    modifier: Modifier = Modifier,
    onRedo: (() -> Unit)? = null,
    pips: List<FieldPip> = emptyList(),
    activePipKey: String? = null,
    onPip: (String) -> Unit = {},
    backdrop: @Composable BoxScope.() -> Unit = {},
    center: @Composable BoxScope.() -> Unit = {},
) {
    Box(modifier.fillMaxSize().background(WarrantTheme.colors.bg)) {
        backdrop()

        // Scrims. The chrome is white-on-whatever-the-lens-sees, and without these a step
        // number lands on a chrome bumper and disappears. Cheap, and the difference between
        // legible and not.
        Scrim(Alignment.TopCenter, 240.dp, top = true)
        Scrim(Alignment.BottomCenter, 300.dp, top = false)

        // imePadding, not on the backdrop: the lens stays full bleed, but the chrome rides
        // above a soft keyboard. Without it the primary bar sits behind the IME on a
        // signature or text step — and on a page that does not scroll, a control behind the
        // keyboard is a control that does not exist.
        Column(Modifier.fillMaxSize().imePadding()) {
            TopChrome(
                stepIndex = stepIndex,
                stepCount = stepCount,
                title = title,
                prompt = prompt,
                guidance = guidance,
                evidence = evidence,
                notices = notices,
                onExit = onExit,
                onBrief = onBrief,
            )

            // Everything the field itself needs. Weighted, so it takes what is left over and
            // never pushes the bar off the bottom.
            Box(
                Modifier.weight(1f).fillMaxWidth().padding(horizontal = 24.dp),
                contentAlignment = Alignment.Center,
                content = center,
            )

            BottomChrome(
                primary = primary,
                onPrimary = onPrimary,
                onBlocked = onBlocked,
                onTrace = onTrace,
                onBack = onBack,
                onRedo = onRedo,
                pips = pips,
                activePipKey = activePipKey,
                onPip = onPip,
            )
        }
    }
}

// ------------------------------------------------------------------------------- top chrome

@Composable
private fun TopChrome(
    stepIndex: Int,
    stepCount: Int,
    title: String,
    prompt: String?,
    guidance: String?,
    evidence: ProvenanceClass,
    notices: List<Notice>,
    onExit: () -> Unit,
    onBrief: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OverlayIcon(Icons.Rounded.Close, "Leave this job", onExit)
            Spacer(Modifier.width(4.dp))
            StepTicks(stepIndex = stepIndex, stepCount = stepCount, modifier = Modifier.weight(1f))
            EvidenceChip(evidence)
            Spacer(Modifier.width(4.dp))
            OverlayIcon(Icons.Rounded.Info, "Why this step exists", onBrief)
        }

        notices.forEach { NoticePill(it) }

        // The instruction. Capped, on purpose: whatever does not fit lives behind the ⓘ, and
        // the page keeps its promise not to scroll.
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                title,
                style = WarrantTheme.type.titleSmall.copy(color = Color.White.copy(alpha = 0.7f)),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            // The ask itself, and it is the largest thing on the screen. On a camera step this
            // is the only sentence that matters: what you are being asked for, printed where
            // the lens is pointed.
            if (!prompt.isNullOrBlank()) {
                Text(
                    prompt,
                    style = WarrantTheme.type.title.copy(color = Color.White),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (!guidance.isNullOrBlank()) {
                Text(
                    guidance,
                    style = WarrantTheme.type.bodySmall.copy(
                        color = WarrantTheme.colors.inferred,
                    ),
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** How far through, drawn as the steps themselves rather than a percentage. */
@Composable
private fun StepTicks(stepIndex: Int, stepCount: Int, modifier: Modifier = Modifier) {
    val colors = WarrantTheme.colors
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "Step ${stepIndex + 1} of $stepCount",
            style = WarrantTheme.type.monoLabel.copy(color = Color.White),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            // Capped, so a twenty-step procedure does not push the chip off the row.
            repeat(minOf(stepCount, 8)) { i ->
                Box(
                    Modifier
                        .width(if (i == stepIndex) 14.dp else 6.dp)
                        .height(3.dp)
                        .background(
                            when {
                                i == stepIndex -> Color.White
                                i < stepIndex -> colors.measured
                                else -> Color.White.copy(alpha = 0.3f)
                            },
                            CircleShape,
                        ),
                )
            }
        }
    }
}

/**
 * A hold, an error or a late verdict, collapsed to one line.
 *
 * A blocking notice starts open, because the whole point of blocking is that it cannot be
 * scrolled past — and on this page there is nothing to scroll.
 */
@Composable
private fun NoticePill(notice: Notice) {
    val colors = WarrantTheme.colors
    var open by remember(notice.headline) { mutableStateOf(notice.blocking) }
    val accent = if (notice.blocking) colors.held else colors.inferred

    Column(
        Modifier
            .fillMaxWidth()
            .background(
                Color(0xE6202124),
                RoundedCornerShape(WarrantTheme.dim.rMd),
            )
            .border(1.dp, accent.copy(alpha = 0.5f), RoundedCornerShape(WarrantTheme.dim.rMd))
            .clickable { open = !open }
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Box(Modifier.size(8.dp).background(accent, CircleShape))
            Text(
                notice.headline,
                style = WarrantTheme.type.label.copy(color = accent),
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!open) {
                Text(
                    "Tap",
                    style = WarrantTheme.type.monoLabel.copy(color = Color.White.copy(alpha = 0.6f)),
                )
            }
        }

        if (open) {
            Text(
                notice.detail,
                style = WarrantTheme.type.bodySmall.copy(color = Color.White.copy(alpha = 0.85f)),
            )
            if (notice.onGoTo != null || notice.onDismiss != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    notice.onGoTo?.let { go ->
                        PillAction(notice.goToLabel ?: "Go there", accent, go)
                    }
                    notice.onDismiss?.let { later ->
                        PillAction("Later", Color.White.copy(alpha = 0.7f), later)
                    }
                }
            }
        }
    }
}

@Composable
private fun PillAction(label: String, color: Color, onClick: () -> Unit) {
    Text(
        label,
        style = WarrantTheme.type.label.copy(color = color),
        modifier = Modifier
            .border(1.dp, color.copy(alpha = 0.5f), WarrantTheme.pill)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

// ---------------------------------------------------------------------------- bottom chrome

@Composable
private fun BottomChrome(
    primary: PrimaryAction,
    onPrimary: () -> Unit,
    onBlocked: () -> Unit,
    onTrace: () -> Unit,
    onBack: (() -> Unit)?,
    onRedo: (() -> Unit)?,
    pips: List<FieldPip>,
    activePipKey: String?,
    onPip: (String) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 16.dp)
            .padding(bottom = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // What the fleet decided, and the sealed id, live one pull away rather than on the
        // page. Tap or drag — a gloved thumb finds the drag more reliably than the target.
        TraceHandle(onTrace)

        if (pips.size > 1) FieldStrip(pips, activePipKey, onPip)

        onRedo?.let { RedoPill(it) }

        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (onBack != null) {
                OverlayIcon(Icons.AutoMirrored.Rounded.ArrowBack, "Previous step", onBack)
            } else {
                Spacer(Modifier.size(WarrantTheme.dim.tap))
            }

            PrimaryBar(primary, onPrimary, Modifier.weight(1f))

            // Exit two. Never buried, never styled as a failure — it is the same size and the
            // same distance from the thumb as the way forward.
            OverlayIcon(
                icon = Icons.Rounded.Warning,
                description = "Can't do this step",
                onClick = onBlocked,
                tint = WarrantTheme.colors.inferred,
            )
        }
    }
}

/**
 * Throw this frame away and look again.
 *
 * Only ever offered when there is a frame from this step on screen, and it discards exactly
 * that one — the field it belongs to, on the step in front of you. Nothing else on the job is
 * touched, and the record already holding an earlier frame is not rewritten: a capture that
 * happened is a thing that happened. What Redo does is put the lens back so a better one can
 * be taken beside it.
 *
 * Deliberately not the big bar. The bar's job is to move you forward; a control that destroys
 * work should be a separate, smaller, differently-shaped decision — while still landing on the
 * 44dp target a gloved thumb can hit.
 */
@Composable
private fun RedoPill(onClick: () -> Unit) {
    Row(
        Modifier
            .heightIn(min = 44.dp)
            .background(Color(0xCC202124), WarrantTheme.pill)
            .border(1.dp, Color.White.copy(alpha = 0.45f), WarrantTheme.pill)
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            Icons.Rounded.Refresh,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(18.dp),
        )
        Text(
            "Redo this capture",
            style = WarrantTheme.type.label.copy(color = Color.White),
            maxLines = 1,
        )
    }
}

/**
 * The one big target.
 *
 * 60dp tall and fully rounded, flush against both side buttons. A capture reads white — it is
 * a shutter and shutters are white — and everything else reads in the action colour, so
 * "record something" and "move on" are never the same shape of decision.
 */
@Composable
private fun PrimaryBar(action: PrimaryAction, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = WarrantTheme.colors
    val shutter = action.kind == ActionKind.CAPTURE
    val container = when {
        !action.enabled -> Color.White.copy(alpha = 0.22f)
        shutter -> Color.White
        else -> colors.action
    }
    val content = when {
        !action.enabled -> Color.White.copy(alpha = 0.6f)
        shutter -> Color(0xFF202124)
        else -> colors.onAction
    }

    Row(
        modifier
            .height(60.dp)
            .background(container, WarrantTheme.pill)
            .then(if (action.enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        // Busy wins the slot the shutter ring would have had. The bar is where the thumb is
        // already resting and where the eye already is, so it is the right place to say the
        // device is still working — and a turning ring where the shutter was is unambiguous
        // about which tap is still being honoured.
        if (action.busy) {
            BusyRing(color = content, diameter = 22.dp)
            Spacer(Modifier.width(12.dp))
        } else if (shutter) {
            // Drawn, not an icon. Two concentric rings is what a shutter is, and it is the
            // one control on this screen that has to read as a camera before it reads as text.
            Box(
                Modifier
                    .size(26.dp)
                    .border(2.dp, content, CircleShape)
                    .padding(4.dp)
                    .background(content, CircleShape),
            )
            Spacer(Modifier.width(12.dp))
        }
        Text(
            action.label,
            style = WarrantTheme.type.titleSmall.copy(color = content),
            maxLines = 1,
        )
    }
}

/** One pip per field of this step. Filled means recorded; tap to go back and redo one. */
@Composable
private fun FieldStrip(pips: List<FieldPip>, activeKey: String?, onPip: (String) -> Unit) {
    val colors = WarrantTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        pips.forEach { pip ->
            val active = pip.key == activeKey
            val hue = when {
                pip.filled -> colors.measured
                active -> Color.White
                else -> Color.White.copy(alpha = 0.45f)
            }
            Row(
                Modifier
                    .background(
                        if (active) Color(0xCC202124) else Color(0x66202124),
                        WarrantTheme.pill,
                    )
                    .then(
                        if (active) Modifier.border(1.dp, hue.copy(alpha = 0.7f), WarrantTheme.pill)
                        else Modifier,
                    )
                    .clickable { onPip(pip.key) }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    Modifier
                        .size(7.dp)
                        .then(
                            if (pip.filled) Modifier.background(hue, CircleShape)
                            else Modifier.border(1.dp, hue, CircleShape),
                        ),
                )
                Text(
                    pip.label,
                    style = WarrantTheme.type.monoLabel.copy(color = hue),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.width(72.dp),
                )
            }
        }
    }
}

@Composable
private fun TraceHandle(onTrace: () -> Unit) {
    Row(
        Modifier
            .background(Color(0x99202124), WarrantTheme.pill)
            .clickable(onClick = onTrace)
            .padding(horizontal = 14.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            Icons.Rounded.KeyboardArrowUp,
            contentDescription = null,
            tint = Color.White.copy(alpha = 0.7f),
            modifier = Modifier.size(16.dp),
        )
        Text(
            "What the fleet decided",
            style = WarrantTheme.type.monoLabel.copy(color = Color.White.copy(alpha = 0.7f)),
        )
    }
}

// -------------------------------------------------------------------------------- primitives

/**
 * A round overlay button on the 48dp tap target.
 *
 * Dark disc rather than a bare glyph: a white icon over a white workbench is invisible, and
 * this screen cannot know what the lens is pointed at.
 */
@Composable
private fun OverlayIcon(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    tint: Color = Color.White,
) {
    Box(
        Modifier
            .size(WarrantTheme.dim.tap)
            .background(Color(0x99202124), CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = tint, modifier = Modifier.size(22.dp))
    }
}

@Composable
private fun BoxScope.Scrim(alignment: Alignment, height: androidx.compose.ui.unit.Dp, top: Boolean) {
    val stops = if (top) {
        arrayOf(0f to Color.Black.copy(alpha = 0.72f), 1f to Color.Transparent)
    } else {
        arrayOf(0f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.82f))
    }
    Box(
        Modifier
            .align(alignment)
            .fillMaxWidth()
            .height(height)
            .background(Brush.verticalGradient(colorStops = stops)),
    )
}
