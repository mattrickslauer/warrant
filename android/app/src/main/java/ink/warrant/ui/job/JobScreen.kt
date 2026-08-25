package ink.warrant.ui.job

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ink.warrant.capture.Redactor
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.ProvenanceClass
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.instrument.InstrumentEvent
import ink.warrant.instrument.formatReading
import ink.warrant.ui.components.BusyRing
import ink.warrant.ui.components.CameraLayer
import ink.warrant.ui.components.FlashChip
import ink.warrant.ui.components.FlashMode
import ink.warrant.ui.components.LiveMark
import ink.warrant.ui.components.ReadingBadge
import ink.warrant.ui.components.rememberCameraHandle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Where evidence is made.
 *
 * One step, one screen, and the screen does not scroll. The lens (or the workshop ground)
 * fills it edge to edge and every control is drawn over the top — because what you are being
 * asked for and what the camera can see are the same question, and answering it should not
 * involve finding a button.
 *
 * The layout is in [StepPage]; what the one big button means at any moment is in
 * [primaryActionFor]. This file is the wiring between them and the view model, plus the small
 * amount of per-field content that sits in the middle of the frame.
 *
 * Two rules survive from the first version of this screen unchanged, because they are the
 * reason it exists:
 *
 *  - **Capture never waits on a model.** The bar returns as soon as the file is written.
 *    Verdicts land later as notices, fixable from wherever the technician has got to.
 *  - **A measurement has no keyboard path.** Not at any strictness, not when no instrument is
 *    attached. "Could not be measured" is a real outcome; a typed number wearing the measured
 *    chip is not.
 */
