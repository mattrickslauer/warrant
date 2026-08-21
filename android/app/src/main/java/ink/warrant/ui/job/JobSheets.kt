package ink.warrant.ui.job

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.contract.Decision
import ink.warrant.contract.ReasonKind
import ink.warrant.contract.Step
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.AgentTrace
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.ReasonCapture
import ink.warrant.ui.components.StepBrief
import java.io.File

/**
 * Everything the step page cannot hold.
 *
 * The page is one screen and does not scroll, which is a promise about where the shutter is.
 * The cost of that promise is that prose, the second exit's keyboard and the fleet's reasoning
 * have to live somewhere else — so they live here, in sheets, each exactly one tap from the
 * surface. Sheets may scroll; the page underneath never does.
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Sheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    val colors = WarrantTheme.colors
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = colors.surface,
        contentColor = colors.fg,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = 560.dp)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = WarrantTheme.dim.pad)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(WarrantTheme.dim.stack),
            content = { content() },
        )
    }
}

/** The ⓘ. Why this step exists, and what good looks like, at full length. */
@Composable
fun StepBriefSheet(step: Step, total: Int, guidance: String?, onDismiss: () -> Unit) {
    Sheet(onDismiss) { StepBrief(step = step, total = total, guidance = guidance) }
}

/**
 * The ⚠. Exit two, with room for a keyboard and a microphone.
 *
 * Moving it into a sheet is not the same as burying it: the button that opens it is on the
 * bottom bar, the same size as the way forward and the same distance from the thumb. What
 * would have buried it is a menu.
 */
@Composable
fun BlockedSheet(
    recommendation: String?,
    onSubmit: (ReasonKind, String, File?) -> Unit,
    onDismiss: () -> Unit,
) {
    Sheet(onDismiss) {
        MonoLabel("Can't do this step?")
        ReasonCapture(
            onSubmit = { kind, transcript, audio ->
                onSubmit(kind, transcript, audio)
                onDismiss()
            },
            recommendation = recommendation,
        )
    }
}

/** The pull-up. What the fleet decided, whether the data is real, and the seal if there is one. */
@Composable
fun TraceSheet(
    decisions: List<Decision>,
    sealedRecordId: String?,
    fabricated: Boolean,
    onDismiss: () -> Unit,
) {
    Sheet(onDismiss) {
        if (fabricated) {
            // The build MUST say when it is serving fabricated data. A demo that looks like
            // production is how a judge gets misled, and we would rather be believed.
            HoldBanner(
                headline = "Fixture data",
                why = "This build runs the scripted demo timeline, not a live backend. " +
                    "Verdicts and costs below are fabricated; the instrument reading is not.",
                waiting = true,
            )
        }

        MonoLabel("What the fleet decided")
        if (decisions.isEmpty()) {
            Text(
                "Nothing yet. Verification runs behind you — decisions land here as they " +
                    "arrive, and you can carry on in the meantime.",
                style = WarrantTheme.type.bodySmall.copy(
                    color = WarrantTheme.colors.fg.copy(alpha = 0.7f),
                ),
            )
        } else {
            AgentTrace(decisions)
        }

        sealedRecordId?.let { id ->
            MonoLabel("Sealed")
            Text(id, style = WarrantTheme.type.mono.copy(color = WarrantTheme.colors.measured))
        }
    }
}
