package ink.warrant.ui.job

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import ink.warrant.contract.Decision
import ink.warrant.contract.Job
import ink.warrant.contract.Procedure
import ink.warrant.contract.Step
import ink.warrant.contract.StepStatus
import ink.warrant.data.AttentionKind
import ink.warrant.data.DataSource
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.AgentTrace
import ink.warrant.ui.components.ChatTurn
import ink.warrant.ui.components.EvidenceChip
import ink.warrant.ui.components.EvidenceThumb
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.StepStatusMark
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
 * ## It shows the evidence, not a summary of it
 *
 * This page was a headline, two lists of step names and a flat trace. What somebody actually
 * wants at the moment they stop is to look at what they just recorded and decide whether it
 * will do — and a verdict is only readable next to the thing it was a verdict ABOUT. So the
 * captures are here, one page at a time, with the fleet's decisions printed on the frame they
 * belong to. Which decisions those are is [handoverFrames], which has a TypeScript twin and a
 * test on both sides, because a frame carrying the wrong step's verdicts would show a rejection
 * of one photograph underneath a different one.
 *
 * A pager rather than a column because the frames are peers and there may be a dozen: a column
 * makes the reader scroll past nine to compare the second with the eleventh, on a page whose
 * other half is a live verification feed.
 *
 * It scrolls, unlike [StepPage]. Nothing here is done with the hands, so nothing here has to
 * stay under the thumb, and the trace is worth reading in full.
 *
 * Still the workshop ground. The paper ground belongs to the record, and until this job seals
 * there is no record — see [ink.warrant.ui.records.RecordScreen].
 */