@Composable
fun JobScreen(
    vm: JobViewModel,
    onOpenPairing: () -> Unit,
    onOpenRecord: (String) -> Unit,
    onExit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsState()
    val instrument by vm.instrumentState.collectAsState()
    val scope = rememberCoroutineScope()

    // The end of the job is its own screen, not a step. Finishing the last step is not the
    // same event as the record sealing, and [HandoverPage] is where that gap is stated out
    // loud rather than papered over.
    if (state.handedOver) {
        HandoverPage(
            outstanding = state.outstanding,
            sealedRecordId = state.sealedRecordId,
            heldReason = state.heldReason,
            decisions = state.decisions,
            fabricated = state.fabricated,
            onReopen = { stepId -> vm.reopen(stepId) },
            onOpenRecord = onOpenRecord,
            onAgain = { vm.again() },
            onDone = onExit,
            modifier = modifier,
        )
        return
    }

    val step = state.step
    if (step == null) {
        Ground(Ground.Work, modifier) {
            Text(
                state.error ?: "Starting…",
                style = WarrantTheme.type.body.copy(color = WarrantTheme.colors.fg),
                modifier = Modifier.align(Alignment.Center).padding(WarrantTheme.dim.pad),
            )
        }
        return
    }

    // Which sheet is open, if any. All three are one tap from the bottom bar.
    var brief by remember { mutableStateOf(false) }
    var blocked by remember { mutableStateOf(false) }
    var trace by remember { mutableStateOf(false) }

    // Frames taken on this device, keyed by step and field. Held here rather than in the view
    // model because they are a property of the *review* — the picture you are looking at
    // before you accept it — not of the record, which already has the file path.
    val captured = remember { mutableStateMapOf<String, File>() }
    var redacting by remember { mutableStateOf(false) }
    var redactNote by remember { mutableStateOf<String?>(null) }

    // The technician's override of which field the page is pointed at. Cleared whenever the
    // step changes, so arriving on a step always starts at its first outstanding field.
    var selected by remember(step.id) { mutableStateOf<String?>(null) }

    val fields = state.fieldsFor(step.id)
    val strictness = state.job?.strictness ?: 0
    val active = activeFieldFor(fields, strictness, selected) { key -> state.isFilled(step.id, key) }
    val camera = rememberCameraHandle()

    // Aim the simulated instrument at whatever this page is asking for.
    //
    // A tool in a hand is held against one thing and reports that thing; the simulator has to be
    // told, or it answers every field with the unit of whichever one it was told about first.
    // That is how a caliper step used to come back in newton-metres. Keyed on the field, so
    // moving between fields re-reads exactly as picking the tool back up would, and no-op unless
    // the link is simulated — a paired instrument is never touched by this.
    LaunchedEffect(step.id, active?.key, instrument.simulated) {
        if (instrument.simulated && active?.kind == FieldKind.MEASUREMENT) vm.aimInstrument(active)
    }

    // The frame on the backdrop, and which field it belongs to. Two cases, one answer: the
    // picture under review while that field is still the one in front of you, or the step's
    // last frame resting behind "Next step" once nothing is outstanding — so you can still see
    // what you recorded. See [framedFieldFor].
    val framedField = framedFieldFor(fields, active) { key -> "${step.id}:$key" in captured }
    val framedFile = framedField?.let { captured["${step.id}:${it.key}"] }

    // Under review only while the field is still open. This is what the bar reads to decide
    // between "Capture" and "Retake"; a resting frame must not make a finished step look busy.
    val reviewing = if (active != null) framedFile else null

    // Redo. Offered whenever a frame from this step is on screen — including after the step has
    // gone quiet, which is the case the bar cannot reach, because by then it says "Next step".
    //
    // Scoped to one slot: this field, this step. It drops the frame, points the page back at
    // that field so the lens reopens, and clears the redaction line that described the frame
    // being thrown away. Everything else on the job is untouched, and the capture already sent
    // is not retracted — the next one lands beside it and the record keeps both.
    val onRedo: (() -> Unit)? = framedField?.let { field ->
        {
            captured.remove("${step.id}:${field.key}")
            redactNote = null
            selected = field.key
        }
    }

    var typed by remember(step.id, active?.key) { mutableStateOf("") }

    // For a camera field "filled" means there is a frame under review right now — not that the
    // record has one. Retake clears the review and puts the lens back, and the bar has to
    // follow that rather than the record, which can never go back to empty.
    val activeFilled = when {
        active == null -> false
        active.usesCamera() -> reviewing != null
        else -> state.isFilled(step.id, active.key)
    }

    // What this device is doing, right now, between the tap and the frame being accepted.
    //
    // Two real waits live in here and neither of them used to draw anything: the shutter
    // itself, and the on-device face mask that runs before a single byte is allowed to leave
    // the phone. Together they are on the order of a second and a half on a mid-range handset,
    // during which the page showed a live preview and a bar that had gone grey — which is
    // indistinguishable from a hung app, and is exactly the confusion this names.
    //
    // A string rather than a boolean because the bar and the overlay both say it out loud, and
    // two independent spellings of the same second is how they end up disagreeing. Ordered the
    // way the work happens: the lens first, then what is done to what it caught.
    val working: String? = when {
        camera.busy -> "Capturing…"
        redacting -> "Masking faces…"
        else -> null
    }
    val action = primaryActionFor(
        field = active,
        fieldFilled = activeFilled,
        lastStep = state.stepIndex == state.steps.lastIndex,
        instrumentConnected = instrument.connected,
        instrumentHasReading = instrument.latest != null,
        inputReady = typed.isNotBlank(),
    ).working(working)

    StepPage(
        modifier = modifier,
        stepIndex = state.stepIndex,
        stepCount = state.steps.size,
        title = step.title,
        prompt = active?.prompt,
        guidance = active?.guidance,
        evidence = active?.declaredClass
            ?: fields.firstOrNull()?.declaredClass
            ?: ProvenanceClass.ASSERTED,
        notices = noticesFor(state, vm),
        primary = action,
        onPrimary = {
            when (action.kind) {
                ActionKind.CAPTURE -> active?.let { field ->
                    val slot = "${step.id}:${field.key}"
                    if (captured.containsKey(slot)) {
                        // Retake is two taps on purpose: drop the frame, look again, then
                        // decide. A single tap that both discarded and re-fired would make
                        // the discard invisible.
                        captured.remove(slot)
                        redactNote = null
                    } else {
                        camera.capture { file ->
                            if (file == null) return@capture
                            captured[slot] = file
                            redacting = true
                            scope.launch {
                                // Masked here, before anything leaves the device. A record is
                                // not readable until this has run.
                                val result = Redactor.redactInPlace(file)
                                redacting = false
                                redactNote = when {
                                    !result.ran -> "Redaction could not run on this capture."
                                    result.facesFound > 0 ->
                                        "${result.facesFound} face(s) masked on device."
                                    else -> "No faces found. Nothing to mask."
                                }
                                vm.capture(step.id, field, file, redacted = result.ran)
                                selected = null
                            }
                        }
                    }
                    Unit
                }

                ActionKind.TAKE_READING -> {
                    active?.let { vm.takeReading(step.id, it) }
                    selected = null
                }

                ActionKind.PAIR -> onOpenPairing()

                ActionKind.RECORD, ActionKind.SIGN -> {
                    active?.let { vm.fillByHand(step.id, it, typed.trim()) }
                    typed = ""
                    selected = null
                }

                ActionKind.ADVANCE -> {
                    redactNote = null
                    vm.next()
                }

                // Deliberately not vm.next(). There is no step after the last one, so
                // advancing past it changed nothing and the button read as dead — which is
                // exactly what it was. Finishing is its own move onto its own screen.
                ActionKind.FINISH -> {
                    redactNote = null
                    vm.finish()
                }
            }
        },
        onExit = onExit,
        onBrief = { brief = true },
        onBlocked = { blocked = true },
        onTrace = { trace = true },
        onBack = if (state.stepIndex > 0) ({ vm.previous() }) else null,
        pips = fields.map { f ->
            FieldPip(
                key = f.key,
                label = f.key.replace('_', ' '),
                filled = state.isFilled(step.id, f.key),
                required = f.requiredAt(strictness),
            )
        },
        activePipKey = active?.key,
        onPip = { key -> selected = key; redactNote = null },
        onRedo = onRedo,
        backdrop = {
            when {
                framedFile != null -> ReviewFrame(framedFile, active?.prompt ?: step.title)
                active != null && active.usesCamera() ->
                    CameraLayer(camera, state.flashFor(step.id), Modifier.fillMaxSize())
                else -> Unit
            }
        },
        center = {
            StepCenter(
                field = active,
                live = active != null && active.usesCamera() && reviewing == null,
                filled = active != null && state.isFilled(step.id, active.key),
                stepComplete = active == null,
                connected = instrument.connected,
                simulated = instrument.simulated,
                latest = instrument.latest,
                typed = typed,
                onTyped = { typed = it },
                capturing = camera.busy,
                redacting = redacting,
                redactNote = redactNote,
                flash = state.flashFor(step.id),
                onCycleFlash = { vm.cycleFlash(step.id) },
            )
        },
    )

    if (brief) {
        StepBriefSheet(
            step = step,
            total = state.steps.size,
            guidance = active?.guidance ?: fields.firstOrNull()?.guidance,
            onDismiss = { brief = false },
        )
    }

    if (blocked) {
        BlockedSheet(
            recommendation = state.job?.steps
                ?.firstOrNull { it.stepId == step.id }
                ?.recommendationText,
            onSubmit = { kind, transcript, audio ->
                vm.declareBlocked(step.id, kind, transcript, audio)
            },
            onDismiss = { blocked = false },
        )
    }

    if (trace) {
        TraceSheet(
            decisions = state.decisions.filter { it.stepId == null || it.stepId == step.id },
            sealedRecordId = state.sealedRecordId,
            fabricated = state.fabricated,
            onDismiss = { trace = false },
        )
    }
}

