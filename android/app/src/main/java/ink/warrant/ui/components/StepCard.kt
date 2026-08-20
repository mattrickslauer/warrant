package ink.warrant.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.contract.Step
import ink.warrant.design.WarrantTheme

/**
 * One card. Three things shown, two exits offered, no third way out.
 *
 * The three things are the INSTRUCTION (what to do), the EXPLANATION (why this step exists and
 * what goes wrong without it) and the GUIDANCE (what good looks like). The guidance block is
 * the acceptance rule in plain language — the SAME rule the Inspector applies after the
 * capture, shown to the person before it. Every round trip it prevents is a model call the
 * Ledger does not spend, and a technician who does not have to guess.
 *
 * The exits row is never empty and never reorders. The capture button is in the same place on
 * every step, and "I can't do this" is never buried.
 */
@Composable
fun StepCard(
    step: Step,
    total: Int,
    modifier: Modifier = Modifier,
    guidance: String? = null,
    content: @Composable ColumnScope.() -> Unit = {},
    exits: @Composable ColumnScope.() -> Unit = {},
) {
    val colors = WarrantTheme.colors
    val type = WarrantTheme.type
    val dim = WarrantTheme.dim

    Column(
        modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(dim.stack),
    ) {
        MonoLabel("Step ${step.index} of $total")

        Text(step.title, style = type.title.copy(color = colors.fg))

        // The Scoper's words to a human. Sans, generous measure — this is prose, not data.
        Text(
            step.explanation,
            style = type.body.copy(color = colors.fg.copy(alpha = 0.8f)),
        )

        if (!guidance.isNullOrBlank()) {
            // A Material filled-tonal container in the inferred hue. Guidance is help, not a
            // warning, so it gets a container rather than a bordered callout.
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(
                        colors.container(colors.inferred, 0.14f),
                        RoundedCornerShape(WarrantTheme.dim.rMd),
                    )
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                MonoLabel("What good looks like", color = colors.inferred)
                Text(guidance, style = type.bodySmall.copy(color = colors.fg))
            }
        }

        content()

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { exits() }
    }
}
