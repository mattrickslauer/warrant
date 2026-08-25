package ink.warrant.ui.records

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ink.warrant.contract.Job
import ink.warrant.contract.JobStatus
import ink.warrant.contract.Procedure
import ink.warrant.data.DataSource
import ink.warrant.data.ResponseInput
import ink.warrant.data.openItems
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.AbandonJob
import ink.warrant.ui.components.Loading
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.OpenItemCard
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.StatusPill
import ink.warrant.ui.components.StepEvidence
import ink.warrant.ui.components.WarrantButton
import kotlinx.coroutines.launch

/**
 * A job that has not sealed yet: where it stands, what it has so far, and what it wants from you.
 *
 * ## Why this is not the record screen
 *
 * [RecordScreen] renders on the paper ground, because a sealed record is what SURVIVES the
 * workshop and the person reading it is checking rather than working. This one stays on the
 * workshop ground, and the difference is not decoration — it is the screen telling you, before
 * you read a word, that the thing in front of you is still moving. A job can still be argued
 * with. A record cannot.
 *
 * That is also why the two are separate files rather than one with a flag. The vocabulary this
 * product is careful about — procedure, job, record — stops meaning anything the moment a
 * screen renders a job and calls it a record.
 *
 * ## Why the questions are here at all
 *
 * Verification is asynchronous. The Inspector runs long after the phone went back in a pocket,
 * and what it asks for lands on a step nobody is looking at. Before this screen the only place
 * to answer was inside the live job, which meant a question raised on Tuesday was answerable
 * only by whoever happened to reopen that job — so it sat.
 *
 * Answering does NOT settle the step, and the card says so. `firestore.rules` refuses
 * `performed`, `waived` and `impossible` from every client, and that refusal is the product.
 */
