package ink.warrant.ui.records

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.contract.SealedRecord
import ink.warrant.contract.StepStatus
import ink.warrant.data.DataSource
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.AgentTrace
import ink.warrant.ui.components.CeilingCard
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.Loading
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.StepEvidence
import ink.warrant.ui.components.Timeline
import ink.warrant.ui.components.TimelineEntry
import ink.warrant.ui.components.WarrantButton

/**
 * One sealed record, on paper.
 *
 * The ground switches deliberately. Dark is the workshop, where work is done; light is the
 * record, which is what survives the workshop. A person looking at this is no longer working —
 * they are checking — and the app says so before they read a word.
 *
 * What it shows is the whole of what was sealed, including the parts that went wrong: a step
 * that was explained rather than performed is on this page, not filtered off it. A record you
 * can only read the good half of is the tick in the box again.
 */
@Composable
fun RecordScreen(
    source: DataSource,
    recordId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var record by remember(recordId) { mutableStateOf<SealedRecord?>(null) }
    var titles by remember(recordId) { mutableStateOf<Map<String, String>>(emptyMap()) }
    // Keyed on recordId like the state it guards, so navigating from one record to another
    // shows the skeleton again rather than the previous record's body under a new id.
    var loading by remember(recordId) { mutableStateOf(true) }
    var refused by remember(recordId) { mutableStateOf<String?>(null) }

    LaunchedEffect(recordId) {
        loading = true
        refused = null
        // Three sequential reads, and the record is a public artifact somebody may have been
        // sent a link to. "No record with that id on this device" is the single worst sentence
        // this app can show while the first of those reads is still in the air — it tells a
        // person their evidence is gone. It is now only said once we actually know.
        runCatching {
            val r = source.getRecord(recordId)
            // Step ids are opaque; the human-readable titles live on the procedure version
            // that ran, which is reached through the job.
            val job = r?.let { source.getJob(it.jobId) }
            val procedure = job?.let { source.getProcedure(it.procedureId) }
            r to procedure?.steps?.associate { it.id to it.title }.orEmpty()
        }
            .onSuccess { (r, stepTitles) ->
                record = r
                titles = stepTitles
            }
            .onFailure { refused = it.message ?: it.toString() }
        loading = false
    }

    Ground(Ground.Paper, modifier) {
        val colors = WarrantTheme.colors
        val dim = WarrantTheme.dim
        val r = record

        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(dim.pad),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            if (loading) {
                MonoLabel("Sealed record")
                Loading("Opening this record", rows = 4)
            } else if (refused != null) {
                Text("Record", style = WarrantTheme.type.heading.copy(color = colors.fg))
                // Not "no record with that id". A read that was refused and a record that does
                // not exist are different facts, and only one of them means the evidence is
                // gone. Saying the wrong one is how somebody concludes a seal never took.
                HoldBanner(
                    headline = "This record could not be read",
                    why = refused ?: "",
                )
            } else if (r == null) {
                Text("Record", style = WarrantTheme.type.heading.copy(color = colors.fg))
                Text(
                    "No record with that id on this device.",
                    style = WarrantTheme.type.body.copy(color = colors.fg2),
                )
            } else {
                MonoLabel("Sealed record")
                Text(r.id, style = WarrantTheme.type.mono.copy(color = colors.fg))
                Text(
                    r.sealedAt,
                    style = WarrantTheme.type.mono.copy(color = colors.fg2),
                )

                if (!r.machineReleased) {
                    HoldBanner(
                        headline = "Machine held",
                        why = "The Gate did not release this machine. Sealing the record and " +
                            "releasing the machine are separate answers, and this record " +
                            "carries both.",
                    )
                }

                Rule()

                MonoLabel("What this record could reach")
                CeilingCard(
                    tier = r.ceilingTier,
                    reachable = r.ceilingReachable,
                    unreachable = r.ceilingUnreachable,
                )

                Rule()

                MonoLabel("What happened")
                Timeline(
                    r.steps.map { step ->
                        TimelineEntry(
                            when_ = step.dispositionAt ?: step.reasonAt ?: "",
                            what = titles[step.stepId] ?: step.stepId,
                            done = step.status == StepStatus.PERFORMED,
                        )
                    },
                )

                if (r.deficiencies.isNotEmpty()) {
                    Rule()
                    MonoLabel("Deficiencies")
                    r.deficiencies.forEach { d ->
                        Text(
                            "${titles[d.stepId] ?: d.stepId} — ${d.reason}",
                            style = WarrantTheme.type.bodySmall.copy(color = colors.held),
                        )
                    }
                }

                Rule()

                // The evidence itself, not a count of it.
                //
                // The timeline above says a step happened; this is the photograph, the number
                // and the tool that produced the number. Without it a record is a list of
                // assertions about work nobody outside the shop can see — which is the thing
                // this product exists to replace, rendered slightly more prettily.
                MonoLabel("The evidence")
                r.steps.forEach { outcome ->
                    StepEvidence(
                        source = source,
                        step = outcome,
                        title = titles[outcome.stepId] ?: outcome.stepId,
                    )
                    Rule()
                }

                // Who stands behind this, as they were AT SEAL TIME. A record is immutable, so
                // these names must not change when somebody updates a profile or leaves.
                if (r.issuer != null || r.actors.isNotEmpty()) {
                    MonoLabel("Who stands behind this")
                    r.issuer?.let {
                        Text(
                            it.displayName,
                            style = WarrantTheme.type.body.copy(color = colors.fg),
                        )
                    }
                    r.actors.forEach { actor ->
                        Text(
                            listOfNotNull(actor.displayName, actor.role).joinToString(" — "),
                            style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                        )
                    }
                    Rule()
                }

                MonoLabel("What the agents decided")
                AgentTrace(r.decisions)
            }

            WarrantButton("Back", ghost = true, onClick = onBack, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(24.dp))
        }
    }
}
