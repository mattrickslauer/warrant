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
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
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

    LaunchedEffect(recordId) {
        val r = source.getRecord(recordId)
        record = r
        // Step ids are opaque; the human-readable titles live on the procedure version that
        // ran, which is reached through the job.
        val job = r?.let { source.getJob(it.jobId) }
        val procedure = job?.let { source.getProcedure(it.procedureId) }
        titles = procedure?.steps?.associate { it.id to it.title }.orEmpty()
    }

    Ground(Ground.Paper, modifier) {
        val colors = WarrantTheme.colors
        val dim = WarrantTheme.dim
        val r = record

        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(dim.pad),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            if (r == null) {
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

                MonoLabel("What the agents decided")
                AgentTrace(r.decisions)
            }

            WarrantButton("Back", ghost = true, onClick = onBack, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(24.dp))
        }
    }
}
