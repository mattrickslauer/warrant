package ink.warrant.ui.job

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ink.warrant.contract.CaptureKind
import ink.warrant.contract.CaptureMode
import ink.warrant.contract.CaptureSurface
import ink.warrant.contract.Decision
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.Job
import ink.warrant.contract.Procedure
import ink.warrant.contract.ReasonKind
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier
import ink.warrant.data.BlockedInput
import ink.warrant.data.CaptureInput
import ink.warrant.data.DataSource
import ink.warrant.data.JobEvent
import ink.warrant.data.ReadingInput
import ink.warrant.instrument.InstrumentSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

/**
 * One job, for its whole life on this screen.
 *
 * The shape of this class is dictated by one rule from `docs/architecture.md` §2: **capture
 * never waits on a model.** So there is no "submitting" state and no spinner. A capture updates
 * local state and returns; verdicts arrive later on the event stream and are folded in wherever
 * the technician has got to by then.
 */
class JobViewModel(
    private val source: DataSource,
    private val instruments: InstrumentSession,
) : ViewModel() {

    /**
     * Something that needs the technician's attention on a step that may not be the one they
     * are looking at. This is the "alert on the job, fixable from any step" behaviour — the
     * reason a failed verification does not have to block the hands in front of it.
     */
    data class Alert(
        val stepId: String,
        val headline: String,
        val detail: String,
        val addedField: FieldDef? = null,
        val blocking: Boolean = false,
    )

    data class UiState(
        val procedure: Procedure? = null,
        val job: Job? = null,
        val stepIndex: Int = 0,
        /** Fields the Inspector appended at runtime, per step. The form GROWS. */
        val addedFields: Map<String, List<FieldDef>> = emptyMap(),
        val filled: Set<String> = emptySet(),
        val decisions: List<Decision> = emptyList(),
        val statuses: Map<String, StepStatus> = emptyMap(),
        val alerts: List<Alert> = emptyList(),
        val heldReason: String? = null,
        val sealedRecordId: String? = null,
        val error: String? = null,
        val fabricated: Boolean = true,
    ) {
        val steps get() = procedure?.steps.orEmpty()
        val step get() = steps.getOrNull(stepIndex)

        /** Declared fields plus anything the Inspector added since the job started. */
        fun fieldsFor(stepId: String): List<FieldDef> =
            (steps.firstOrNull { it.id == stepId }?.fields.orEmpty()) + addedFields[stepId].orEmpty()

        fun isFilled(stepId: String, key: String) = "$stepId:$key" in filled

        /** A step is complete when every field required at this strictness has been filled. */
        fun stepComplete(stepId: String): Boolean {
            val strictness = job?.strictness ?: 0
            return fieldsFor(stepId)
                .filter { it.requiredAt(strictness) }
                .all { isFilled(stepId, it.key) }
        }
    }

    private val _state = MutableStateFlow(UiState(fabricated = source.fabricated))
    val state: StateFlow<UiState> = _state.asStateFlow()

    val instrumentState get() = instruments.state

    fun start(procedureId: String, tenantId: String, tier: Tier) {
        viewModelScope.launch {
            val procedure = source.getProcedure(procedureId)
            if (procedure == null) {
                _state.value = _state.value.copy(error = "No such procedure: $procedureId")
                return@launch
            }
            val job = try {
                source.startJob(procedureId, tenantId, tier)
            } catch (e: IllegalArgumentException) {
                // Refused, never downgraded.
                _state.value = _state.value.copy(procedure = procedure, error = e.message)
                return@launch
            }

            _state.value = _state.value.copy(
                procedure = procedure,
                job = job,
                statuses = job.steps.associate { it.stepId to it.status },
                error = null,
            )
            observe(job.id)
        }
    }

    private fun observe(jobId: String) {
        viewModelScope.launch {
            source.subscribe(jobId).collect { event -> fold(event) }
        }
    }

    private fun fold(event: JobEvent) {
        val s = _state.value
        _state.value = when (event) {
            is JobEvent.CaptureAccepted ->
                s.copy(filled = s.filled + "${event.stepId}:${event.fieldKey}")

            is JobEvent.ReadingArrived ->
                s.copy(filled = s.filled + "${event.stepId}:${event.fieldKey}")

            is JobEvent.DecisionMade ->
                s.copy(decisions = s.decisions + event.decision)

            // The form grows. If the technician has already moved on, this becomes an alert on
            // the job rather than a modal in their face.
            is JobEvent.FieldAdded -> s.copy(
                addedFields = s.addedFields + (
                    event.stepId to (s.addedFields[event.stepId].orEmpty() + event.field)
                    ),
                alerts = s.alerts + Alert(
                    stepId = event.stepId,
                    headline = "One more thing needed",
                    detail = event.field.prompt,
                    addedField = event.field,
                ),
            )

            is JobEvent.StepStatusChanged -> s.copy(
                statuses = s.statuses + (event.stepId to event.status),
                // A step that has since passed should not keep nagging.
                alerts = if (event.status == StepStatus.PERFORMED) {
                    s.alerts.filterNot { it.stepId == event.stepId }
                } else {
                    s.alerts
                },
            )

            is JobEvent.Escalated -> s.copy(
                alerts = s.alerts + Alert(
                    stepId = event.stepId,
                    headline = "Escalated to a human",
                    detail = event.question,
                    blocking = true,
                ),
            )

            is JobEvent.Held -> s.copy(heldReason = event.reason)
            is JobEvent.Sealed -> s.copy(sealedRecordId = event.recordId)
        }
    }

    // ---------------------------------------------------------------- the two exits

    /** Exit one. Returns as soon as the file is written; the verdict lands later. */
    fun capture(stepId: String, field: FieldDef, file: File, redacted: Boolean) {
        val jobId = _state.value.job?.id ?: return
        viewModelScope.launch {
            runCatching {
                source.capture(
                    CaptureInput(
                        jobId = jobId,
                        stepId = stepId,
                        fieldKey = field.key,
                        kind = when (field.kind) {
                            FieldKind.VIDEO -> CaptureKind.VIDEO
                            FieldKind.SCAN -> CaptureKind.SCAN
                            else -> CaptureKind.PHOTO
                        },
                        mediaRef = file.absolutePath,
                        // This app, on this device. Not a browser, and the record knows.
                        surface = if (instruments.state.value.connected) {
                            CaptureSurface.APP_INSTRUMENT
                        } else {
                            CaptureSurface.APP
                        },
                        mode = CaptureMode.LIVE,
                        redacted = redacted,
                    ),
                )
            }.onFailure { e ->
                _state.value = _state.value.copy(error = e.message)
            }
        }
    }

    /** A typed or chosen value. Never a measurement — those have no keyboard path. */
    fun fillByHand(stepId: String, field: FieldDef, value: String) {
        val jobId = _state.value.job?.id ?: return
        require(field.kind != FieldKind.MEASUREMENT) {
            "a measurement cannot be typed; that is what makes it measured"
        }
        viewModelScope.launch {
            runCatching {
                source.capture(
                    CaptureInput(
                        jobId = jobId, stepId = stepId, fieldKey = field.key,
                        kind = CaptureKind.SCAN, mediaRef = value,
                        surface = CaptureSurface.APP, mode = CaptureMode.LIVE, redacted = true,
                    ),
                )
            }.onFailure { e -> _state.value = _state.value.copy(error = e.message) }
        }
    }

    /**
     * Takes the instrument's latest value onto the form.
     *
     * There is no argument for the number. It comes from [InstrumentSession] and nowhere else,
     * because a path that let a person supply it would erase the only difference between
     * `measured` and `asserted`.
     */
    fun takeReading(stepId: String, field: FieldDef): Boolean {
        val jobId = _state.value.job?.id ?: return false
        val latest = instruments.state.value.latest ?: return false
        viewModelScope.launch {
            runCatching {
                source.submitReading(
                    ReadingInput(
                        jobId = jobId, stepId = stepId, fieldKey = field.key,
                        value = latest.value, unit = latest.unit, toolId = latest.toolId,
                    ),
                )
            }.onFailure { e -> _state.value = _state.value.copy(error = e.message) }
        }
        return true
    }

    /** Exit two. There is no skip. */
    fun declareBlocked(stepId: String, kind: ReasonKind, transcript: String, audio: File?) {
        val jobId = _state.value.job?.id ?: return
        viewModelScope.launch {
            runCatching {
                source.declareBlocked(
                    BlockedInput(
                        jobId = jobId, stepId = stepId, reasonKind = kind,
                        transcript = transcript, audioRef = audio?.absolutePath,
                        by = "technician",
                    ),
                )
            }.onFailure { e -> _state.value = _state.value.copy(error = e.message) }
        }
    }

    // ---------------------------------------------------------------- navigation

    fun goTo(index: Int) {
        val max = _state.value.steps.lastIndex
        if (index in 0..max) _state.value = _state.value.copy(stepIndex = index)
    }

    fun goToStepId(stepId: String) {
        val i = _state.value.steps.indexOfFirst { it.id == stepId }
        if (i >= 0) goTo(i)
    }

    fun next() = goTo(_state.value.stepIndex + 1)
    fun previous() = goTo(_state.value.stepIndex - 1)

    fun dismissAlert(alert: Alert) {
        _state.value = _state.value.copy(alerts = _state.value.alerts - alert)
    }
}