@Composable
fun HandoverPage(
    source: DataSource,
    job: Job?,
    procedure: Procedure?,
    outstanding: List<Step>,
    explained: List<Step>,
    sealedRecordId: String?,
    heldReason: String?,
    decisions: List<Decision>,
    fabricated: Boolean,
    onReopen: (String) -> Unit,
    onRedoStep: (String) -> Unit,
    onOpenRecord: (String) -> Unit,
    onAgain: () -> Unit,
    onDone: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state = handoverStateFor(outstanding.size, sealedRecordId)
    val (headline, why) = handoverHeadline(state, outstanding.size, explained.size)
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim

    // The job document is what carries the capture ids, and no event does — so ask for it again
    // whenever something has landed. Keyed on what actually changes the record's shape rather
    // than on a timer, so a page nobody is looking at costs nothing.
    LaunchedEffect(decisions.size, outstanding.size, sealedRecordId) { onRefresh() }

    val frames = if (job != null && procedure != null) {
        handoverFrames(job, procedure, decisions)
    } else {
        emptyList()
    }
    val progress = if (job != null && procedure != null) {
        verificationProgress(job, procedure)
    } else {
        Progress(0, 0)
    }

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

            // WHAT IS HAPPENING RIGHT NOW. This page used to be a snapshot: it said
            // "verification runs behind you" and then sat perfectly still whether the fleet was
            // working, finished, or unreachable. Those three look identical, and only the first
            // is a state where waiting is the right thing to do.
            LiveProgress(ruled = progress.ruled, total = progress.total, sealed = sealedRecordId != null)

            // A hold outranks everything below it and is drawn whether or not the record
            // exists: a sealed job can still be holding a machine, and that is precisely the
            // case where somebody must not walk away thinking it went fine.
            heldReason?.let {
                HoldBanner(
                    headline = "Machine held",
                    why = "$it. The Gate does not release it until the record holds up.",
                )
            }

            if (frames.isNotEmpty()) {
                MonoLabel("What you recorded")
                EvidenceCarousel(
                    source = source,
                    frames = frames,
                    // Never over a sealed record. That is not a styling decision: a sealed
                    // record is what SURVIVES the workshop, and offering to redo a step of it
                    // would be offering to change the one artifact whose whole value is that it
                    // cannot be changed afterwards.
                    onRedo = if (sealedRecordId == null) onRedoStep else null,
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

/**
 * The evidence, one page at a time, with what the fleet said about it.
 *
 * The browser twin is `EvidenceCarousel` in web/src/components/EvidenceCarousel.tsx, which
 * reaches the same behaviour with scroll-snap because a browser has no pager.
 */
@Composable
private fun EvidenceCarousel(
    source: DataSource,
    frames: List<HandoverFrame>,
    onRedo: ((String) -> Unit)?,
) {
    val colors = WarrantTheme.colors
    val pager = rememberPagerState(pageCount = { frames.size })
    val here = frames.getOrNull(pager.currentPage)

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        HorizontalPager(
            state = pager,
            pageSpacing = 12.dp,
            modifier = Modifier.fillMaxWidth(),
        ) { page ->
            EvidenceFrame(source = source, frame = frames[page])
        }

        // One dot per capture. A frame with something still waiting on a person is findable
        // without flipping to it, which is the whole reason the dots carry a second state.
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            frames.forEachIndexed { i, frame ->
                val on = i == pager.currentPage
                val hue = if (frame.issues.isNotEmpty()) colors.waiting else colors.fg
                Box(
                    Modifier
                        .size(9.dp)
                        .background(
                            if (on) hue else Color.Transparent,
                            CircleShape,
                        )
                        .border(1.dp, if (on) hue else colors.fg3, CircleShape),
                )
            }
        }

        // Under the evidence rather than over it, because the question this answers is asked
        // by looking: you read what the step produced, decide it will not do, and the way to
        // do it again is where your eye already is.
        if (onRedo != null && here != null) {
            WarrantButton(
                text = "Redo step ${here.stepIndex} — ${here.stepTitle}",
                onClick = { onRedo(here.stepId) },
                ghost = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** One page: the capture, what it is, and what the fleet made of it. */
@Composable
private fun EvidenceFrame(source: DataSource, frame: HandoverFrame) {
    val colors = WarrantTheme.colors
    val type = WarrantTheme.type

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(WarrantTheme.dim.rMd))
            .background(colors.container(colors.fg, 0.05f))
            .border(1.dp, colors.hairline, RoundedCornerShape(WarrantTheme.dim.rMd)),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            MonoLabel("Step ${frame.stepIndex}")
            Text(
                frame.stepTitle,
                style = type.titleSmall.copy(color = colors.fg),
                modifier = Modifier.weight(1f),
                maxLines = 1,
            )
            StepStatusMark(frame.status)
        }

        val captureId = frame.captureId
        val answered = frame.answered
        when {
            captureId != null && answered != null ->
                EvidenceThumb(source, frame.jobId, captureId, answered.kind)

            // A value, or the honest absence of one. Fixed height either way, so flipping
            // between a photograph and a typed answer does not make the page jump.
            else -> Box(
                Modifier.fillMaxWidth().aspectRatio(4f / 3f)
                    .background(colors.container(colors.fg, 0.04f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    frame.value ?: "No evidence captured on this step.",
                    style = if (frame.value != null) {
                        type.title.copy(color = colors.fg)
                    } else {
                        type.bodySmall.copy(color = colors.fg3)
                    },
                    modifier = Modifier.padding(24.dp),
                )
            }
        }

        Column(
            Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                answered?.let { MonoLabel(it.key, modifier = Modifier.weight(1f)) }
                // Absent until the Seal has stamped it. A field with no chip has not been
                // classified yet, which is a different thing from being classified as nothing.
                frame.provenance?.let { EvidenceChip(it) }
            }

            // In their words, and attributed. This is an assertion and the page says so.
            frame.reason?.let { ChatTurn(who = "you said", body = it) }

            // THE HIGHLIGHT. What the fleet said about this step, on the thing it said it
            // about — a verdict twenty rows below a photograph is a verdict nobody connects
            // to it. Bounded: a step the fleet has ruled on nine times over as many sweeps
            // would otherwise make one page of the carousel taller than the screen, which
            // breaks the promise that every frame is the same shape.
            if (frame.decisions.isEmpty()) {
                Text(
                    "No verdict on this one yet. Verification runs behind you.",
                    style = type.bodySmall.copy(color = colors.fg3),
                )
            } else {
                val extra = frame.decisions.size - FRAME_VERDICTS
                if (extra > 0) {
                    Text(
                        "$extra earlier verdict${if (extra == 1) "" else "s"} on this step, " +
                            "in the trace below.",
                        style = type.monoLabel.copy(color = colors.fg3),
                    )
                }
                AgentTrace(frame.decisions.takeLast(FRAME_VERDICTS))
            }

            // Anything still waiting on a person, on this step. Named here as well as in the
            // lists above, because this is the page where somebody is actually looking at the
            // evidence the ask is about.
            frame.issues.forEach { issue ->
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(WarrantTheme.dim.rSm))
                        .background(colors.container(colors.waiting, 0.14f))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    MonoLabel(
                        when (issue.kind) {
                            AttentionKind.QUESTION -> "The fleet asked you something"
                            AttentionKind.HOLD -> "Stuck, and waiting on a person"
                            AttentionKind.EVIDENCE -> "One more thing needed"
                        },
                        color = colors.waiting,
                    )
                    Text(issue.ask, style = type.bodySmall.copy(color = colors.fg))
                }
            }
        }
    }
}

