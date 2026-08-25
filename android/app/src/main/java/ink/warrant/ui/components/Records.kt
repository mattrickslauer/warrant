package ink.warrant.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import java.util.Locale
import ink.warrant.contract.Decision
import ink.warrant.contract.Job
import ink.warrant.design.WarrantTheme

/**
 * Which agent decided what, and on what basis.
 *
 * Every row carries the stamp of the agent that made it, that agent's VERSION, and the model
 * it used — or no model at all, which is the interesting case. A record you cannot attribute
 * is a tick in a box with extra steps.
 */
@Composable
fun AgentTrace(decisions: List<Decision>, modifier: Modifier = Modifier) {
    val colors = WarrantTheme.colors
    val type = WarrantTheme.type

    if (decisions.isEmpty()) {
        Text(
            "No decisions yet. Verification runs behind the capture.",
            modifier = modifier,
            style = type.bodySmall.copy(color = colors.fg.copy(alpha = 0.6f)),
        )
        return
    }

    Column(modifier.fillMaxWidth()) {
        decisions.forEachIndexed { i, d ->
            if (i > 0) Rule()
            Row(
                Modifier.fillMaxWidth().padding(vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AgentStamp(d.agent, size = 26.dp, tint = colors.fg.copy(alpha = 0.85f))
                Column(Modifier.fillMaxWidth()) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        MonoLabel(d.agent.name, color = colors.fg.copy(alpha = 0.85f))
                        Text(
                            d.verdict,
                            style = type.monoLabel.copy(color = colors.measured),
                        )
                        Spacer(Modifier.weight(1f))
                        // No model means the deterministic core answered. That is a feature,
                        // and the record says so rather than hiding it.
                        Text(
                            d.model ?: "no model",
                            style = type.monoLabel.copy(color = colors.fg.copy(alpha = 0.5f)),
                        )
                    }
                    // The rationale is a model talking — sans, because a person reads it as prose.
                    Text(
                        d.rationale,
                        style = type.bodySmall.copy(color = colors.fg.copy(alpha = 0.78f)),
                        modifier = Modifier.padding(top = 5.dp),
                    )
                    Text(
                        buildString {
                            append(d.agentVersion)
                            d.costUsd?.let { append("  ·  $").append(String.format(Locale.US, "%.5f", it)) }
                        },
                        style = type.monoLabel.copy(color = colors.fg.copy(alpha = 0.4f)),
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }
}

/**
 * The one that protects somebody who does not know it exists.
 *
 * It does not look like a toast and it does not dismiss itself. A hold means a machine is not
 * going back into service, and the person who needs to see it may be three steps away by now.
 */
@Composable
fun HoldBanner(
    headline: String,
    why: String,
    modifier: Modifier = Modifier,
    /** Amber rather than red: waiting on evidence is not the same as held. */
    waiting: Boolean = false,
    actions: @Composable ColumnScope.() -> Unit = {},
) {
    val colors = WarrantTheme.colors
    val accent = if (waiting) colors.inferred else colors.held

    Column(
        modifier
            .fillMaxWidth()
            .background(
                colors.container(accent, 0.16f),
                RoundedCornerShape(WarrantTheme.dim.rMd),
            )
            .padding(horizontal = WarrantTheme.dim.pad, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Sentence case, title weight. A hold is serious; shouting it in tracked-out caps
        // makes it read as a toast, and a toast is something you dismiss.
        Text(headline, style = WarrantTheme.type.titleSmall.copy(color = accent))
        Text(why, style = WarrantTheme.type.bodySmall.copy(color = colors.fg2))
        actions()
    }
}

data class TimelineEntry(
    val when_: String,
    val what: String,
    val done: Boolean = true,
)

/** What happened, in order. The spine of a record. */
@Composable
fun Timeline(entries: List<TimelineEntry>, modifier: Modifier = Modifier) {
    val colors = WarrantTheme.colors
    Column(modifier.fillMaxWidth()) {
        entries.forEachIndexed { i, e ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        Modifier
                            .padding(top = 4.dp)
                            .size(14.dp)
                            .background(
                                if (e.done) colors.action else colors.bg,
                                CircleShape,
                            )
                            .border(
                                2.dp,
                                if (e.done) colors.action else colors.hairline,
                                CircleShape,
                            ),
                    )
                    if (i < entries.lastIndex) {
                        Box(
                            Modifier
                                .width(2.dp)
                                .fillMaxHeight()
                                .background(colors.hairline, RoundedCornerShape(1.dp)),
                        )
                    }
                }
                Column(Modifier.padding(start = 14.dp, bottom = 18.dp)) {
                    Text(
                        e.when_,
                        style = WarrantTheme.type.monoLabel.copy(
                            color = colors.fg.copy(alpha = 0.5f),
                        ),
                    )
                    Text(
                        e.what,
                        style = WarrantTheme.type.bodySmall.copy(color = colors.fg),
                    )
                }
            }
        }
    }
}

/** One job in a list. */
@Composable
fun JobRow(
    job: Job,
    title: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit = {},
) {
    val colors = WarrantTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                title,
                style = WarrantTheme.type.body.copy(color = colors.fg),
                modifier = Modifier.weight(1f),
            )
            StatusPill(job.status)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            MonoLabel("v${job.procedureVersion}")
            MonoLabel("strictness ${job.strictness}")
            MonoLabel(job.tier.name)
        }
    }
}

