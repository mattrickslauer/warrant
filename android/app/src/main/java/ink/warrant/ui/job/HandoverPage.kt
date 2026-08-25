package ink.warrant.ui.job

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.contract.Decision
import ink.warrant.contract.Step
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.AgentTrace
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.WarrantButton

/**
 * The end of the work, which is not the end of the job.
 *
 * Finish used to be wired to "advance one step", and there is no step after the last one — so
 * the button did nothing at all. This is what it does instead. It is a screen rather than a
 * dismissal because the moment the technician stops is the moment three separate things are
 * true and none of them is "done": what is still owed, what the fleet has decided so far, and
 * whether a record exists yet. Sending them back to the procedure list would have thrown all
 * three away.
 *
 * It scrolls, unlike [StepPage]. Nothing here is done with the hands, so nothing here has to
 * stay under the thumb, and the trace is worth reading in full.
 *
 * Still the workshop ground. The paper ground belongs to the record, and until this job seals
 * there is no record — see [ink.warrant.ui.records.RecordScreen].
 */
@Composable
fun HandoverPage(
    outstanding: List<Step>,
    explained: List<Step>,
    sealedRecordId: String?,
    heldReason: String?,
    decisions: List<Decision>,
    fabricated: Boolean,
    onReopen: (String) -> Unit,
    onOpenRecord: (String) -> Unit,
    onAgain: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state = handoverStateFor(outstanding.size, sealedRecordId)
    val (headline, why) = handoverHeadline(state, outstanding.size, explained.size)
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim

    Ground(Ground.Work, modifier) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = dim.pad, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            Text(headline, style = WarrantTheme.type.heading.copy(color = colors.fg))
            Text(why, style = WarrantTheme.type.body.copy(color = colors.fg2))

            // A hold outranks everything below it and is drawn whether or not the record
            // exists: a sealed job can still be holding a machine, and that is precisely the
            // case where somebody must not walk away thinking it went fine.
            heldReason?.let {
                HoldBanner(
                    headline = "Machine held",
                    why = "$it. The Gate does not release it until the record holds up.",
                )
            }

            if (outstanding.isNotEmpty()) {
                MonoLabel("Still owed")
                outstanding.forEach { step ->
                    WarrantButton(
                        text = "Step ${step.index} — ${step.title}",
                        onClick = { onReopen(step.id) },
                        ghost = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            // Steps that ended with a sentence instead of a capture. Drawn separately and
            // never folded into "Still owed", because they are two different asks: one is
            // work a person can go and do, and this is work a person has already said they
            // could not. Listing them together is how a technician gets sent back to a step
            // that has already been explained — and leaving them off the page entirely is how
            // a job that will seal deficient looks, on the last screen anybody reads, exactly
            // like one that will not.
            //
            // Still tappable. Reopening is how somebody goes back and does it after all, when
            // the part turns up or the tool comes back from the van.
            if (explained.isNotEmpty()) {
                MonoLabel("Explained, not performed")
                Text(
                    "You said why ${if (explained.size == 1) "this one" else "these"} could " +
                        "not be done. The reason is on the record and the fleet decides what " +
                        "it costs the seal.",
                    style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                )
                explained.forEach { step ->
                    WarrantButton(
                        text = "Step ${step.index} — ${step.title}",
                        onClick = { onReopen(step.id) },
                        ghost = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            when (state) {
                HandoverState.WAITING -> HoldBanner(
                    headline = "No record yet",
                    why = "Verification is still running. This page is not the record and " +
                        "there is nothing to open until it seals.",
                    waiting = true,
                )

                HandoverState.SEALED -> {
                    MonoLabel("Record")
                    Text(
                        sealedRecordId.orEmpty(),
                        style = WarrantTheme.type.mono.copy(color = colors.measured),
                    )
                    WarrantButton(
                        text = "Open the record",
                        onClick = { sealedRecordId?.let(onOpenRecord) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    // Offered only once a record exists, because that is the only point at
                    // which running it again means a second instance rather than abandoning
                    // the first. The new job is its own job: same procedure, nothing carried.
                    WarrantButton(
                        text = "Run it again",
                        onClick = onAgain,
                        ghost = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                HandoverState.OUTSTANDING -> Unit
            }

            Rule()

            MonoLabel("What the fleet decided")
            if (fabricated) {
                // Same rule as the trace sheet: a build serving the scripted timeline says so,
                // on every surface that shows a verdict.
                HoldBanner(
                    headline = "Fixture data",
                    why = "This build runs the scripted demo timeline, not a live backend. " +
                        "The verdicts and costs below are fabricated.",
                    waiting = true,
                )
            }
            if (decisions.isEmpty()) {
                Text(
                    "Nothing has come back yet. Verification runs behind you; it does not " +
                        "need this screen to be open.",
                    style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                )
            } else {
                AgentTrace(decisions)
            }

            WarrantButton(
                text = if (outstanding.isEmpty()) "Leave the job" else "Leave it for now",
                onClick = onDone,
                ghost = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
