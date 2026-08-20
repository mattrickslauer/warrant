package ink.warrant.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ink.warrant.contract.Agent
import ink.warrant.design.WarrantTheme

/**
 * Inspection stamps, not mascots.
 *
 * In QA and aviation an inspector carries a personal stamp that goes onto the record; every
 * row of a sealed record shows the mark of the agent that stamped it. One line weight,
 * monochrome, on a consistent disc.
 *
 * THE PATH DATA IS COPIED VERBATIM from `web/src/components/AgentStamp.tsx`, and it is parsed
 * at runtime rather than redrawn with Compose primitives. That is deliberate: a stamp
 * hand-redrawn in two stacks becomes two subtly different stamps, and the whole point of a
 * stamp is that it is recognisably the same mark every time. Same string, same mark.
 */
private val MARKS: Map<Agent, List<String>> = mapOf(
    // an interview bracket — the question that keeps being asked
    Agent.SCOPER to listOf("M15 6c-3 0-3 4-3 6s0-6-3-6M15 18c-3 0-3-4-3-6s0 6-3 6"),
    // a branch — one job delegating
    Agent.FOREMAN to listOf("M12 18V13m0 0 4-5m-4 5-4-5"),
    // a lens
    Agent.INSPECTOR to listOf("M14.4 11a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0", "m13.6 13.6 3 3"),
    // a struck lens — the same instrument, doubting
    Agent.SKEPTIC to listOf(
        "M14.4 11a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0",
        "m13.6 13.6 3 3M7.5 15.5 16 7",
    ),
    // a tally — counting across weeks
    Agent.AUDITOR to listOf("M9 8v8M11.5 8v8M14 8v8M7.5 15l8-6"),
    // a speech mark — spoken, then acted on
    Agent.INSTRUCTOR to listOf(
        "M9.5 14c-1.4 0-2.2-1-2.2-2.2S8.1 9.5 9.4 9.5c1.6 0 2.4 1.2 2.1 2.8-.3 1.5-1.3 2.4-2.6 2.9" +
            "M16 14c-1.4 0-2.2-1-2.2-2.2s.8-2.3 2.1-2.3c1.6 0 2.4 1.2 2.1 2.8-.3 1.5-1.3 2.4-2.6 2.9",
    ),
    // a pin — a driver fixed to an unfamiliar device
    Agent.WRIGHT to listOf("M12 18V12m0 0 2.5-2.5a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0L9 9m3 3L9.5 9.5"),
)

/** The authored viewBox. Everything below is in these units and scaled at draw time. */
private const val VIEWPORT = 24f

@Composable
fun AgentStamp(
    agent: Agent,
    modifier: Modifier = Modifier,
    size: Dp = 26.dp,
    tint: Color? = null,
) {
    val color = tint ?: WarrantTheme.colors.fg
    val paths = remember(agent) {
        MARKS[agent].orEmpty().map { PathParser().parsePathString(it).toPath() }
    }

    Canvas(modifier.size(size)) {
        val scale = this.size.minDimension / VIEWPORT
        withTransform({ scale(scale, scale, pivot = Offset.Zero) }) {
            // The disc every mark sits on, softer than the mark itself.
            drawCircle(
                color = color.copy(alpha = 0.45f),
                radius = 11f,
                center = Offset(12f, 12f),
                style = Stroke(width = 1.25f),
            )
            paths.forEach { p ->
                drawPath(
                    path = p,
                    color = color,
                    style = Stroke(width = 1.25f, cap = StrokeCap.Round, join = StrokeJoin.Round),
                )
            }
        }
    }
}
