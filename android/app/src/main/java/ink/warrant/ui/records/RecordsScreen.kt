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
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.contract.Job
import ink.warrant.contract.JobStatus
import ink.warrant.contract.SealedRecord
import ink.warrant.data.DataSource
import ink.warrant.data.outstandingCount
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.AbandonJob
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.JobRow
import ink.warrant.ui.components.Loading
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import kotlinx.coroutines.launch

/**
 * Every job this device has run, and the record each sealed one left behind.
 *
 * Nothing is seeded. A record exists here because somebody stood in front of a machine and
 * made it, which is the whole difference between this list and a table of rows somebody typed.
 *
 * ## Every row goes somewhere
 *
 * It did not use to. A row opened only if its job had sealed, so an OPEN job — the one kind
 * that can still be acted on — was a dead tap, and the questions the fleet had raised on it
 * were reachable from nowhere. Now a sealed job opens its record and an unsealed one opens
 * [JobRecordScreen]; the destination differs because the two are genuinely different documents,
 * but there is no longer a row that swallows a finger.
 *
 * ## Why the counts are computed and not stored
 *
 * `outstandingCount` is derived from the step outcomes every time this list renders. Making it
 * a field somebody has to remember to set is how a badge ends up claiming two things are
 * waiting when both were answered yesterday.
 */
@Composable
fun RecordsScreen(
    source: DataSource,
    onOpenRecord: (String) -> Unit,
    onOpenJob: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim

    var jobs by remember { mutableStateOf<List<Job>>(emptyList()) }
    var records by remember { mutableStateOf<List<SealedRecord>>(emptyList()) }
    var names by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    // Starts true, not false. The read below is an N+1 — one list call and then one whole-job
    // read per row — so on a live tenant this screen is genuinely empty for a moment, and the
    // moment used to be spent claiming the device had never run anything.
    var loading by remember { mutableStateOf(true) }
    var refused by remember { mutableStateOf<String?>(null) }
    /** Which row is mid-delete, so a slow list cannot be told twice. */
    var deleting by remember { mutableStateOf<String?>(null) }
    var deleteError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        loading = true
        refused = null
        // The LIST reads job headers only, which carry no step outcomes — so the badge below
        // would always read zero if it were computed from these. Each job is re-read whole,
        // which is what makes "waiting on you" true rather than decorative.
        //
        // Wrapped because against LiveSource this goes through firestore.rules and a refusal
        // must SHOW. An uncaught throw here would leave `loading` stuck true and the skeleton
        // pulsing forever, which is the spinner-that-never-ends this whole change exists to
        // avoid — so the reset is in the tail, not the happy path.
        runCatching {
            val whole = source.listJobs("*").map { header -> source.getJob(header.id) ?: header }
            Triple(whole, source.listRecords("*"), source.listProcedures("*"))
        }
            .onSuccess { (whole, sealedRecords, procedures) ->
                jobs = whole
                records = sealedRecords
                names = procedures.associate { it.id to it.title }
            }
            .onFailure { refused = it.message ?: it.toString() }
        loading = false
    }

    /**
     * Throw a job away, and drop it from the list held here rather than re-reading.
     *
     * A re-read would race Firestore's own propagation and flick the row back for a moment,
     * which on screen is indistinguishable from the delete having failed.
     */
    fun abandon(job: Job) {
        deleting = job.id
        deleteError = null
        scope.launch {
            runCatching { source.deleteJob(job.id) }
                .onSuccess { jobs = jobs.filterNot { it.id == job.id } }
                .onFailure { deleteError = it.message ?: "That did not go through." }
            deleting = null
        }
    }

    Ground(Ground.Work, modifier) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(dim.pad),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            Text("Records", style = WarrantTheme.type.heading.copy(color = colors.fg))

            refused?.let {
                HoldBanner(headline = "This device's jobs could not be read", why = it)
            }

            if (loading) {
                Loading("Reading this device's jobs")
            } else if (refused != null) {
                // The banner above already said it. Saying "Nothing yet" underneath would be
                // the app guessing that a refusal means an empty shop.
            } else if (jobs.isEmpty()) {
                Text(
                    "Nothing yet. Run a procedure and the job appears here while it is open, " +
                        "then stays as a sealed record once its evidence is complete.",
                    style = WarrantTheme.type.body.copy(color = colors.fg2),
                )
            } else {
                val waiting = jobs.sumOf { outstandingCount(it) }
                Text(
                    if (waiting > 0) {
                        "A sealed job is openable — that is the artifact a stranger can check. " +
                            "One that is not sealed opens too, and $waiting " +
                            (if (waiting == 1) "thing is" else "things are") +
                            " waiting on an answer."
                    } else {
                        "A sealed job is openable — that is the artifact a stranger can check. " +
                            "One that is not sealed opens too, and says where it has got to."
                    },
                    style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                )
                deleteError?.let {
                    HoldBanner(headline = "That job is still here", why = it)
                }
                Rule()
                // KEYED, and it has to be. `remember` inside the loop is positional, so the
                // armed state of the delete confirm below belongs to a SLOT rather than to a
                // job unless something says otherwise — arm row two, delete it, and row three
                // slides up into the slot still holding "are you sure?" about a job nobody
                // touched. Keying on the id moves the state with the row it is about.
                jobs.forEach { job ->
                    key(job.id) {
                        val record = records.firstOrNull { it.jobId == job.id }
                        val owed = outstandingCount(job)
                        JobRow(
                            job = job,
                            title = names[job.procedureId] ?: job.procedureId,
                            // Sealed goes to the record, everything else to the job. Never nowhere.
                            onClick = {
                                if (record != null) onOpenRecord(record.id) else onOpenJob(job.id)
                            },
                        )
                        when {
                            // The one that has to be noticed, so it is said in the hold colour and
                            // said before the "not sealed" note rather than after it.
                            owed > 0 -> Text(
                                if (owed == 1) {
                                    "1 thing is waiting on you — tap to answer it"
                                } else {
                                    "$owed things are waiting on you — tap to answer them"
                                },
                                style = WarrantTheme.type.bodySmall.copy(color = colors.held),
                            )
                            job.status != JobStatus.SEALED ->
                                MonoLabel("not sealed — no record yet")
                        }

                        // The status is the authority on whether this may go, NOT the absence of a
                        // record above. Those are different questions: `records` is read separately
                        // and could come back short — of a tenant filter, of a rule — and a sealed
                        // job whose record simply did not arrive in that second list must not
                        // sprout a delete because of it.
                        if (job.status != JobStatus.SEALED) {
                            AbandonJob(
                                label = "Delete",
                                busy = deleting == job.id,
                                onDelete = { abandon(job) },
                            )
                        }
                        Rule()
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
