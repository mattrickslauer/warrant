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
import ink.warrant.data.ReadingFrame
import ink.warrant.data.ReadingInput
import ink.warrant.instrument.InstrumentSession
import ink.warrant.ui.components.FlashMode
import ink.warrant.ui.components.Lens
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
    /**
     * The signed-in person's name, or null when nothing is signed in.
     *
     * A function rather than a value because the identity outlives no particular job and may
     * arrive after this view model does — reading it at the moment a signature is attributed
     * is the only way the two cannot disagree.
     */
    private val signer: () -> String? = { null },
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
        /**
         * Steps on which exit two has been taken — the technician has stated, in their words,
         * why they could not do it.
         *
         * Held here rather than read off [statuses] because the two are not the same fact and
         * cannot be. `firestore.rules` refuses `performed`, `waived` and `impossible` from
         * every client, so stating a reason does NOT change the step's status: the outcome
         * keeps saying `pending` until the fleet rules on what was said, which is the whole
         * point of that refusal. Meanwhile the person is still standing in the workshop with
         * a bar to tap. This is what the screen knows that the status does not yet: a reason
         * exists, so this step is no longer waiting on the hands.
         */
        val reasoned: Set<String> = emptySet(),
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
        /**
         * The lamp, per step. Absent means [FlashMode.Default].
         *
         * Keyed by step id rather than held as one value for the job, because one step's
         * lighting is not another's: the shot up inside a wheel arch needs the lamp and the
         * one of the bay floor two steps later does not. Screen state, like [handedOver] —
         * how the lens was set is not part of what the step produced, and the record does not
         * carry it.
         */
        val flash: Map<String, FlashMode> = emptyMap(),
        /**
         * Which way the camera is pointed, per step. Absent means [Lens.Default].
         *
         * Keyed by step id for the same reason [flash] is: one step's subject is the machine
         * in front of you and another's is your own face, and a job that asked for both would
         * otherwise make you turn the camera around twice on every pass. Screen state — how
         * the lens was set is not part of what the step produced, and the record does not
         * carry it.
         */
        val lens: Map<String, Lens> = emptyMap(),
        val error: String? = null,
        val fabricated: Boolean = true,
    ) {
        val steps get() = procedure?.steps.orEmpty()
        val step get() = steps.getOrNull(stepIndex)

        /** Declared fields plus anything the Inspector added since the job started. */
        fun fieldsFor(stepId: String): List<FieldDef> =
            (steps.firstOrNull { it.id == stepId }?.fields.orEmpty()) + addedFields[stepId].orEmpty()

        fun isFilled(stepId: String, key: String) = "$stepId:$key" in filled

        /** How the lamp is set for this step. Untouched steps are [FlashMode.Default]. */
        fun flashFor(stepId: String): FlashMode = flash[stepId] ?: FlashMode.Default

        /** Which way this step points the camera. Untouched steps are [Lens.Default]. */
        fun lensFor(stepId: String): Lens = lens[stepId] ?: Lens.Default

        /**
         * This step's lamp moved one place on, and every other step's left exactly alone.
         *
         * A whole transition in one pure function so `FlashPerStepTest` can walk it without a
         * view model, a dispatcher or a device.
         */
        fun withFlashCycled(stepId: String): UiState =
            copy(flash = flash + (stepId to flashFor(stepId).next()))

        /** This step's camera turned around, and every other step's left exactly alone. */
        fun withLensFlipped(stepId: String): UiState =
            copy(lens = lens + (stepId to lensFor(stepId).next()))

        /**
         * This step, put back in front of the hands, and no other step touched.
         *
         * What a redo actually is on this surface: the page's memory of what this step already
         * produced is dropped, so [activeFieldFor] points at its first field again and the bar
         * offers Capture rather than "Next step". That is the whole of it, and the smallness is
         * deliberate — a redo must not be able to unmake anything.
         *
         * Nothing is retracted. Every capture already sent is still in `captures`, which
         * storage.rules makes append-only, and every verdict is still in `decisions`. The next
         * capture REPLACES the current answer for that field — `fieldId()` is derived from the
         * step and key, so re-capturing overwrites the answer and never appends a second one —
         * and the fleet rules on it again. A person cannot delete evidence by tapping redo; they
         * can only add better evidence beside it.
         *
         * `reasoned` goes with it. Exit two was taken on the OLD attempt: somebody said why they
         * could not do this step, and coming back to do it properly means that sentence no longer
         * describes where the step stands. Leaving it would retire the step's own fields — see
         * [FieldDef.holdsStep] — so the page would point at nothing and the bar would read
         * "Next step" on a step that had just been emptied.
         *
         * A SETTLED status is dropped from the local map and a live one is left alone. The
         * difference is what [outstanding] does with it: `deferred`, `waived` and `impossible`
         * are the fleet saying the hands are finished here, and a step carrying one is filtered
         * out of everything a technician is shown — so redoing it would put them on a step that
         * no list admits exists. Dropping it locally is this screen saying "a person is doing
         * this again", which is now true. It is not a claim about the server and cannot be one:
         * firestore.rules refuses all three statuses from every client, and the next snapshot
         * carries whatever the fleet still says.
         */
        fun withStepRedone(stepId: String): UiState = copy(
            filled = filled.filterNotTo(mutableSetOf()) { it.startsWith("$stepId:") },
            reasoned = reasoned - stepId,
            statuses = if (stepSettled(stepId)) statuses - stepId else statuses,
        )

        /** A step is complete when every field required at this strictness has been filled. */
        fun stepComplete(stepId: String): Boolean {
            val strictness = job?.strictness ?: 0
            val reasoned = stepId in this.reasoned
            return fieldsFor(stepId).none {
                it.holdsStep(strictness, reasoned, isFilled(stepId, it.key))
            }
        }

        /**
         * Whether this step has reached an outcome that is not the technician's to advance.
         *
         * `deferred`, `waived` and `impossible` are the three ways a step ends without being
         * performed, and every one of them is written by the fleet. A step carrying one is
         * finished as far as the hands are concerned — listing it under "Still owed" sends
         * somebody back to a step that has already been decided.
         */
        fun stepSettled(stepId: String): Boolean = when (statuses[stepId]) {
            StepStatus.DEFERRED, StepStatus.WAIVED, StepStatus.IMPOSSIBLE -> true
            else -> false
        }

        /**
         * Every step that still owes something, in procedure order.
         *
         * Not just the last one. A field the Inspector appended three steps back leaves that
         * step incomplete however far forward the technician has walked, and the handover has
         * to name it rather than let the job quietly fail to seal.
         *
         * A step that has been settled or reasoned is not owed. It was: the handover counted
         * every incomplete step regardless of outcome, so a step declared impossible sat
         * under "Still owed" forever and the job read OUTSTANDING for the rest of its life —
         * which meant a procedure carrying one unperformable step could never reach a
         * handover at all. Owed means "a person could still do this", and neither of these is.
         */
        val outstanding: List<Step> get() =
            steps.filterNot { stepComplete(it.id) || stepSettled(it.id) }

        /**
         * Every step that ended with a stated reason rather than with evidence.
         *
         * The counterweight to dropping these out of [outstanding]. A step that leaves the
         * "Still owed" list has to appear somewhere else or it has been quietly disappeared,
         * and a step nobody can see is a hole in the record that looks like nothing happened
         * — which is the exact failure this product exists to abolish. So the handover names
         * them under their own heading, and the technician can see what their job is actually
         * going to seal with.
         */
        val explained: List<Step> get() = steps.filter { step ->
            if (!stepSettled(step.id) && step.id !in reasoned) return@filter false
            // Not everything that carried a reason ended on one. A technician can say why
            // they cannot do a step, walk on, and then come back with the tool and do it
            // properly — and a step that ended with the evidence it asked for is performed,
            // whatever was said in the middle. Filing it under "Explained, not performed"
            // would tell them their finished work does not count.
            val strictness = job?.strictness ?: 0
            fieldsFor(step.id).any { it.requiredAt(strictness) && !isFilled(step.id, it.key) }
        }
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
     * Point the simulated instrument at the field now being asked for.
     *
     * A paired tool already knows what it is reading; this exists only so the SIMULATED one
     * answers in the unit the step declared rather than in whatever the last step wanted. It is
     * a no-op unless the link is simulated — see [InstrumentSession.aim].
     */
    fun aimInstrument(field: FieldDef?) = instruments.aim(field)

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

    /**
     * Pick up a job that is already open, from the records surface.
     *
     * Not [start]. That one WRITES a new job, which is exactly wrong here: a technician tapping
     * back into the brake service they left half-done wants the evidence they already captured,
     * not a second job against the same machine and a record that splits in two.
     *
     * The state is rebuilt from what the job has, rather than from nothing — `filled` from the
     * fields already on the outcomes, `statuses` from the outcomes themselves — so a resumed job
     * does not present captured steps as empty and invite them to be done again.
     *
     * It lands on the first step that still owes something rather than on step one. Walking a
     * technician back through four completed steps to reach the one that needs a photograph is
     * how a resume feature stops being used.
     *
     * [at] overrides that landing with a step somebody pointed at. The records surface is where
     * this matters: an agent asks for one more photograph on step two, the job record screen
     * draws that ask, and the button under it has to arrive AT STEP TWO. It used to open the job
     * and land on the first outstanding step, which is very often a different one — so the ask
     * you tapped was nowhere on the screen you arrived at, and the button read as broken.
     *
     * [redo] additionally empties that step — see [UiState.withStepRedone]. It is how "the fleet
     * wants this done again" becomes a screen pointed at the first field of that step with a
     * shutter under it, rather than a finished step with "Next step" on the bar and no way back
     * into the work.
     */
    fun resume(jobId: String, at: String? = null, redo: Boolean = false) {
        viewModelScope.launch {
            val job = source.getJob(jobId)
            if (job == null) {
                _state.value = _state.value.copy(error = "No job with that id on this device.")
                return@launch
            }
            val procedure = source.getProcedure(job.procedureId)
            if (procedure == null) {
                _state.value = _state.value.copy(
                    error = "The procedure this job ran against is not on this device.",
                )
                return@launch
            }

            val added = job.steps
                .filter { it.addedFields.isNotEmpty() }
                .associate { it.stepId to it.addedFields }
            val filled = job.steps
                .flatMap { outcome -> outcome.fields.filter { it.isFilled }.map { "${outcome.stepId}:${it.key}" } }
                .toSet()

            val base = newJobState(procedure, job, source.fabricated).copy(
                addedFields = added,
                filled = filled,
                statuses = job.steps.associate { it.stepId to it.status },
                // Rebuilt from the transcripts rather than started empty. A technician who
                // said why they could not do step three, closed the app and came back must
                // not be asked again — and without this they would be, because the status
                // the server wrote is still `pending` and always will be until the fleet
                // rules. The transcript is the durable record that a reason was given.
                reasoned = job.steps
                    .filter { !it.reasonTranscript.isNullOrBlank() }
                    .map { it.stepId }
                    .toSet(),
            )
            // A step id somebody named, resolved against THIS procedure and never trusted. An
            // id that is not in it is ignored rather than obeyed: the fallback is always a step
            // that exists, because the alternative is a blank screen on a job that is fine.
            val asked = at
                ?.let { id -> procedure.steps.indexOfFirst { step -> step.id == id } }
                ?.takeIf { it >= 0 }

            // Computed off `base` rather than off the job, because "still owes something" is
            // decided by the strictness rule in UiState and not by the step's status.
            val landing = base.outstanding.firstOrNull()
            val opened = if (redo && asked != null) {
                base.withStepRedone(procedure.steps[asked].id)
            } else {
                base
            }
            _state.value = opened.copy(
                stepIndex = asked
                    ?: procedure.steps.indexOfFirst { it.id == landing?.id }.coerceAtLeast(0),
            )
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

    /**
     * SATISFY EVERY SIGNATURE ON THIS STEP FROM THE SESSION, ASKING NOBODY ANYTHING.
     *
     * A signature field used to put a name box and a "Sign" button in front of the technician,
     * and that is the tick in the box this product exists to replace — reproduced inside it. It
     * proved nothing: nothing checks the claim, and the person who would tick it on paper ticks
     * it here. It was redundant as well, because the attribution already existed — every write
     * this app makes is under the signed-in account, and `firestore.rules` refuses `reason_by`
     * and `finalized_by` unless they equal the caller's own uid.
     *
     * So it is recorded from the identity, as an ASSERTION, which is the one class it can ever
     * hold. The record's ceiling then states what that leaves unproved, rather than a green
     * step implying somebody checked.
     *
     * Idempotent by [UiState.isFilled]: walking back onto a step must not write it twice.
     */
    fun attributeSignatures(stepId: String, fields: List<FieldDef>) {
        val state = _state.value
        if (state.job == null) return
        val who = signer() ?: "unattributed"
        for (field in fields) {
            if (field.kind != FieldKind.SIGNATURE) continue
            if (state.isFilled(stepId, field.key)) continue
            fillByHand(stepId, field, who)
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
                        // Relayed exactly as the instrument signed it. Null for a device that
                        // does not sign, and for the simulator — in which case the server
                        // records the number honestly and it cannot become `measured`.
                        frame = latest.frame?.let {
                            ReadingFrame(
                                counter = it.counter,
                                rawHex = it.rawHex,
                                signature = it.signature,
                            )
                        },
                    ),
                )
            }.onFailure { e -> _state.value = _state.value.copy(error = e.message) }
        }
        return true
    }

    /**
     * Exit two. There is no skip.
     *
     * The reason is recorded on this device the moment it is given, BEFORE the write is
     * confirmed, and it is not rolled back if the write fails. That is deliberate and it is
     * the fix for a job that could not be finished: the alternative leaves the technician
     * looking at the same unanswerable question with a grey bar, having already explained
     * themselves, because a network they cannot see did not come back. A failed write surfaces
     * as `error` and the transcript is still in hand; what must not happen is that the person
     * is held on the step by it.
     *
     * The status is untouched, here and on the server. Saying why is not settling — see
     * [UiState.reasoned].
     */
    fun declareBlocked(stepId: String, kind: ReasonKind, transcript: String, audio: File?) {
        val jobId = _state.value.job?.id ?: return
        _state.value = _state.value.copy(reasoned = _state.value.reasoned + stepId)
        viewModelScope.launch {
            runCatching {
                source.declareBlocked(
                    BlockedInput(
                        jobId = jobId, stepId = stepId, reasonKind = kind,
                        transcript = transcript, audioRef = audio?.absolutePath,
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

    /** Walk this step's lamp on one state. Scoped to the step; nothing else on the job moves. */
    fun cycleFlash(stepId: String) {
        _state.value = _state.value.withFlashCycled(stepId)
    }

    /** Turn this step's camera around. Scoped to the step, like the lamp beside it. */
    fun flipLens(stepId: String) {
        _state.value = _state.value.withLensFlipped(stepId)
    }

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

    /**
     * Re-read the job, because the events do not carry what the handover needs to render.
     *
     * [fold] keeps `filled`, `statuses`, `decisions` and `addedFields` up to date and never
     * touches `job` — which is right for the step page, since it renders from those. The
     * handover renders the EVIDENCE, and a photograph is fetched with a capture id that lives
     * on the step outcome's field. No event carries one. A cheap re-read beats keeping a second
     * copy of the outcomes here and having the two disagree about what was captured.
     *
     * Failure is silent on purpose: the page already has a job to draw, and replacing it with
     * an error because a refresh did not land would throw away the evidence over a network
     * blip.
     */
    fun refreshJob() {
        val id = _state.value.job?.id ?: return
        viewModelScope.launch {
            runCatching { source.getJob(id) }.getOrNull()?.let { fresh ->
                _state.value = _state.value.copy(job = fresh)
            }
        }
    }

    /** Back into the work from the handover, pointed at the step that is still owed. */
    fun reopen(stepId: String) {
        _state.value = _state.value.copy(handedOver = false)
        goToStepId(stepId)
    }

    /**
     * Do this step again, and stand on it.
     *
     * The move an agent's verdict asks for and the screen had no way to offer. A step whose
     * fields are all filled points at nothing, so the bar reads "Next step" and the only control
     * that could have gone back — the field strip — is not drawn at all when the step has a
     * single field. The person is looking at a step the fleet has just rejected with no way to
     * touch it, on a page that is otherwise entirely about what to do next.
     *
     * The state change is [UiState.withStepRedone] and nothing else; the note there says what a
     * redo is and, more importantly, what it is not. `handedOver` is cleared because this can be
     * reached from the handover, and arriving at a step you cannot see is not arriving.
     */
    fun redoStep(stepId: String) {
        _state.value = _state.value.withStepRedone(stepId).copy(handedOver = false)
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
    // Named for the same reason as the three below: a reason belongs to the job it was given
    // on. Carried forward, run two would open with run one's excuses already accepted.
    reasoned = emptySet(),
    alerts = emptyList(),
    // The three that blocked the second run. A hold and a record belong to the job that
    // earned them; carrying them forward accuses this job of the last one's outcome.
    heldReason = null,
    sealedRecordId = null,
    handedOver = false,
    // Named rather than left to the default, for the same reason as the three above: a lamp
    // and a lens belong to the job that chose them, and this list is the audit of what does
    // not survive.
    flash = emptyMap(),
    lens = emptyMap(),
    error = null,
    fabricated = fabricated,
)
