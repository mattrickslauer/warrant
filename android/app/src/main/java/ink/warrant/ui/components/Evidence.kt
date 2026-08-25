package ink.warrant.ui.components

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import ink.warrant.contract.Field
import ink.warrant.contract.FieldKind
import ink.warrant.contract.StepOutcome
import ink.warrant.contract.StepStatus
import ink.warrant.data.AttentionKind
import ink.warrant.data.DataSource
import ink.warrant.data.OpenItem
import ink.warrant.design.WarrantTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The evidence itself, as opposed to a summary of it.
 *
 * A record that says "3 steps performed" is a tick in a box with more words. What makes this
 * an artifact a stranger can check is that the thing captured is ON it — the photograph, the
 * number, the tool that produced the number, and the class each of those can support. So these
 * render values, not counts.
 *
 * Every one of them is read-only. Evidence is captured on the job screen, where there is a
 * camera and a machine; this is where it is looked at afterwards, by somebody who is checking
 * rather than working, and nothing here can alter what was recorded.
 */

/**
 * A stored capture, fetched and shown.
 *
 * Takes the CAPTURE ID — which is what a field's `media_ref` holds — plus the job it belongs
 * to and its kind, because that is what a storage path is derived from. It is deliberately not
 * given a path: a field's `media_ref` and a capture's `media_ref` are different things wearing
 * the same name, and this composable used to hand the first straight to Storage as if it were
 * the second. Every photograph on a live record resolved to null and rendered the gap text
 * below, over bytes that were in the bucket the entire time. See [DataSource.mediaUrl].
 *
 * A capture id is not a URL, so resolving it is a suspend call, and the bitmap decode is
 * another. Both happen in [produceState] off the composition, keyed on the capture, so
 * scrolling a record does not re-fetch and a screen never blocks on a network read.
 *
 * A capture that resolves to nothing renders as a stated gap, never as a broken image. "The
 * image could not be fetched" and "there was never an image" are different claims about a
 * record, and a torn-image icon makes them look identical.
 */
@Composable
fun EvidenceThumb(
    source: DataSource,
    jobId: String,
    captureId: String,
    kind: FieldKind,
    modifier: Modifier = Modifier,
) {
    val colors = WarrantTheme.colors

    val bitmap by produceState<ImageBitmap?>(initialValue = null, source, jobId, captureId, kind) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                val url = source.mediaUrl(jobId, captureId, kind) ?: return@runCatching null
                val bytes = if (url.startsWith("http")) {
                    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 10_000
                        readTimeout = 20_000
                    }
                    try {
                        conn.inputStream.use { it.readBytes() }
                    } finally {
                        conn.disconnect()
                    }
                } else {
                    File(url).takeIf { it.exists() }?.readBytes()
                } ?: return@runCatching null

                // Downsampled on the way in. A record can carry a dozen captures, and a dozen
                // full-resolution frames decoded into the heap at once is how a phone with a
                // record open gets killed in the background.
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                val opts = BitmapFactory.Options().apply {
                    inSampleSize = maxOf(1, bounds.outWidth / 1080)
                }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)?.asImageBitmap()
            }.getOrNull()
        }
    }

    Box(
        modifier
            .fillMaxWidth()
            .aspectRatio(4f / 3f)
            .clip(RoundedCornerShape(WarrantTheme.dim.rMd))
            .background(colors.container(colors.fg, 0.06f))
            .border(1.dp, colors.hairline, RoundedCornerShape(WarrantTheme.dim.rMd)),
        contentAlignment = Alignment.Center,
    ) {
        val shown = bitmap
        if (shown != null) {
            Image(
                bitmap = shown,
                contentDescription = "Captured evidence",
                modifier = Modifier.fillMaxWidth(),
                contentScale = ContentScale.Crop,
            )
        } else {
            Text(
                "Evidence stored, not reachable from here",
                style = WarrantTheme.type.bodySmall.copy(color = colors.fg3),
            )
        }
    }
}

/**
 * One filled field: what was asked for, what came back, and how much that is worth.
 *
 * The provenance chip is never omitted and never inferred by this composable. It renders
 * [Field.provenanceClass], which is stamped by the Seal from the server-written `readings`
 * collection — so a field that has not been sealed yet shows no chip at all rather than a
 * guess. An unearned `measured` on a record is the one lie this product cannot tell.
 */
