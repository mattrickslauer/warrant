package ink.warrant.ui.job

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import ink.warrant.capture.Redactor
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import ink.warrant.contract.Step
import ink.warrant.design.Ground
import ink.warrant.design.WarrantTheme
import ink.warrant.ui.components.AgentTrace
import ink.warrant.ui.components.CaptureTile
import ink.warrant.ui.components.EvidenceChip
import ink.warrant.ui.components.HoldBanner
import ink.warrant.ui.components.MonoLabel
import ink.warrant.ui.components.ReadingBadge
import ink.warrant.ui.components.ReasonCapture
import ink.warrant.ui.components.Rule
import ink.warrant.ui.components.SignedName
import ink.warrant.ui.components.StepCard
import ink.warrant.ui.components.WarrantButton
import kotlinx.coroutines.launch

/**
 * Where evidence is made.
 *
 * The only surface that cannot be substituted, and therefore the one that got built first. Its
 * whole job is to make the two exits obvious and to never, ever block the hands in front of it
 * on something happening in a data centre.
 */
@Composable
fun JobScreen(
    vm: JobViewModel,
    onOpenPairing: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsState()
    val instrument by vm.instrumentState.collectAsState()
    val colors = WarrantTheme.colors
    val dim = WarrantTheme.dim
    val scroll = rememberScrollState()

    // The workshop ground. Work happens here; the paper record is a different world.
    Ground(Ground.Work, modifier) {
        Column(Modifier.fillMaxWidth().verticalScroll(scroll)) {

            if (state.fabricated) {
                // The screen MUST say when it is serving fabricated data. A demo that looks
                // like production is how a judge gets misled, and we would rather be believed.
                HoldBanner(
                    headline = "Fixture data",
                    why = "This build runs the scripted demo timeline, not a live backend. " +
                        "Verdicts and costs below are fabricated; the instrument reading is not.",
                    waiting = true,
                )
            }

            state.heldReason?.let { reason ->
                HoldBanner(
                    headline = "Machine held",
                    why = "$reason. The Gate does not release until the job seals clean.",
                )
            }

            state.error?.let { e ->
                HoldBanner(headline = "Cannot run", why = e)
            }

            // Alerts land here — on the job, not on the step. That is what makes a late
            // verdict fixable from three steps away instead of a modal interrupting a torque.
            state.alerts.forEach { alert ->
                val stepTitle = state.steps.firstOrNull { it.id == alert.stepId }?.title ?: alert.stepId
                HoldBanner(
                    headline = alert.headline,
                    why = "$stepTitle — ${alert.detail}",
                    waiting = !alert.blocking,
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        WarrantButton("Go to that step", onClick = { vm.goToStepId(alert.stepId) })
                        WarrantButton("Later", ghost = true, onClick = { vm.dismissAlert(alert) })
                    }
                }
            }

            val step = state.step
            if (step == null) {
                Box(Modifier.fillMaxWidth().padding(dim.pad)) {
                    Text("Starting…", style = WarrantTheme.type.body.copy(color = colors.fg))
                }
                return@Column
            }

            Column(Modifier.padding(dim.pad), verticalArrangement = Arrangement.spacedBy(dim.stack)) {

                StepCard(
                    step = step,
                    total = state.steps.size,
                    guidance = state.fieldsFor(step.id).firstOrNull()?.guidance,
                    content = {
                        state.fieldsFor(step.id).forEach { field ->
                            // Give every field its own composable identity. Without this the
                            // next step reuses this slot, and a CaptureTile that has already
                            // been filled shows the PREVIOUS step's photograph — evidence
                            // appearing against work it did not come from, which is the worst
                            // bug this screen could have.
                            key(step.id, field.key) {
                            FieldEditor(
                                vm = vm,
                                state = state,
                                step = step,
                                field = field,
                                instrumentConnected = instrument.connected,
                                instrumentSimulated = instrument.simulated,
                                latestValue = instrument.latest,
                                onOpenPairing = onOpenPairing,
                            )
                            }
                        }
                    },
                    exits = {
                        // Exit one is always first and always the same size.
                        WarrantButton(
                            text = if (state.stepIndex == state.steps.lastIndex) "Finish" else "Next step",
                            enabled = state.stepComplete(step.id),
                            onClick = { vm.next() },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (state.stepIndex > 0) {
                            WarrantButton(
                                "Back",
                                ghost = true,
                                onClick = { vm.previous() },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    },
                )

                Rule()

                // Exit two. Never buried, never styled as a failure.
                MonoLabel("Can't do this step?")
                ReasonCapture(
                    onSubmit = { kind, transcript, audio ->
                        vm.declareBlocked(step.id, kind, transcript, audio)
                    },
                    recommendation = state.job?.steps
                        ?.firstOrNull { it.stepId == step.id }
                        ?.recommendationText,
                )

                Rule()

                MonoLabel("What the fleet decided")
                AgentTrace(state.decisions.filter { it.stepId == null || it.stepId == step.id })

                state.sealedRecordId?.let { id ->
                    Rule()
                    MonoLabel("Sealed")
                    Text(
                        id,
                        style = WarrantTheme.type.mono.copy(color = colors.measured),
                    )
                }

                Spacer(Modifier.height(40.dp))
            }
        }
    }
}

/**
 * One field, rendered by its kind.
 *
 * The measurement branch is the one that matters: there is no text input on it, at all, on
 * purpose. If a person can type the number, the number is asserted, and calling it measured
 * afterwards would be a lie told by the user interface.
 */
@Composable
private fun FieldEditor(
    vm: JobViewModel,
    state: JobViewModel.UiState,
    step: Step,
    field: FieldDef,
    instrumentConnected: Boolean,
    instrumentSimulated: Boolean,
    latestValue: ink.warrant.instrument.InstrumentEvent.Value?,
    onOpenPairing: () -> Unit,
) {
    val colors = WarrantTheme.colors
    val filled = state.isFilled(step.id, field.key)

    // A camera field prints its prompt ON the frame, where the lens is. Repeating it as a
    // label above would say the same thing twice and crowd the chip off the row.
    val usesCamera = field.kind == FieldKind.PHOTO ||
        field.kind == FieldKind.VIDEO ||
        field.source == FieldSource.CAMERA

    Column(
        Modifier.fillMaxWidth().padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (usesCamera) {
                Spacer(Modifier.weight(1f))
            } else {
                // Weighted so the chip is measured at its own width first; without this a
                // long prompt eats the row and the chip wraps one letter per line.
                MonoLabel(field.prompt, modifier = Modifier.weight(1f))
            }
            // What class this field can reach, shown before it is filled. The rule decides
            // it, not the outcome.
            EvidenceChip(field.declaredClass)
        }

        when (field.kind) {
            FieldKind.MEASUREMENT -> MeasurementField(
                vm = vm,
                step = step,
                field = field,
                filled = filled,
                connected = instrumentConnected,
                simulated = instrumentSimulated,
                latest = latestValue,
                onOpenPairing = onOpenPairing,
            )

            FieldKind.SIGNATURE -> SignatureField(
                filled = filled,
                onSign = { name -> vm.fillByHand(step.id, field, name) },
            )

            FieldKind.TEXT, FieldKind.SCAN, FieldKind.CHOICE, FieldKind.LOCATION ->
                if (field.source == FieldSource.CAMERA) {
                    CaptureField(vm, step, field)
                } else {
                    TypedField(onSubmit = { v -> vm.fillByHand(step.id, field, v) }, filled = filled)
                }

            FieldKind.PHOTO, FieldKind.VIDEO -> CaptureField(vm, step, field)
        }

        if (filled) {
            Text(
                "Recorded. Verification is running behind you — you can carry on.",
                style = WarrantTheme.type.bodySmall.copy(color = colors.measured),
            )
        }
    }
}

@Composable
private fun CaptureField(vm: JobViewModel, step: Step, field: FieldDef) {
    val scope = rememberCoroutineScope()
    var redacting by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }

    CaptureTile(
        prompt = field.prompt,
        onCaptured = { file ->
            redacting = true
            scope.launch {
                // Masked here, before anything leaves the device. A record is not readable
                // until this has run.
                val result = Redactor.redactInPlace(file)
                redacting = false
                note = when {
                    !result.ran -> "Redaction could not run on this capture."
                    result.facesFound > 0 -> "${result.facesFound} face(s) masked on device."
                    else -> "No faces found. Nothing to mask."
                }
                vm.capture(step.id, field, file, redacted = result.ran)
            }
        },
    )
    if (redacting) {
        Text(
            "Masking faces on device…",
            style = WarrantTheme.type.monoLabel.copy(color = WarrantTheme.colors.inferred),
        )
    }
    note?.let {
        Text(
            it,
            style = WarrantTheme.type.monoLabel.copy(
                color = WarrantTheme.colors.fg.copy(alpha = 0.6f),
            ),
        )
    }
}