/**
 * How many verdicts a frame draws before it starts counting instead.
 *
 * Three, because the interesting shape on a grown step is exactly three long — escalate, add a
 * field, then pass — and showing that sequence is most of why the verdicts are on the frame at
 * all. Everything beyond it is in the trace, and the frame says how much.
 */
private const val FRAME_VERDICTS = 3

/**
 * What the fleet is doing, right now, on a page nobody is touching.
 *
 * Counts steps that have reached an OUTCOME rather than steps that passed — see
 * [verificationProgress]. Still running reads as a different SHAPE, not a different colour: a
 * travelling sheen over the part that is done. A bar that has stopped and a bar that is waiting
 * must not look alike, because only one of them means waiting is the right thing to do.
 */
@Composable
private fun LiveProgress(ruled: Int, total: Int, sealed: Boolean) {
    val colors = WarrantTheme.colors
    val done = total > 0 && ruled >= total
    val fraction = if (total > 0) ruled.toFloat() / total else 0f
    val hue = if (sealed || done) colors.measured else colors.action

    val sweep by rememberInfiniteTransition(label = "sweep").animateFloat(
        initialValue = -0.4f,
        targetValue = 1.4f,
        animationSpec = infiniteRepeatable(tween(1900), RepeatMode.Restart),
        label = "sweep",
    )

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // BoxWithConstraints because the sheen has to travel the width of the TRACK, and a
        // child laid out at 28% of it only knows about its own 28%: offsetting by a fraction of
        // the child's constraints moved it a quarter of the way and then stopped, which reads
        // as a stalled animation — the exact impression this bar exists to avoid.
        BoxWithConstraints(
            Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(CircleShape)
                .background(colors.container(colors.fg, 0.10f)),
        ) {
            val track = maxWidth
            Box(
                Modifier
                    .width(track * fraction.coerceIn(0f, 1f))
                    .fillMaxHeight()
                    .background(hue, CircleShape),
            )
            if (!sealed && !done) {
                // Drawn over the whole track rather than over the filled part: at nought ruled
                // the fill is invisible, and that is exactly the moment somebody most needs to
                // see that something is happening.
                Box(
                    Modifier
                        .offset(x = track * sweep)
                        .width(track * 0.28f)
                        .fillMaxHeight()
                        .background(hue.copy(alpha = 0.45f), CircleShape),
                )
            }
        }
        Text(
            when {
                sealed -> "Sealed. All $total step${if (total == 1) "" else "s"} ruled on, " +
                    "and the record is written."
                done -> "Every step has an outcome. The record seals once the fleet signs off " +
                    "— this page will say so."
                else -> "Verification running — $ruled of $total " +
                    "step${if (total == 1) "" else "s"} ruled on so far."
            },
            style = WarrantTheme.type.bodySmall.copy(
                color = if (sealed) colors.measured else colors.fg2,
            ),
        )
    }
}