@Composable
fun FieldEvidence(
    source: DataSource,
    jobId: String,
    field: Field,
    modifier: Modifier = Modifier,
) {
    val colors = WarrantTheme.colors
    val type = WarrantTheme.type

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            MonoLabel(field.key, modifier = Modifier.weight(1f))
            // Absent until the Seal has stamped it. See the note above.
            field.provenanceClass?.let { EvidenceChip(it) }
        }

        when {
            // A number with a tool behind it is the only thing on any screen that gets the
            // badge, because it is the only thing that did not pass through a person.
            field.valueNumber != null && !field.toolId.isNullOrBlank() -> ReadingBadge(
                value = field.valueNumber!!,
                unit = field.unit.orEmpty(),
                at = field.capturedAt.orEmpty(),
                toolId = field.toolId!!,
            )

            // A number WITHOUT one was typed, and reads as ordinary text on purpose. The
            // difference between these two branches is the entire thesis.
            field.valueNumber != null -> Text(
                listOfNotNull(formatValue(field.valueNumber!!), field.unit).joinToString(" "),
                style = type.mono.copy(color = colors.fg),
            )

            field.kind == FieldKind.PHOTO || field.kind == FieldKind.VIDEO ->
                field.mediaRef?.let { EvidenceThumb(source, jobId, it, field.kind) }

            !field.valueChoice.isNullOrBlank() ->
                Text(field.valueChoice!!, style = type.body.copy(color = colors.fg))

            !field.valueText.isNullOrBlank() ->
                Text(field.valueText!!, style = type.body.copy(color = colors.fg))

            else -> Text(
                "Not captured.",
                style = type.bodySmall.copy(color = colors.fg3),
            )
        }
    }
}

/** Trailing zeroes off a whole number. `4.0 mm` reads as a rounding; `4 mm` reads as a value. */
private fun formatValue(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()

/**
 * Everything one step left behind: what it was told, what it produced, and what was said about
 * it if it was not done.
 *
 * A step that was EXPLAINED rather than performed is rendered here at the same weight as one
 * that passed. A record you can only read the good half of is the tick in the box again, and
 * the reason somebody could not turn a bolt is often the most useful line on the page.
 */
@Composable
fun StepEvidence(
    source: DataSource,
    step: StepOutcome,
    title: String,
    modifier: Modifier = Modifier,
) {
    val colors = WarrantTheme.colors
    val type = WarrantTheme.type
    val filled = step.fields.filter { it.isFilled }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(title, style = type.titleSmall.copy(color = colors.fg), modifier = Modifier.weight(1f))
            StepStatusMark(step.status)
        }

        // In their words, and attributed. This is an assertion and the record says so.
        step.reasonTranscript?.takeIf { it.isNotBlank() }?.let { reason ->
            ChatTurn(who = step.reasonBy ?: "the technician", body = reason)
        }

        // What an agent asked, and what a person answered. Both halves, always — an answer
        // with the question deleted is unreadable to whoever checks this later.
        step.escalationQuestion?.takeIf { it.isNotBlank() }?.let { question ->
            ChatTurn(who = "the fleet asked", body = question)
        }
        step.escalationAnswer?.takeIf { it.isNotBlank() }?.let { answer ->
            ChatTurn(who = step.escalationAnsweredBy ?: "answered", body = answer, fromMe = true)
        }

        if (filled.isEmpty()) {
            Text(
                "No evidence captured on this step.",
                style = type.bodySmall.copy(color = colors.fg3),
            )
        } else {
            // The outcome carries its own job id, scoped, on every path that produces one —
            // including the sealed projection, which spreads the outcome through. Reading it
            // off the step is why this composable needs no new argument, and why the job a
            // photograph is fetched from cannot drift from the step it is rendered under.
            filled.forEach { field -> FieldEvidence(source, step.jobId, field) }
        }
    }
}