/**
 * Holds, errors and late verdicts, in the order they should be noticed.
 *
 * These land on the JOB, not on the step — which is what makes a late verdict fixable from
 * three steps away instead of a modal interrupting a torque.
 */
private fun noticesFor(state: JobViewModel.UiState, vm: JobViewModel): List<Notice> = buildList {
    state.heldReason?.let {
        add(
            Notice(
                headline = "Machine held",
                detail = "$it. The Gate does not release until the job seals clean.",
                blocking = true,
            ),
        )
    }
    state.error?.let { add(Notice(headline = "Cannot run", detail = it, blocking = true)) }
    state.alerts.forEach { alert ->
        val stepTitle = state.steps.firstOrNull { it.id == alert.stepId }?.title ?: alert.stepId
        add(
            Notice(
                headline = alert.headline,
                detail = "$stepTitle — ${alert.detail}",
                blocking = alert.blocking,
                goToLabel = "Go to that step",
                onGoTo = { vm.goToStepId(alert.stepId) },
                onDismiss = { vm.dismissAlert(alert) },
            ),
        )
    }
}

/**
 * The frame under review, or the last one taken on this step.
 *
 * The decode happens OFF the composition. Even sampled down, pulling a 12MP JPEG off disk is a
 * few hundred milliseconds, and it used to run inside `remember` — on the main thread, at the
 * exact moment the shutter had just fired and the busy indicator was trying to draw its first
 * turn. The indicator lost. Read on [Dispatchers.Default], keyed on the file, so the frame
 * appears when it is ready and the ring keeps moving until it does.
 */