@Composable
fun JobRecordScreen(
    source: DataSource,
    jobId: String,
    /** Who the answer is attributed to. A named human, or the warrant_uid on the open tier. */
    by: String,
    onBack: () -> Unit,
    onResume: (String) -> Unit,
    onOpenRecord: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim
    val scope = rememberCoroutineScope()

    var job by remember(jobId) { mutableStateOf<Job?>(null) }
    var procedure by remember(jobId) { mutableStateOf<Procedure?>(null) }
    var sealedRecordId by remember(jobId) { mutableStateOf<String?>(null) }
    var error by remember(jobId) { mutableStateOf<String?>(null) }
    // A null job means two different things — still reading, and no such job — and this screen
    // used to render the second while the first was true. Three sequential reads deep, that is
    // a person being told their job is gone while it is on its way.
    var loading by remember(jobId) { mutableStateOf(true) }
    var deleting by remember(jobId) { mutableStateOf(false) }

    // Bumped after an answer lands, to re-read the job. A cheap re-read beats holding a second
    // copy of the outcome in local state and having the two disagree about what was answered.
    var revision by remember(jobId) { mutableIntStateOf(0) }

    LaunchedEffect(jobId, revision) {
        loading = true
        runCatching {
            val j = source.getJob(jobId)
            job = j
            procedure = j?.let { source.getProcedure(it.procedureId) }
            // A job knows nothing about the record it produced — sealing is one-way and the
            // record id is unguessable on purpose. So going from a job to its evidence means
            // asking, rather than deriving an id.
            sealedRecordId = j
                ?.takeIf { it.status == JobStatus.SEALED }
                ?.let { sealed -> source.listRecords("*").firstOrNull { it.jobId == sealed.id }?.id }
        }.onFailure { error = it.message }
        loading = false
    }

    Ground(Ground.Work, modifier) {
        val j = job
        val titles = procedure?.steps?.associate { it.id to it.title }.orEmpty()

        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(dim.pad),
            verticalArrangement = Arrangement.spacedBy(dim.stack),
        ) {
            if (loading && j == null) {
                Text("Job", style = WarrantTheme.type.heading.copy(color = colors.fg))
                Loading("Reading this job", rows = 3)
            } else if (j == null) {
                Text("Job", style = WarrantTheme.type.heading.copy(color = colors.fg))
                Text(
                    error ?: "No job with that id on this device.",
                    style = WarrantTheme.type.body.copy(color = colors.fg2),
                )
            } else {
                val open = openItems(j)
                val outstanding = open.filter { it.outstanding }

                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        procedure?.title ?: j.procedureId,
                        style = WarrantTheme.type.heading.copy(color = colors.fg),
                        modifier = Modifier.weight(1f),
                    )
                    StatusPill(j.status)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    MonoLabel("v${j.procedureVersion}")
                    MonoLabel("strictness ${j.strictness}")
                    MonoLabel(j.tier.name)
                }
                Text(j.startedAt, style = WarrantTheme.type.mono.copy(color = colors.fg3))

                Rule()

                // The whole reason to click through. Outstanding first, and above the evidence:
                // somebody who opened this because a row said "1 waiting" should not have to
                // scroll past four photographs to find out what was asked.
                MonoLabel(
                    when {
                        outstanding.isEmpty() && open.isEmpty() -> "Nothing is waiting on you"
                        outstanding.isEmpty() -> "Answered — waiting on the fleet"
                        outstanding.size == 1 -> "1 thing is waiting on you"
                        else -> "${outstanding.size} things are waiting on you"
                    },
                )

                if (open.isEmpty()) {
                    Text(
                        if (j.status == JobStatus.SEALED) {
                            "This job is finished. Its record is what a stranger can check."
                        } else {
                            "No agent has asked for anything. Verification runs behind the " +
                                "capture, so this can change without you doing a thing."
                        },
                        style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                    )
                } else {
                    open.forEach { item ->
                        OpenItemCard(
                            item = item,
                            stepTitle = titles[item.stepId] ?: item.stepId,
                            onAnswer = { answer ->
                                scope.launch {
                                    runCatching {
                                        source.respond(
                                            ResponseInput(
                                                jobId = j.id,
                                                stepId = item.stepId,
                                                answer = answer,
                                                by = by,
                                            ),
                                        )
                                    }
                                        .onSuccess { revision++ }
                                        .onFailure { error = it.message }
                                }
                            },
                            onOpenJob = { onResume(j.id) },
                        )
                    }
                }

                error?.let {
                    Text(
                        "That did not land: $it",
                        style = WarrantTheme.type.bodySmall.copy(color = colors.held),
                    )
                }

                Rule()

                MonoLabel("What has been captured")
                if (j.steps.isEmpty()) {
                    Text(
                        "Nothing yet.",
                        style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
                    )
                } else {
                    j.steps
                        // Procedure order, not whatever order the subcollection came back in.
                        // A record read out of order is a different account of what happened.
                        .sortedBy { outcome ->
                            procedure?.steps?.indexOfFirst { it.id == outcome.stepId } ?: 0
                        }
                        .forEach { outcome ->
                            StepEvidence(
                                source = source,
                                step = outcome,
                                title = titles[outcome.stepId] ?: outcome.stepId,
                            )
                            Rule()
                        }
                }

                // The sealed artifact, once there is one. A job and its record are different
                // documents and this is the only place on the phone that bridges them.
                sealedRecordId?.let { id ->
                    WarrantButton(
                        "Open the sealed record",
                        onClick = { onOpenRecord(id) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                if (j.status != JobStatus.SEALED) {
                    WarrantButton(
                        "Pick this job back up",
                        tonal = true,
                        onClick = { onResume(j.id) },
                        modifier = Modifier.fillMaxWidth(),
                    )

                    // Last on the page and below the way forward, which is the order these two
                    // deserve: the job is still live, and picking it back up is what somebody
                    // came here to do far more often than throwing it away.
                    AbandonJob(
                        busy = deleting,
                        onDelete = {
                            deleting = true
                            error = null
                            scope.launch {
                                runCatching { source.deleteJob(j.id) }
                                    // Back, because there is no longer a job for this screen to
                                    // be about. Staying put would render "No job with that id",
                                    // which is true and reads like a fault.
                                    .onSuccess { onBack() }
                                    .onFailure {
                                        error = it.message ?: "That did not go through."
                                        deleting = false
                                    }
                            }
                        },
                    )
                }
            }

            WarrantButton("Back", ghost = true, onClick = onBack, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(24.dp))
        }
    }
}
