package ink.warrant.data

import ink.warrant.contract.Agent
import ink.warrant.contract.Capture
import ink.warrant.contract.CaptureKind
import ink.warrant.contract.Decision
import ink.warrant.contract.Field
import ink.warrant.contract.FieldKind
import ink.warrant.contract.Job
import ink.warrant.contract.JobStatus
import ink.warrant.contract.Procedure
import ink.warrant.contract.ProvenanceClass
import ink.warrant.contract.Reading
import ink.warrant.contract.SealedRecord
import ink.warrant.contract.StepOutcome
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicLong

/**
 * FixtureSource — deterministic, offline, and DELIBERATELY SLOW IN THE RIGHT PLACES.
 *
 * It plays the timeline in [scripts] rather than returning settled answers, so a screen built
 * against it has already had to cope with a verdict arriving late and with the form growing a
 * field mid-job. That is the entire point of building the surfaces before the backend: when
 * LiveSource replaces this, nothing about the screens has to change, because they were never
 * written in a world where verification was instant.
 *
 * Ported from `web/src/data/fixture-source.ts`. State is guarded by a [Mutex] rather than
 * relying on a single-threaded event loop, which is the one real difference from the original.
 */
class FixtureSource(
    /**
     * 1.0 is demo pace. Raise it to slow the timeline down for filming; 0.0 makes every beat
     * fire immediately, which is what the tests use.
     */
    private val speed: Double = 1.0,
    parent: CoroutineScope? = null,
) : DataSource {

    override val name = "fixture"
    override val fabricated = true

    private val scope = parent ?: CoroutineScope(SupervisorJob())
    private val mutex = Mutex()

    private val jobs = mutableMapOf<String, Job>()
    /**
     * Kept for the same reason the live path keeps a `captures` subcollection: a field points
     * at a capture, and the capture is what knows where the bytes are. Without this the
     * fixture could store a photograph and then have no way back to it — which is exactly the
     * gap that made records render "evidence stored, not reachable from here".
     */
    private val captures = mutableMapOf<String, Capture>()
    private val records = mutableMapOf<String, SealedRecord>()
    private val decisions = mutableListOf<Decision>()
    private val attempts = mutableMapOf<String, Int>()
    private val streams = mutableMapOf<String, MutableSharedFlow<JobEvent>>()

    private val seq = AtomicLong(0)
    private fun id(prefix: String) = "${prefix}_${seq.incrementAndGet().toString(36)}"

    /** Cancel every pending beat. A demo must not leak timers between runs. */
    fun dispose() {
        if (parentWasNull) scope.cancel()
    }

    private val parentWasNull = parent == null

    // ---------------------------------------------------------------- reads

    override suspend fun listProcedures(tenantId: String): List<Procedure> =
        procedures.filter { it.tenantId == tenantId || tenantId == "*" }

    override suspend fun getProcedure(id: String): Procedure? =
        procedures.firstOrNull { it.id == id }

    override suspend fun getJob(id: String): Job? = mutex.withLock { jobs[id] }

    override suspend fun listJobs(tenantId: String): List<Job> =
        mutex.withLock {
            jobs.values
                .filter { it.tenantId == tenantId || tenantId == "*" }
                .sortedByDescending { it.startedAt }
        }

    /**
     * Gone from the map, and gone from the stream.
     *
     * Dropping the flow matters as much as dropping the job. The fixture's whole point is that
     * verdicts arrive on a timer after the technician has walked away, so a deleted job leaves
     * beats already scheduled against it. They all re-read `jobs[jobId]` and fall out when it
     * is missing — but a subscriber still holding the old flow would sit there forever waiting
     * for events that can no longer be produced, which on screen looks exactly like a job that
     * is thinking rather than one that is gone.
     */
    override suspend fun deleteJob(id: String) {
        mutex.withLock {
            // Already gone is a success. See the note on DataSource.deleteJob.
            val job = jobs[id] ?: return@withLock
            require(job.status != JobStatus.SEALED) { "a sealed job cannot be deleted: $id" }
            jobs.remove(id)
            streams.remove(id)
        }
    }

    /**
     * The same two hops the live path makes — capture id to capture, capture to bytes — with
     * the second landing on this device instead of in Cloud Storage. There is nothing to
     * exchange for a signed URL here, only the check that the file is really there.
     *
     * A capture that has been cleaned up, or one this fixture never saw, is null, exactly as a
     * missing object is on the live path. The screens cannot tell the difference, which is the
     * test that the seam is in the right place.
     */
    override suspend fun mediaUrl(jobId: String, captureId: String, kind: FieldKind): String? {
        // A kind with no object behind it. Same answer as live, for the same reason.
        if (Media.extension(kind) == null) return null
        val capture = mutex.withLock { captures[captureId] } ?: return null
        return capture.mediaRef.takeIf { it.isNotBlank() && java.io.File(it).exists() }
    }

    override suspend fun getRecord(id: String): SealedRecord? = mutex.withLock { records[id] }

    override suspend fun listRecords(tenantId: String): List<SealedRecord> =
        mutex.withLock {
            records.values
                .filter { it.tenantId == tenantId || tenantId == "*" }
                .sortedByDescending { it.sealedAt }
        }

    override suspend fun listDecisions(tenantId: String): List<Decision> =
        mutex.withLock { decisions.sortedByDescending { it.at } }

    // ---------------------------------------------------------------- writes

    override suspend fun startJob(procedureId: String, tenantId: String, tier: Tier): Job {
        val proc = getProcedure(procedureId)
            ?: throw IllegalArgumentException("no such procedure: $procedureId")

        // Refused, never downgraded. A procedure that needs an instrument does not quietly
        // become a photo-only job because the surface could not manage it.
        require(surfaceCanRun(proc, tier)) {
            "${proc.key} needs the ${proc.minimumTier} tier; this surface offers $tier"
        }

        val jid = id("job")
        val job = Job(
            id = jid,
            tenantId = tenantId,
            procedureId = proc.id,
            procedureVersion = proc.version,
            assetUrn = null,
            technicianId = null,
            status = JobStatus.OPEN,
            strictness = proc.strictness,
            tier = tier,
            startedAt = nowIso(),
            sealedAt = null,
            steps = proc.steps.map { step ->
                StepOutcome(
                    id = id("out"), jobId = jid, stepId = step.id,
                    status = StepStatus.PENDING, fields = emptyList(),
                )
            },
        )
        mutex.withLock { jobs[jid] = job }
        return job
    }

    /** Returns as soon as the evidence is stored. The verdict arrives later, over [subscribe]. */
    override suspend fun capture(input: CaptureInput): Capture {
        val cap = Capture(
            id = id("cap"),
            fieldId = "${input.stepId}:${input.fieldKey}",
            kind = input.kind,
            mediaRef = input.mediaRef,
            captureMode = input.mode,
            captureSurface = input.surface,
            attestationDeviceId = "fixture-device",
            attestationPlayIntegrity = null,
            redacted = input.redacted,
            armorVerdict = "NO_MATCH_FOUND",
            createdAt = nowIso(),
        )

        val job = mutex.withLock {
            captures[cap.id] = cap
            val j = jobs[input.jobId] ?: throw IllegalArgumentException("no such job: ${input.jobId}")
            val field = Field(
                id = id("fld"),
                stepId = input.stepId,
                key = input.fieldKey,
                kind = when (input.kind) {
                    CaptureKind.PHOTO -> FieldKind.PHOTO
                    CaptureKind.VIDEO -> FieldKind.VIDEO
                    CaptureKind.SCAN -> FieldKind.SCAN
                    CaptureKind.AUDIO, CaptureKind.TEXT -> FieldKind.TEXT
                },
                // The same split the live source makes: a text answer has no object, and
                // `isFilled` reads valueText for this kind — a typed answer left only in
                // mediaRef reads as an empty field on the fixtures the demo runs on.
                mediaRef = if (input.kind.hasObject) cap.id else null,
                valueText = if (input.kind.hasObject) null else input.mediaRef,
                capturedAt = cap.createdAt,
                // The class is stamped by the Seal, never here, and never by a model. What is
                // recorded now is only how the evidence was made.
                provenanceClass = null,
            )
            val updated = j.copy(
                steps = j.steps.map { o ->
                    if (o.stepId == input.stepId) o.copy(fields = o.fields + field) else o
                },
            )
            jobs[j.id] = updated
            updated
        }

        emit(job.id, JobEvent.CaptureAccepted(input.stepId, input.fieldKey, cap.createdAt))
        play(job.id, input.stepId)
        return cap
    }

    /**
     * A number from a paired instrument. There is no path here for a typed value — that is not
     * an oversight, it is the whole distinction between measured and asserted.
     */
    override suspend fun submitReading(input: ReadingInput): Reading {
        val reading = Reading(
            id = id("rdg"),
            fieldId = "${input.stepId}:${input.fieldKey}",
            componentId = null,
            key = input.fieldKey,
            value = input.value,
            unit = input.unit,
            toolId = input.toolId,
            at = nowIso(),
        )

        val job = mutex.withLock {
            val j = jobs[input.jobId] ?: throw IllegalArgumentException("no such job: ${input.jobId}")
            val field = Field(
                id = id("fld"),
                stepId = input.stepId,
                key = input.fieldKey,
                kind = FieldKind.MEASUREMENT,
                valueNumber = input.value,
                unit = input.unit,
                toolId = input.toolId,
                capturedAt = reading.at,
                provenanceClass = null,
            )
            val updated = j.copy(
                steps = j.steps.map { o ->
                    if (o.stepId == input.stepId) o.copy(fields = o.fields + field) else o
                },
            )
            jobs[j.id] = updated
            updated
        }

        emit(job.id, JobEvent.ReadingArrived(input.stepId, input.fieldKey, reading))
        play(job.id, input.stepId)
        return reading
    }

    /** The second exit. There is no skip — this always produces a recorded outcome. */
    override suspend fun declareBlocked(input: BlockedInput): StepOutcome {
        val outcome = mutex.withLock {
            val j = jobs[input.jobId] ?: throw IllegalArgumentException("no such job: ${input.jobId}")
            val o = j.steps.firstOrNull { it.stepId == input.stepId }
                ?: throw IllegalArgumentException("no such step: ${input.stepId}")
            val updated = o.copy(
                reasonKind = input.reasonKind,
                reasonTranscript = input.transcript,
                reasonAudioRef = input.audioRef,
                reasonBy = "fixture-technician",
                reasonAt = nowIso(),
                // A stated reason is always asserted — a named human said it, at this time.
                provenanceClass = ProvenanceClass.ASSERTED,
            )
            jobs[j.id] = j.copy(steps = j.steps.map { if (it.stepId == input.stepId) updated else it })
            updated
        }

        // The Instructor reads the intent and recommends; the Foreman disposes. Both are model
        // calls, so both land on the record and both cost money.
        scope.launch {
            beat(700)
            mutex.withLock {
                val j = jobs[input.jobId] ?: return@withLock
                jobs[j.id] = j.copy(
                    steps = j.steps.map {
                        if (it.stepId == input.stepId) {
                            it.copy(
                                recommendationText = "Nothing here can substitute for it. Record " +
                                    "it as deferred and come back once the blocker clears.",
                                recommendationModel = "gemini-3.5-flash",
                            )
                        } else {
                            it
                        }
                    },
                )
            }
            decide(
                input.jobId, input.stepId, Agent.INSTRUCTOR, "DEFERRED_PROPOSED",
                "Reason read as a blocker, not a refusal: \"${input.transcript.take(80)}\"",
                "gemini-3.5-flash", 0.00047,
            )

            beat(1200)
            mutex.withLock {
                val j = jobs[input.jobId] ?: return@withLock
                jobs[j.id] = j.copy(
                    steps = j.steps.map {
                        if (it.stepId == input.stepId) {
                            it.copy(
                                status = StepStatus.DEFERRED,
                                dispositionAction = ink.warrant.contract.DispositionAction.CHASE,
                                dispositionAt = nowIso(),
                            )
                        } else {
                            it
                        }
                    },
                )
            }
            decide(
                input.jobId, input.stepId, Agent.FOREMAN, "DEFER",
                "Job stays open and the machine stays held. I will check back rather than " +
                    "closing this quietly.",
                "gemini-3.5-flash", 0.00062,
            )
            emit(input.jobId, JobEvent.StepStatusChanged(input.stepId, StepStatus.DEFERRED))
            maybeSeal(input.jobId)
        }

        return outcome
    }

    /**
     * An answer to a question an agent asked. Beside the question, never over it.
     *
     * The step is left PENDING on purpose. The person has spoken; the fleet has not ruled yet,
     * and a screen that flipped the step to performed the moment somebody typed would be the
     * tick in the box this product exists to replace. The Skeptic below is what settles it,
     * and it is allowed to disagree.
     */
    override suspend fun respond(input: ResponseInput): StepOutcome {
        val at = nowIso()
        val outcome = mutex.withLock {
            val j = jobs[input.jobId] ?: throw IllegalArgumentException("no such job: ${input.jobId}")
            val o = j.steps.firstOrNull { it.stepId == input.stepId }
                ?: throw IllegalArgumentException("no such step: ${input.stepId}")
            val updated = o.copy(
                escalationAnswer = input.answer,
                escalationAnsweredBy = input.by,
                escalationAnsweredAt = at,
                // A stated answer is asserted, exactly like a stated reason: a named human
                // said it, at this time, and nothing checked it.
                provenanceClass = ProvenanceClass.ASSERTED,
                // The fleet could not act, and now a person has spoken. Clearing this is what
                // takes the step off the "stuck" list without claiming it passed.
                holdReason = null,
            )
            jobs[j.id] = j.copy(steps = j.steps.map { if (it.stepId == input.stepId) updated else it })
            updated
        }

        scope.launch {
            beat(900)
            decide(
                input.jobId, input.stepId, Agent.SKEPTIC, "ANSWER_ACCEPTED",
                "The answer names the thing I could not see in the evidence: " +
                    "\"${input.answer.take(80)}\". Asserted, not measured — I am recording " +
                    "whose word it is.",
                "gemini-3.5-flash", 0.00051,
            )

            beat(1100)
            mutex.withLock {
                val j = jobs[input.jobId] ?: return@withLock
                jobs[j.id] = j.copy(
                    steps = j.steps.map {
                        if (it.stepId == input.stepId) {
                            it.copy(status = StepStatus.PERFORMED, adjudicatedAt = nowIso())
                        } else {
                            it
                        }
                    },
                )
            }
            emit(input.jobId, JobEvent.StepStatusChanged(input.stepId, StepStatus.PERFORMED))
            maybeSeal(input.jobId)
        }

        return outcome
    }

    override fun subscribe(jobId: String): Flow<JobEvent> = streamFor(jobId).asSharedFlow()

    // ---------------------------------------------------------------- timeline

    @Synchronized
    private fun streamFor(jobId: String): MutableSharedFlow<JobEvent> =
        streams.getOrPut(jobId) {
            // replay = 0: a late subscriber does not get a burst of history. extraBufferCapacity
            // keeps emit() from suspending when nobody is listening yet.
            MutableSharedFlow(replay = 0, extraBufferCapacity = 64)
        }

    private suspend fun emit(jobId: String, event: JobEvent) {
        streamFor(jobId).emit(event)
    }

    /** One beat of the demo clock. speed 0 fires everything immediately, which tests rely on. */
    private suspend fun beat(ms: Long) {
        if (speed > 0.0) delay((ms * speed).toLong())
    }

    private suspend fun decide(
        jobId: String,
        stepId: String?,
        agent: Agent,
        verdict: String,
        rationale: String,
        model: String?,
        cost: Double,
    ) {
        val d = Decision(
            id = id("dec"), jobId = jobId, stepId = stepId, agent = agent,
            agentVersion = "${agent.name.lowercase()}@1.4.0",
            model = model, verdict = verdict, rationale = rationale,
            costUsd = cost, at = nowIso(),
        )
        mutex.withLock { decisions += d }
        emit(jobId, JobEvent.DecisionMade(stepId, d))
    }

    /**
     * Plays the script for one step. The attempt counter is what makes ADD FIELD real: the
     * first capture on a step runs beat list 0, the second runs list 1, and a step whose script
     * has one entry simply replays it.
     */
    private fun play(jobId: String, stepId: String) {
        scope.launch {
            val job = mutex.withLock { jobs[jobId] } ?: return@launch
            val stepScript = scripts[job.procedureId]?.get(stepId) ?: return@launch
            val key = "$jobId:$stepId"
            val attempt = mutex.withLock {
                val a = attempts[key] ?: 0
                attempts[key] = a + 1
                a
            }
            val beats = stepScript[minOf(attempt, stepScript.size - 1)]

            var elapsed = 0L
            for (b in beats) {
                beat(b.at - elapsed)
                elapsed = b.at
                when (b) {
                    is DemoBeat.Decide ->
                        decide(jobId, stepId, b.agent, b.verdict, b.rationale, b.model, b.cost)

                    is DemoBeat.AddField ->
                        emit(jobId, JobEvent.FieldAdded(stepId, b.field))

                    is DemoBeat.Escalate ->
                        emit(jobId, JobEvent.Escalated(stepId, b.question))

                    is DemoBeat.Status -> {
                        mutex.withLock {
                            val j = jobs[jobId] ?: return@withLock
                            jobs[jobId] = j.copy(
                                steps = j.steps.map {
                                    if (it.stepId == stepId) it.copy(status = b.status) else it
                                },
                            )
                        }
                        emit(jobId, JobEvent.StepStatusChanged(stepId, b.status))
                        maybeSeal(jobId)
                    }
                }
            }
        }
    }

    private suspend fun maybeSeal(jobId: String) {
        val (job, record) = mutex.withLock {
            val j = jobs[jobId] ?: return
            if (j.status == JobStatus.SEALED || !readyToSeal(j)) return
            val sealedJob = j.copy(status = JobStatus.SEALED, sealedAt = nowIso())
            jobs[jobId] = sealedJob
            val rec = sealJob(
                sealedJob,
                decisions.filter { it.jobId == jobId },
                public = sealedJob.tenantId == "anon",
            )
            records[rec.id] = rec
            sealedJob to rec
        }

        if (!machineReleased(job)) {
            emit(jobId, JobEvent.Held("a step was explained rather than performed"))
        }
        emit(jobId, JobEvent.Sealed(record.id))
    }
}