/** A turn of conversation — the Instructor answering, or the technician asking. */
@Composable
fun ChatTurn(
    who: String,
    body: String,
    modifier: Modifier = Modifier,
    fromMe: Boolean = false,
) {
    val colors = WarrantTheme.colors
    Column(
        modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        horizontalAlignment = if (fromMe) Alignment.End else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        MonoLabel(who)
        if (fromMe) {
            Text(body, style = WarrantTheme.type.body.copy(color = colors.fg))
        } else {
            Row(Modifier.height(IntrinsicSize.Min)) {
                Box(Modifier.width(2.dp).fillMaxHeight().background(colors.asserted))
                Text(
                    body,
                    style = WarrantTheme.type.body.copy(color = colors.fg),
                    modifier = Modifier.padding(start = 12.dp),
                )
            }
        }
    }
}

/**
 * A name, typed by a person, going onto the record as an assertion.
 *
 * Rendered in italic sans and NEVER in mono: no machine produced this, and the typeface says
 * so before the chip does.
 */
@Composable
fun SignedName(name: String, modifier: Modifier = Modifier) {
    val colors = WarrantTheme.colors
    Row(modifier.height(IntrinsicSize.Min)) {
        Box(Modifier.width(2.dp).fillMaxHeight().background(colors.asserted))
        Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                name,
                style = WarrantTheme.type.signature.copy(
                    color = colors.fg,
                    fontStyle = FontStyle.Italic,
                ),
            )
            Text(
                "Recorded as an assertion, attributed to this name — not as something the " +
                    "system checked.",
                style = WarrantTheme.type.bodySmall.copy(color = colors.fg.copy(alpha = 0.58f)),
            )
        }
    }
}

/**
 * Throw away a job that never sealed.
 *
 * ## Why it asks twice
 *
 * Not a dialog, and not a single tap either. A dialog would be the heavier apology — this is
 * not a dangerous act, because a job that never sealed produced no record and nobody outside
 * the shop has ever seen it. But it is an irreversible one on a phone held in a glove, and the
 * unarmed state is deliberately quiet: grey, small, and sat below everything that matters, so
 * a thumb finds it when it is looking for it and not while scrolling past.
 *
 * Arming is what makes the second tap a decision rather than a reflex. The armed state says
 * what goes and what does not, because "delete" on a screen full of photographs reads as
 * "delete the evidence" — and the sentence that stops somebody's heart is the one that has to
 * be on screen before they answer.
 *
 * ## Why "keep it" is the wider target
 *
 * The confirm is the narrower of the two, in the hold colour, on the right. If a glove hits
 * the wrong one the job survives. That asymmetry is the entire safety argument, and it costs
 * nothing.
 *
 * [busy] disables both while the delete is in flight, so a slow list cannot be told twice.
 */
@Composable
fun AbandonJob(
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
    /** What the quiet, unarmed affordance says. Shorter in a list than on a job's own page. */
    label: String = "Delete this job",
) {
    val colors = WarrantTheme.colors
    var armed by remember { mutableStateOf(false) }

    if (!armed) {
        Text(
            label,
            modifier = modifier
                .clickable(enabled = !busy) { armed = true }
                .padding(vertical = 10.dp),
            style = WarrantTheme.type.label.copy(color = colors.fg3),
        )
        return
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            // Names the thing that survives. Somebody about to delete a job wants to know, in
            // this order, whether their evidence is going — and it is not, because a job that
            // never sealed never produced any that left the shop.
            "This job and everything captured on it goes, and it does not come back. " +
                "No sealed record is touched — a job that never sealed never made one.",
            style = WarrantTheme.type.bodySmall.copy(color = colors.fg2),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            WarrantButton(
                "Keep it",
                ghost = true,
                enabled = !busy,
                onClick = { armed = false },
                modifier = Modifier.weight(1f),
            )
            Text(
                if (busy) "Deleting…" else "Delete",
                modifier = Modifier
                    .clickable(enabled = !busy) { onDelete() }
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                style = WarrantTheme.type.label.copy(color = colors.held),
            )
        }
    }
}
