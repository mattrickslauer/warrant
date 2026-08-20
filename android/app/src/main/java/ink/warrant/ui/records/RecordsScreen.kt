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
import ink.warrant.contract.Job
import ink.warrant.contract.JobStatus
import ink.warrant.contract.SealedRecord
import ink.warrant.data.DataSource
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.JobRow
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule

/**
 * Every job this device has run, and the record each sealed one left behind.
 *
 * Nothing is seeded. A record exists here because somebody stood in front of a machine and
 * made it, which is the whole difference between this list and a table of rows somebody typed.
 */
@Composable
fun RecordsScreen(
    source: DataSource,
    onOpenRecord: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim

    var jobs by remember { mutableStateOf<List<Job>>(emptyList()) }
    var records by remember { mutableStateOf<List<SealedRecord>>(emptyList()) }
    var names by remember { mutableStateOf<Map<String, String>>(emptyMap()) }

    LaunchedEffect(Unit) {
        jobs = source.listJobs("*")
        records = source.listRecords("*")
        names = source.listProcedures("*").associate { it.id to it.title }
    }

    Ground(Ground.Work, modifier) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(dim.pad),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            Text("Records", style = WarrantTheme.type.heading.copy(color = colors.fg))

            if (jobs.isEmpty()) {
                Text(
                    "Nothing yet. Run a procedure and the job appears here while it is open, " +
                        "then stays as a sealed record once its evidence is complete.",
                    style = WarrantTheme.type.body.copy(color = colors.fg2),
                )
            } else {
                Text(
                    "A sealed job is openable — that is the artifact a stranger can check.",
                    style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                )
                Rule()
                jobs.forEach { job ->
                    val record = records.firstOrNull { it.jobId == job.id }
                    JobRow(
                        job = job,
                        title = names[job.procedureId] ?: job.procedureId,
                        onClick = { record?.let { onOpenRecord(it.id) } },
                    )
                    if (job.status != JobStatus.SEALED) {
                        MonoLabel("not sealed — no record yet")
                    }
                    Rule()
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