/**
 * The measurement field. No keyboard, by design.
 *
 * Either an instrument is paired and its number can be taken onto the form, or it is not and
 * the field cannot be satisfied at all. The second case is a real, correct outcome: the step
 * gets explained through the other exit, and the record says a measurement was not obtainable
 * rather than showing one that a person typed.
 */
@Composable
private fun MeasurementField(
    vm: JobViewModel,
    step: Step,
    field: FieldDef,
    filled: Boolean,
    connected: Boolean,
    simulated: Boolean,
    latest: ink.warrant.instrument.InstrumentEvent.Value?,
    onOpenPairing: () -> Unit,
) {
    val colors = WarrantTheme.colors
    val band = buildString {
        field.acceptanceMin?.let { append(it.toInt()) }
        field.acceptanceMax?.let { append("–").append(it.toInt()) }
        field.acceptanceUnit?.let { append(" ").append(it) }
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (band.isNotBlank()) MonoLabel("Accepts $band")

        when {
            !connected -> {
                Text(
                    "No instrument paired. This value cannot be typed — that is what makes it " +
                        "a measurement rather than a claim.",
                    style = WarrantTheme.type.bodySmall.copy(color = colors.fg.copy(alpha = 0.75f)),
                )
                WarrantButton("Pair an instrument", onClick = onOpenPairing, modifier = Modifier.fillMaxWidth())
            }

            latest == null -> Text(
                "Paired. Waiting for the tool to report.",
                style = WarrantTheme.type.bodySmall.copy(color = colors.fg.copy(alpha = 0.75f)),
            )

            else -> {
                ReadingBadge(
                    value = latest.value,
                    unit = latest.unit,
                    at = "",
                    toolId = latest.toolId,
                )
                if (simulated) {
                    Text(
                        "SIMULATED — no hardware is attached. This reading is marked on the " +
                            "record and cannot seal as measured.",
                        style = WarrantTheme.type.monoLabel.copy(color = colors.held),
                    )
                }
                if (!latest.plausible) {
                    Text(
                        "Outside the range this driver claims it can produce. Reported, not hidden.",
                        style = WarrantTheme.type.monoLabel.copy(color = colors.inferred),
                    )
                }
                if (!filled) {
                    WarrantButton(
                        "Take this reading",
                        onClick = { vm.takeReading(step.id, field) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

@Composable
private fun SignatureField(filled: Boolean, onSign: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    if (filled) {
        SignedName(name.ifBlank { "signed" })
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TextBox(value = name, onValueChange = { name = it }, placeholder = "Your name")
        WarrantButton(
            "Sign",
            enabled = name.isNotBlank(),
            onClick = { onSign(name.trim()) },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun TypedField(onSubmit: (String) -> Unit, filled: Boolean) {
    var value by remember { mutableStateOf("") }
    if (filled) {
        Text(value, style = WarrantTheme.type.mono.copy(color = WarrantTheme.colors.fg))
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TextBox(value = value, onValueChange = { value = it }, placeholder = "Type the value")
        WarrantButton(
            "Record",
            enabled = value.isNotBlank(),
            onClick = { onSubmit(value.trim()) },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun TextBox(value: String, onValueChange: (String) -> Unit, placeholder: String) {
    val colors = WarrantTheme.colors
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = WarrantTheme.dim.tap)
            .background(colors.surface, RoundedCornerShape(WarrantTheme.dim.radius))
            .border(1.dp, colors.fg.copy(alpha = 0.16f), RoundedCornerShape(WarrantTheme.dim.radius))
            .padding(horizontal = 12.dp, vertical = 12.dp),
    ) {
        if (value.isEmpty()) {
            Text(
                placeholder,
                style = WarrantTheme.type.body.copy(color = colors.fg.copy(alpha = 0.45f)),
            )
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            textStyle = WarrantTheme.type.body.copy(color = colors.fg),
            cursorBrush = SolidColor(colors.measured),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