/** Where one step stands, in two words. The step-level twin of [StatusPill]. */
@Composable
fun StepStatusMark(status: StepStatus, modifier: Modifier = Modifier) {
    val colors = WarrantTheme.colors
    val (label, hue) = when (status) {
        StepStatus.PERFORMED -> "Performed" to colors.measured
        StepStatus.PENDING -> "Pending" to colors.fg3
        StepStatus.DEFERRED -> "Deferred" to colors.inferred
        StepStatus.WAIVED -> "Waived" to colors.asserted
        StepStatus.IMPOSSIBLE -> "Impossible" to colors.held
    }
    Text(label, style = WarrantTheme.type.monoLabel.copy(color = hue), modifier = modifier)
}

/**
 * One thing waiting on a person, with the way to deal with it attached.
 *
 * The affordance is decided by [OpenItem.answerable] rather than by this composable guessing.
 * A question can be answered with a keyboard from anywhere; a field an agent added needs the
 * camera and usually the machine, so that one gets a way BACK TO THE JOB and deliberately no
 * text box — a sentence typed where a measurement belongs is worse than an empty field,
 * because it looks like an answer.
 *
 * Answering never settles the step, and the card says so in as many words. `firestore.rules`
 * refuses `performed` from every client, and a screen implying otherwise would be promising
 * something the database is about to refuse.
 */
@Composable
fun OpenItemCard(
    item: OpenItem,
    stepTitle: String,
    onAnswer: (String) -> Unit,
    onOpenJob: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = WarrantTheme.colors
    val type = WarrantTheme.type
    var text by remember(item.stepId, item.ask) { mutableStateOf("") }

    val accent = when (item.kind) {
        AttentionKind.QUESTION -> colors.asserted
        AttentionKind.HOLD -> colors.held
        AttentionKind.EVIDENCE -> colors.inferred
    }
    val headline = when (item.kind) {
        AttentionKind.QUESTION -> "The fleet asked you something"
        AttentionKind.HOLD -> "Stuck, and waiting on a person"
        AttentionKind.EVIDENCE -> "One more thing needed"
    }

    Column(
        modifier
            .fillMaxWidth()
            .background(colors.container(accent, 0.14f), RoundedCornerShape(WarrantTheme.dim.rMd))
            .padding(horizontal = WarrantTheme.dim.pad, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(headline, style = type.titleSmall.copy(color = accent))
        MonoLabel(stepTitle)
        Text(item.ask, style = type.body.copy(color = colors.fg))

        when {
            // Already answered. It stays on screen because the fleet has not ruled yet, and
            // clearing it the moment somebody typed would claim a settlement that has not
            // happened.
            !item.outstanding -> {
                ChatTurn(
                    who = item.answeredBy ?: "you answered",
                    body = item.answer.orEmpty(),
                    fromMe = true,
                )
                Text(
                    "Answered. The step stays open until the fleet has ruled on it — nothing " +
                        "here marks your own work as done.",
                    style = type.bodySmall.copy(color = colors.fg2),
                )
            }

            item.answerable -> {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(colors.surface, RoundedCornerShape(WarrantTheme.dim.radius))
                        .border(
                            1.dp,
                            colors.fg.copy(alpha = 0.14f),
                            RoundedCornerShape(WarrantTheme.dim.radius),
                        )
                        .padding(12.dp),
                ) {
                    if (text.isEmpty()) {
                        Text(
                            "Answer in your own words",
                            style = type.body.copy(color = colors.fg.copy(alpha = 0.45f)),
                        )
                    }
                    BasicTextField(
                        value = text,
                        onValueChange = { text = it },
                        textStyle = type.body.copy(color = colors.fg),
                        cursorBrush = SolidColor(colors.asserted),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                WarrantButton(
                    "Send this answer",
                    enabled = text.isNotBlank(),
                    onClick = { onAnswer(text.trim()); text = "" },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "Goes on the record as an assertion, attributed to you. The fleet still " +
                        "rules on the step — answering does not mark it done.",
                    style = type.bodySmall.copy(color = colors.fg2),
                )
            }

            else -> {
                Text(
                    "This one needs the camera, and usually the machine. It cannot be answered " +
                        "in words from here.",
                    style = type.bodySmall.copy(color = colors.fg2),
                )
                WarrantButton(
                    "Open the job",
                    ghost = true,
                    onClick = onOpenJob,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
