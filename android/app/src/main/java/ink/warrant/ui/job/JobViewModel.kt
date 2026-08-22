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
import ink.warrant.contract.Step
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
        /**
         * The technician has tapped Finish and is looking at the handover rather than a step.
         *
         * This is a property of the *screen*, not of the job: finishing is the end of the work
         * in front of the hands, and the record seals later on its own schedule. Keeping the
         * two apart is what lets the handover say "waiting" honestly instead of claiming a
         * seal that has not happened.
         */
        val handedOver: Boolean = false,
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

        /**
         * Every step that still owes something, in procedure order.
         *
         * Not just the last one. A field the Inspector appended three steps back leaves that
         * step incomplete however far forward the technician has walked, and the handover has
         * to name it rather than let the job quietly fail to seal.
         */
        val outstanding: List<Step> get() = steps.filterNot { stepComplete(it.id) }
    }

    private val _state = MutableStateFlow(UiState(fabricated = source.fabricated))
    val state: StateFlow<UiState> = _state.asStateFlow()

    /**
     * The event collector for the job currently in hand, so the next job can cancel it.
     *
     * One per job, never more. Without this a technician who runs the same procedure four
     * times has four live collectors folding into one state, and the stale three outlive the
     * jobs they were opened for.
     */
    private var watching: kotlinx.coroutines.Job? = null

    val instrumentState get() = instruments.state

    /**
     * Begin a job — including the second, third and fourth run of a procedure already sealed.
     *
     * This view model is scoped to the activity rather than the route (see `MainActivity`),
     * so one instance serves every job of the session. That makes the reset below load-bearing
     * rather than tidy: the state carried `sealedRecordId` and `handedOver` out of the last
     * run, and `JobScreen` reads `handedOver` before it reads anything else — so run two
     * opened on run one's handover page and the work was unreachable. A new job starts from
     * [newJobState] and inherits nothing from the one before it.
     */
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

            _state.value = newJobState(procedure, job, source.fabricated)
            observe(job.id)
        }
    }

    /** Run the procedure in hand again, from the top, as a job of its own. */
    fun again() {
        val job = _state.value.job ?: return
        start(job.procedureId, job.tenantId, job.tier)
    }

    private fun observe(jobId: String) {
        watching?.cancel()
        watching = viewModelScope.launch {
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
                        // TEXT, not SCAN. A scan is a photograph of a code and has an
                        // object; this has an answer and none. Labelling it scan is what sent
                        // the fleet after a `.jpg` nobody uploaded.
                        kind = CaptureKind.TEXT, mediaRef = value,
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

    /**
     * The end of the last step.
     *
     * Deliberately not [next]: there is no step after the last one, so advancing past it is a
     * no-op and the button reads as broken. Finishing is its own move, and it ends on its own
     * screen — see [ink.warrant.ui.job.handoverStateFor].
     */
    fun finish() {
        _state.value = _state.value.copy(handedOver = true)
    }

    /** Back into the work from the handover, pointed at the step that is still owed. */
    fun reopen(stepId: String) {
        _state.value = _state.value.copy(handedOver = false)
        goToStepId(stepId)
    }

    fun dismissAlert(alert: Alert) {
        _state.value = _state.value.copy(alerts = _state.value.alerts - alert)
    }
}

/**
 * The state a job starts in — and, just as importantly, everything it starts *without*.
 *
 * A top-level function rather than a `copy()` inside `start()` because the failure it fixes was
 * invisible in a `copy()`: the fields that mattered were the ones nobody named. Written out,
 * the reset is readable, and a test can hand it a filthy previous run and check that nothing
 * survives — see `JobStartTest`.
 *
 * `fabricated` is the one thing carried in, and it is carried as an argument rather than
 * inherited, because it is a property of the data source and not of any job.
 */
fun newJobState(
    procedure: Procedure,
    job: Job,
    fabricated: Boolean,
): JobViewModel.UiState = JobViewModel.UiState(
    procedure = procedure,
    job = job,
    // Not "wherever the last run got to". The first step of this one.
    stepIndex = 0,
    addedFields = emptyMap(),
    filled = emptySet(),
    decisions = emptyList(),
    statuses = job.steps.associate { it.stepId to it.status },
    alerts = emptyList(),
    // The three that blocked the second run. A hold and a record belong to the job that
    // earned them; carrying them forward accuses this job of the last one's outcome.
    heldReason = null,
    sealedRecordId = null,
    handedOver = false,
    error = null,
    fabricated = fabricated,
)