@Composable
private fun ReviewFrame(file: File, description: String) {
    val bitmap by produceState<android.graphics.Bitmap?>(initialValue = null, file) {
        value = withContext(Dispatchers.Default) { decodeSampled(file) }
    }

    // Nothing, rather than a placeholder, for the fraction of a second before it lands. The
    // backdrop behind this is black and the overlay is already saying what is happening; a
    // grey box appearing and vanishing under that would be one more thing moving.
    bitmap?.let {
        Image(
            bitmap = it.asImageBitmap(),
            contentDescription = description,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/**
 * The frame, at screen size rather than sensor size.
 *
 * These files come off a 12MP camera. Decoded whole that is roughly 48MB of ARGB_8888 held on
 * the main thread for a picture being shown at 1080px wide — which is how a review screen ends
 * up killed by the low-memory reaper on a mid-range phone. Sample it down first.
 */
private fun decodeSampled(file: File, maxEdge: Int = 1600): android.graphics.Bitmap? {
    val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
    android.graphics.BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    var sample = 1
    while (bounds.outWidth / sample > maxEdge || bounds.outHeight / sample > maxEdge) sample *= 2

    return android.graphics.BitmapFactory.decodeFile(
        file.absolutePath,
        android.graphics.BitmapFactory.Options().apply { inSampleSize = sample },
    )
}

/**
 * What the middle of the frame carries, by field kind.
 *
 * On a camera step this is nearly empty, and that is the point — the live frame is the
 * affordance, so putting a card over it would be covering the thing being asked about.
 */
@Composable
private fun BoxScope.StepCenter(
    field: FieldDef?,
    live: Boolean,
    filled: Boolean,
    stepComplete: Boolean,
    connected: Boolean,
    simulated: Boolean,
    latest: InstrumentEvent.Value?,
    typed: String,
    onTyped: (String) -> Unit,
    capturing: Boolean,
    redacting: Boolean,
    redactNote: String?,
    flash: FlashMode,
    onCycleFlash: () -> Unit,
) {
    val colors = WarrantTheme.colors

    Column(
        Modifier.align(Alignment.Center),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when {
            stepComplete -> OverlayNote(
                "Everything this step needs is recorded. Verification is running behind you.",
                colors.measured,
            )

            field == null -> Unit

            field.kind == FieldKind.MEASUREMENT -> MeasurementCenter(
                field = field,
                filled = filled,
                connected = connected,
                simulated = simulated,
                latest = latest,
            )

            field.usesCamera() -> Unit

            field.kind == FieldKind.SIGNATURE -> OverlayInput(
                value = typed,
                onValueChange = onTyped,
                placeholder = "Your name",
            )

            // The answers the procedure actually offers, drawn as answers. `typed` still
            // carries the pending value, so the bar below and `vm.fillByHand` are untouched —
            // the only thing that changes is where the value comes from: a tap on a stated
            // option rather than anything at all a keyboard could produce.
            field.kind == FieldKind.CHOICE -> OverlayChoices(
                choices = field.choices,
                selected = typed,
                onSelect = onTyped,
            )

            field.usesKeyboard() -> OverlayInput(
                value = typed,
                onValueChange = onTyped,
                placeholder = "Type the value",
            )

            // Reached only by a kind that is neither camera, instrument, keyboard nor choice.
            // Drawing nothing is the honest answer; inventing a text box here is exactly how
            // a choice field came to be answered with somebody's name.
            else -> Unit
        }

        // Said with a turning ring, not as a line of text. A sentence that appears and then
        // sits perfectly still for a second and a half is a caption, and a caption does not
        // tell you whether the thing it describes is still running or has died halfway.
        if (capturing) OverlayBusy("Taking the photograph…", Color.White)
        if (redacting) OverlayBusy("Masking faces on device…", colors.inferred)
        redactNote?.let { OverlayNote(it, colors.fg2) }
    }

    // Both only while the lens is actually open. `live` is already false while a frame is
    // under review, which is what we want: the lamp cannot be changed for a photograph that
    // has already been taken. Redo reopens the lens and the chip comes back with it.
    if (live) {
        LiveMark(Modifier.align(Alignment.BottomStart).padding(bottom = 4.dp))
        FlashChip(
            mode = flash,
            onCycle = onCycleFlash,
            modifier = Modifier.align(Alignment.BottomEnd).padding(bottom = 4.dp),
        )
    }
}

/**
 * The measurement, or the honest reason there isn't one.
 *
 * There is no text input on this branch, at all, on purpose. If a person can type the number,
 * the number is asserted, and calling it measured afterwards would be a lie told by the user
 * interface. The bar below offers pairing instead — see [primaryActionFor].
 */
@Composable
private fun MeasurementCenter(
    field: FieldDef,
    filled: Boolean,
    connected: Boolean,
    simulated: Boolean,
    latest: InstrumentEvent.Value?,
) {
    val colors = WarrantTheme.colors
    // Written the way the reading below it is written. Truncating to whole numbers here — which
    // this did — turns a 0.5–1.5 mm pad limit into "Accepts 0–1 mm", which is a different and
    // wrong rule printed over the frame the technician is working in.
    val lo = field.acceptanceMin
    val hi = field.acceptanceMax
    val unit = field.acceptanceUnit?.takeIf { it.isNotBlank() }?.let { " $it" } ?: ""
    val band = when {
        lo != null && hi != null -> "${formatReading(lo)}–${formatReading(hi)}$unit"
        // A one-sided limit read as a bare number is a different rule. "3 mm" looks like a
        // target; the step said no less than three.
        lo != null -> "at least ${formatReading(lo)}$unit"
        hi != null -> "no more than ${formatReading(hi)}$unit"
        else -> ""
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (band.isNotBlank()) OverlayNote("Accepts $band", colors.fg2)

        when {
            !connected -> OverlayNote(
                "No instrument paired. This value cannot be typed — that is what makes it a " +
                    "measurement rather than a claim.",
                Color.White.copy(alpha = 0.85f),
            )

            latest == null -> OverlayNote("Paired. Waiting for the tool to report.", colors.fg2)

            else -> {
                ReadingBadge(
                    value = latest.value,
                    unit = latest.unit,
                    at = "",
                    toolId = latest.toolId,
                )
                if (simulated) {
                    OverlayNote(
                        "SIMULATED — no hardware is attached. This reading is marked on the " +
                            "record and cannot seal as measured.",
                        colors.held,
                    )
                }
                if (!latest.plausible) {
                    OverlayNote(
                        "Outside the range this driver claims it can produce. Reported, not " +
                            "hidden.",
                        colors.inferred,
                    )
                }
                if (filled) OverlayNote("Taken onto the form.", colors.measured)
            }
        }
    }
}

/**
 * A line of text over the frame.
 *
 * Backed rather than bare: this sits on whatever the lens happens to see, and a white sentence
 * over a white workbench is not a sentence.
 */
@Composable
private fun OverlayNote(text: String, color: Color) {
    Text(
        text,
        style = WarrantTheme.type.bodySmall.copy(color = color),
        textAlign = TextAlign.Center,
        modifier = Modifier
            .background(Color(0xCC202124), RoundedCornerShape(WarrantTheme.dim.rSm))
            .padding(horizontal = 14.dp, vertical = 10.dp),
    )
}

/**
 * The same line, with the device's work turning beside it.
 *
 * Used for the two waits the technician has to sit through — the shutter, and the mask — and
 * never for a verdict. Capture does not wait on a model, and a ring turning over the agents
 * would be this screen promising to hold still until they answer, which is the one thing it
 * must not do.
 */
@Composable
private fun OverlayBusy(text: String, color: Color) {
    Row(
        Modifier
            .background(Color(0xCC202124), RoundedCornerShape(WarrantTheme.dim.rSm))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        BusyRing(color = color, diameter = 16.dp)
        Text(
            text,
            style = WarrantTheme.type.bodySmall.copy(color = color),
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The answers a choice field offers, as tappable answers.
 *
 * There is no text input on this branch, and that is the whole point. A CHOICE field states
 * the answers it accepts; a keyboard in front of it accepts everything else too, and what
 * comes back then gets judged against a target it was never going to match. The technician is
 * not wrong in that exchange — they were handed a blank line and asked a question.
 *
 * The selected option is held in the same `typed` slot a text answer uses, so the bar reads
 * "Record", enables itself the moment something is chosen, and commits through the same path.
 */
@Composable
private fun OverlayChoices(
    choices: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    val colors = WarrantTheme.colors

    // A choice with nothing to choose from is an authoring fault, and `faults()` now refuses
    // to compile one. Said out loud rather than quietly falling back to a keyboard: the
    // fallback is what produced the wrong answer in the first place.
    if (choices.isEmpty()) {
        OverlayNote(
            "This step accepts one of a fixed set of answers and the procedure lists none. " +
                "It cannot be answered here.",
            colors.held,
        )
        return
    }

    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        choices.forEach { choice ->
            val chosen = choice == selected
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = WarrantTheme.dim.tap)
                    .background(
                        if (chosen) colors.measured else Color(0xE6202124),
                        RoundedCornerShape(WarrantTheme.dim.radius),
                    )
                    .border(
                        1.dp,
                        if (chosen) colors.measured else Color.White.copy(alpha = 0.2f),
                        RoundedCornerShape(WarrantTheme.dim.radius),
                    )
                    .clickable { onSelect(choice) }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    choice,
                    style = WarrantTheme.type.body.copy(
                        color = if (chosen) Color(0xFF202124) else Color.White,
                    ),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/** The only keyboard on this screen, and it can never be reached from a measurement field. */
@Composable
private fun OverlayInput(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    val colors = WarrantTheme.colors
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = WarrantTheme.dim.tap)
            .background(Color(0xE6202124), RoundedCornerShape(WarrantTheme.dim.radius))
            .border(
                1.dp,
                Color.White.copy(alpha = 0.2f),
                RoundedCornerShape(WarrantTheme.dim.radius),
            )
            .padding(horizontal = 14.dp, vertical = 14.dp),
    ) {
        if (value.isEmpty()) {
            Text(
                placeholder,
                style = WarrantTheme.type.body.copy(color = Color.White.copy(alpha = 0.45f)),
            )
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            textStyle = WarrantTheme.type.body.copy(color = Color.White),
            cursorBrush = SolidColor(colors.measured),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
