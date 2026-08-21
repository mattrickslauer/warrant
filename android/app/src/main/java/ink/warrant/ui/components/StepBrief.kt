package ink.warrant.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.contract.Step
import ink.warrant.design.WarrantTheme

/**
 * Why this step exists, at length.
 *
 * Three things are said here: the INSTRUCTION (what to do), the EXPLANATION (why the step
 * exists and what goes wrong without it) and the GUIDANCE (what good looks like). The guidance
 * is the acceptance rule in plain language — the SAME rule the Inspector applies after the
 * capture, shown to the person before it. Every round trip it prevents is a model call the
 * Ledger does not spend, and a technician who does not have to guess.
 *
 * It lives behind the ⓘ rather than on the step page because prose is what used to make that
 * page scroll, and a page that scrolls is a page where the shutter is sometimes off-screen.
 * The short form — title plus one line of guidance — stays on the page; this is the long form,
 * one tap away, for the person who wants to know why they are being asked.
 */
@Composable
fun StepBrief(
    step: Step,
    total: Int,
    modifier: Modifier = Modifier,
    guidance: String? = null,
) {
    val colors = WarrantTheme.colors
    val type = WarrantTheme.type

    Column(
        modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(WarrantTheme.dim.stack),
    ) {
        MonoLabel("Step ${step.index} of $total")

        Text(step.title, style = type.title.copy(color = colors.fg))

        // The Scoper's words to a human. Sans, generous measure — this is prose, not data.
        Text(step.explanation, style = type.body.copy(color = colors.fg.copy(alpha = 0.8f)))

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
    }
}
