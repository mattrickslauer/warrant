package ink.warrant.data

import android.net.Uri
import android.util.Log
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.storage.FirebaseStorage
import ink.warrant.auth.FirebaseSession
import ink.warrant.contract.Capture
import ink.warrant.contract.CaptureKind
import ink.warrant.contract.CaptureMode
import ink.warrant.contract.CaptureSurface
import ink.warrant.contract.Decision
import ink.warrant.contract.Agent
import ink.warrant.contract.Field
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.Job
import ink.warrant.contract.JobStatus
import ink.warrant.contract.Procedure
import ink.warrant.contract.Reading
import ink.warrant.contract.ReasonKind
import ink.warrant.contract.SealedRecord
import ink.warrant.contract.StepOutcome
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier
import ink.warrant.net.Api
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.io.File
import java.time.Instant

/**
 * LiveSource — the same seam, backed by Firestore.
 *
 * Ported from `web/src/data/live-source.ts` and kept close enough to it that the two can be
 * read side by side. Two differences, both required rather than chosen:
 *
 *  1. `subscribe` returns a [Flow] built from `callbackFlow` rather than taking a callback and
 *     returning an unsubscribe. Same four listeners, same events; cancellation is structural.
 *  2. [submitReading] exists here and has no counterpart on the web, because a browser cannot
 *     pair with an instrument. That asymmetry IS the tier ceiling.
 *
 * ## Storage is decomposed, the aggregate is not
 *
 *   /tenants/{t}/jobs/{jobId}                        header — status, tier, counters
 *   /tenants/{t}/jobs/{jobId}/step_outcomes/{stepId}  one per step
 *   /tenants/{t}/jobs/{jobId}/fields/{stepId}__{key}  one per field
 *   /tenants/{t}/jobs/{jobId}/captures/{captureId}    one per capture
 *
 * A capture writes new documents and reads nothing, so write cost does not grow with evidence
 * already captured and two technicians on one job do not contend on a single document. The
 * [Job] returned is assembled here from the header plus subcollection reads — the seam earning
 * its keep, exactly as on the web.
 *
 * ## What this deliberately does NOT do
 *
 * It does not produce verdicts. The Inspector and the Skeptic decide, they run behind
 * `POST /api/adjudicate`, and a capture written here is evidence waiting on them. A client
 * inventing a PASS would be the tick in the box this product exists to abolish.
 */
class LiveSource(
    private val session: FirebaseSession,
    private val api: Api,
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val storage: FirebaseStorage = FirebaseStorage.getInstance(),
    /** Falls back to the personal tenant, exactly as `tenantOf()` in firestore.rules does. */
    private val tenantId: () -> String,
) : DataSource {

    companion object {
        private const val TAG = "LiveSource"

        /** `acme.com/job_9`. The tenant travels in the id so no screen has to carry it. */
        fun split(scoped: String): Pair<String, String> {
            val i = scoped.indexOf('/')
            require(i > 0) { "job id is not tenant-scoped: $scoped" }
            return scoped.substring(0, i) to scoped.substring(i + 1)
        }

        /**
         * A field's document id, derived rather than random.
         *
         * Re-capturing REPLACES the current answer instead of appending, which bounds this
         * subcollection however many attempts a step takes. Nothing is lost: every attempt
         * stays in `captures`, which storage.rules makes append-only.
         */
        fun fieldId(stepId: String, key: String) = "${stepId}__$key"
    }

    override val name = "live"
    override val fabricated = false

    private fun now() = Instant.now().toString()
    private fun jobDoc(tenant: String, job: String) =
        db.collection("tenants").document(tenant).collection("jobs").document(job)

    // ------------------------------------------------------------------ procedures

    override suspend fun listProcedures(tenantId: String): List<Procedure> {
        val t = if (tenantId == "*") this.tenantId() else tenantId
        return db.collection("tenants").document(t).collection("procedures")
            .get().await().documents.mapNotNull { it.toProcedure() }
    }

    override suspend fun getProcedure(id: String): Procedure? {
        val (t, p) = if ('/' in id) split(id) else tenantId() to id
        return db.collection("tenants").document(t).collection("procedures").document(p)
            .get().await().toProcedure()
    }

    // ------------------------------------------------------------------ jobs

    override suspend fun startJob(procedureId: String, tenantId: String, tier: Tier): Job {
        val t = if (tenantId == "*") this.tenantId() else tenantId
        val proc = getProcedure(procedureId) ?: error("no such procedure: $procedureId")
        val ref = db.collection("tenants").document(t).collection("jobs").document()

        val header = mapOf(
            "id" to "$t/${ref.id}",
            "tenant_id" to t,
            "procedure_id" to proc.id.substringAfterLast('/'),
            "procedure_version" to proc.version,
            "status" to "open",
            "strictness" to proc.strictness,
            "tier" to tier.name.lowercase(),
            "started_at" to now(),
            "step_count" to proc.steps.size,
            "performed_count" to 0,
            "field_count" to 0,
        )
        ref.set(header).await()

        // One outcome per step, written up front. A step can be satisfied or explained; it can
        // never be silently absent, and writing them lazily is how absence creeps in.
        for (step in proc.steps) {
            ref.collection("step_outcomes").document(step.id).set(
                mapOf(
                    "id" to "out_${step.id}",
                    "job_id" to "$t/${ref.id}",
                    "step_id" to step.id,
                    "status" to "pending",
                    "add_fields_used" to 0,
                ),
            ).await()
        }
        return getJob("$t/${ref.id}") ?: error("job vanished immediately after being written")
    }

    override suspend fun getJob(id: String): Job? {
        val (t, j) = split(id)
        val ref = jobDoc(t, j)
        val header = ref.get().await()
        if (!header.exists()) return null

        val outcomes = ref.collection("step_outcomes").get().await().documents
        val fields = ref.collection("fields").get().await().documents.mapNotNull { it.toField() }
        val byStep = fields.groupBy { it.stepId }

        return header.toJob(outcomes.mapNotNull { doc ->
            doc.toStepOutcome(byStep[doc.getString("step_id") ?: doc.id].orEmpty())
        })
    }

    override suspend fun listJobs(tenantId: String): List<Job> {
        val t = if (tenantId == "*") this.tenantId() else tenantId
        return db.collection("tenants").document(t).collection("jobs")
            .orderBy("started_at", Query.Direction.DESCENDING)
            .get().await().documents.mapNotNull { doc ->
                // The header alone. A list view that fanned out into every job's
                // subcollections would do N+1 reads to render a row that shows counters.
                doc.toJob(emptyList())
            }
    }

    // ------------------------------------------------------------------ evidence

    override suspend fun capture(input: CaptureInput): Capture {
        val (t, j) = split(input.jobId)
        val ref = jobDoc(t, j)
        val capRef = ref.collection("captures").document()

        // The bytes go up FIRST. A capture document pointing at an object that is not there
        // would be adjudicated as missing evidence, and the technician would be told their
        // photograph was unusable when it was merely late.
        val stored = uploadMedia(t, j, capRef.id, input)

        val createdAt = now()
        val capture = Capture(
            id = capRef.id,
            fieldId = fieldId(input.stepId, input.fieldKey),
            kind = input.kind,
            mediaRef = stored ?: input.mediaRef,
            captureMode = input.mode,
            // Reported, not believed. firestore.rules refuses `app_instrument` from any client
            // — an instrumented capture is written by the server, from a paired device.
            captureSurface = if (input.surface == CaptureSurface.APP_INSTRUMENT) {
                CaptureSurface.APP
            } else {
                input.surface
            },
            attestationDeviceId = null,
            attestationPlayIntegrity = null,
            redacted = input.redacted,
            // Null, not NO_MATCH_FOUND. Model Armor has not run, and claiming a clean screen
            // that never happened is worse than admitting it did not.
            armorVerdict = null,
            adjudicated = false,
            createdAt = createdAt,
        )

        capRef.set(
            mapOf(
                "id" to capture.id,
                "field_id" to capture.fieldId,
                "kind" to capture.kind.name.lowercase(),
                "media_ref" to capture.mediaRef,
                "capture_mode" to capture.captureMode.name.lowercase(),
                "capture_surface" to capture.captureSurface.name.lowercase(),
                "attestation_device_id" to null,
                "attestation_play_integrity" to null,
                "redacted" to capture.redacted,
                "armor_verdict" to null,
                "adjudicated" to false,
                "created_at" to createdAt,
            ),
        ).await()

        ref.collection("fields").document(fieldId(input.stepId, input.fieldKey)).set(
            mapOf(
                "id" to fieldId(input.stepId, input.fieldKey),
                "step_id" to input.stepId,
                "key" to input.fieldKey,
                "kind" to when (input.kind) {
                    CaptureKind.PHOTO -> "photo"
                    CaptureKind.VIDEO -> "video"
                    CaptureKind.SCAN -> "scan"
                    CaptureKind.AUDIO -> "text"
                },
                "media_ref" to capRef.id,
                "captured_at" to createdAt,
                // Null on purpose. The Seal stamps provenance, recomputed from the
                // server-written `readings` collection. A class asserted here would be this
                // file deciding the one thing the product exists to decide independently.
                "provenance_class" to null,
            ),
        ).await()

        // A counter, not a rewrite. increment() is server-side, so two technicians capturing
        // at once both count rather than one overwriting the other.
        ref.update("field_count", FieldValue.increment(1)).await()

        api.adjudicate(session.idToken(), input.jobId, input.stepId, input.fieldKey, capRef.id)
        return capture
    }

    /**
     * Evidence into Cloud Storage, at the one path `storage.rules` allows.
     *
     * Append-only by rule: a technician cannot replace a photograph that failed inspection
     * with one that passes. The extension is kept because the fleet reads the media type off
     * it — an extensionless object is refused by the agent rather than judged.
     */
    private suspend fun uploadMedia(
        tenant: String,
        job: String,
        captureId: String,
        input: CaptureInput,
    ): String? {
        val ext = when (input.kind) {
            CaptureKind.PHOTO, CaptureKind.SCAN -> "jpg"
            CaptureKind.VIDEO -> "mp4"
            CaptureKind.AUDIO -> "m4a"
        }
        val path = "tenants/$tenant/captures/$job/$captureId.$ext"
        return runCatching {
            val local = File(input.mediaRef)
            val uri = if (local.exists()) Uri.fromFile(local) else Uri.parse(input.mediaRef)
            storage.reference.child(path).putFile(uri).await()
            path
        }.onFailure { Log.w(TAG, "media upload failed for $path", it) }.getOrNull()
    }

    /**
     * The only asymmetry with the web, and the reason this app exists.
     *
     * It does NOT write Firestore. `firestore.rules` refuses `readings` from every client, so
     * this posts to the server, which writes it under Admin credentials against a device
     * pairing secret. That refusal is what makes "a reading exists with this tool_id" a claim
     * only a paired instrument can cause to be true — and it is what the Seal checks before it
     * stamps anything `measured`.
     */
    override suspend fun submitReading(input: ReadingInput): Reading {
        val (t, _) = split(input.jobId)
        val at = now()
        val ok = api.submitReading(
            toolKey = instrumentKey,
            tenantId = t,
            jobId = input.jobId,
            stepId = input.stepId,
            fieldKey = input.fieldKey,
            key = input.fieldKey,
            value = input.value,
            unit = input.unit,
            toolId = input.toolId,
            at = at,
        )
        check(ok) { "The reading did not reach the record." }
        return Reading(
            id = "pending",
            fieldId = fieldId(input.stepId, input.fieldKey),
            key = input.fieldKey,
            value = input.value,
            unit = input.unit,
            toolId = input.toolId,
            at = at,
        )
    }

    /** Set by the build that pairs instruments. Absent, submitReading fails loudly. */
    var instrumentKey: String = ""

    override suspend fun declareBlocked(input: BlockedInput): StepOutcome {
        val (t, j) = split(input.jobId)
        val ref = jobDoc(t, j).collection("step_outcomes").document(input.stepId)
        ref.set(
            mapOf(
                "reason_kind" to input.reasonKind.name.lowercase(),
                "reason_transcript" to input.transcript,
                "reason_audio_ref" to input.audioRef,
                "reason_by" to input.by,
                "reason_at" to now(),
                // NOT deferred yet. The Instructor reads the reason and the Foreman decides
                // the disposition; a client that set its own status would be waiving.
                "status" to "pending",
                "provenance_class" to "asserted",
            ),
            com.google.firebase.firestore.SetOptions.merge(),
        ).await()
        return ref.get().await().toStepOutcome(emptyList())
            ?: error("step outcome vanished after being written")
    }

    // ------------------------------------------------------------------ records

    override suspend fun getRecord(id: String): SealedRecord? = null

    override suspend fun listRecords(tenantId: String): List<SealedRecord> = emptyList()

    override suspend fun listDecisions(tenantId: String): List<Decision> {
        val t = if (tenantId == "*") this.tenantId() else tenantId
        return db.collection("tenants").document(t).collection("decisions")
            .orderBy("at", Query.Direction.DESCENDING).limit(200)
            .get().await().documents.mapNotNull { it.toDecision() }
    }

    // ------------------------------------------------------------------ the stream

    /**
     * Four listeners: the job header, its step outcomes, its fields, and the decision log.
     *
     * This is a real push, where the fixture fakes lateness with a timer. The screens cannot
     * tell the difference, which is the test that the seam was drawn in the right place.
     */
    override fun subscribe(jobId: String): Flow<JobEvent> = callbackFlow {
        val (t, j) = split(jobId)
        val ref = jobDoc(t, j)
        val seenStatus = mutableMapOf<String, StepStatus>()
        val seenAdded = mutableSetOf<String>()
        val seenEscalation = mutableMapOf<String, String>()

        val stopOutcomes = ref.collection("step_outcomes").addSnapshotListener { snap, e ->
            if (e != null || snap == null) return@addSnapshotListener
            for (doc in snap.documents) {
                val stepId = doc.getString("step_id") ?: doc.id

                val status = doc.getString("status")?.let(::statusOf)
                if (status != null && seenStatus[stepId] != status) {
                    seenStatus[stepId] = status
                    trySend(JobEvent.StepStatusChanged(stepId, status))
                }

                // The form GREW. An agent appended a field because the evidence was
                // insufficient but recoverable.
                for (added in doc.get("added_fields") as? List<*> ?: emptyList<Any>()) {
                    val m = added as? Map<*, *> ?: continue
                    val key = m["key"]?.toString() ?: continue
                    if (seenAdded.add("$stepId:$key")) {
                        trySend(JobEvent.FieldAdded(stepId, fieldDefOf(m)))
                    }
                }

                val question = doc.getString("escalation_question")
                if (!question.isNullOrBlank() && seenEscalation[stepId] != question) {
                    seenEscalation[stepId] = question
                    trySend(JobEvent.Escalated(stepId, question))
                }
            }
        }

        val stopFields = ref.collection("fields").addSnapshotListener { snap, e ->
            if (e != null || snap == null) return@addSnapshotListener
            for (change in snap.documentChanges) {
                val d = change.document
                trySend(
                    JobEvent.CaptureAccepted(
                        stepId = d.getString("step_id") ?: continue,
                        fieldKey = d.getString("key") ?: continue,
                        at = d.getString("captured_at") ?: now(),
                    ),
                )
            }
        }

        val stopDecisions = db.collection("tenants").document(t).collection("decisions")
            .whereEqualTo("job_id", jobId)
            .addSnapshotListener { snap, e ->
                if (e != null || snap == null) return@addSnapshotListener
                for (change in snap.documentChanges) {
                    val decision = change.document.toDecision() ?: continue
                    trySend(JobEvent.DecisionMade(change.document.getString("step_id"), decision))
                }
            }

        val stopHeader = ref.addSnapshotListener { snap, e ->
            if (e != null || snap == null) return@addSnapshotListener
            if (snap.getString("status") == "sealed") {
                snap.getString("record_id")?.let { trySend(JobEvent.Sealed(it)) }
            }
        }

        awaitClose {
            stopOutcomes.remove(); stopFields.remove()
            stopDecisions.remove(); stopHeader.remove()
        }
    }

    // ------------------------------------------------------------------ mapping
    //
    // Written by hand rather than through a serializer. Firestore hands back Maps of Any?, the
    // contract types are strict, and a permissive automatic mapping would turn a missing
    // required field into a default that reads as real data.

    private fun DocumentSnapshot.toJob(steps: List<StepOutcome>): Job? {
        if (!exists()) return null
        return Job(
            id = getString("id") ?: return null,
            tenantId = getString("tenant_id") ?: return null,
            procedureId = getString("procedure_id") ?: return null,
            procedureVersion = (getLong("procedure_version") ?: 1L).toInt(),
            assetUrn = getString("asset_urn"),
            technicianId = getString("technician_id"),
            status = when (getString("status")) {
                "draft" -> JobStatus.DRAFT
                "waiting" -> JobStatus.WAITING
                "held" -> JobStatus.HELD
                "sealed" -> JobStatus.SEALED
                else -> JobStatus.OPEN
            },
            strictness = (getLong("strictness") ?: 1L).toInt(),
            tier = tierOf(getString("tier")),
            startedAt = getString("started_at") ?: now(),
            sealedAt = getString("sealed_at"),
            stepCount = (getLong("step_count") ?: 0L).toInt(),
            performedCount = (getLong("performed_count") ?: 0L).toInt(),
            fieldCount = (getLong("field_count") ?: 0L).toInt(),
            steps = steps,
        )
    }

    private fun DocumentSnapshot.toStepOutcome(fields: List<Field>): StepOutcome? {
        if (!exists()) return null
        @Suppress("UNCHECKED_CAST")
        val added = (get("added_fields") as? List<Map<*, *>>).orEmpty().map(::fieldDefOf)
        return StepOutcome(
            id = getString("id") ?: id,
            jobId = getString("job_id").orEmpty(),
            stepId = getString("step_id") ?: id,
            status = statusOf(getString("status")),
            reasonKind = when (getString("reason_kind")) {
                "voice" -> ReasonKind.VOICE
                "text" -> ReasonKind.TEXT
                else -> null
            },
            reasonTranscript = getString("reason_transcript"),
            reasonAudioRef = getString("reason_audio_ref"),
            reasonBy = getString("reason_by"),
            reasonAt = getString("reason_at"),
            addFieldsUsed = (getLong("add_fields_used") ?: 0L).toInt(),
            addedFields = added,
            acceptedFields = (get("accepted_fields") as? List<*>).orEmpty().map { it.toString() },
            escalationQuestion = getString("escalation_question"),
            holdReason = getString("hold_reason"),
            adjudicatedAt = getString("adjudicated_at"),
            fields = fields,
        )
    }

    private fun DocumentSnapshot.toField(): Field? {
        if (!exists()) return null
        return Field(
            id = getString("id") ?: id,
            stepId = getString("step_id") ?: return null,
            key = getString("key") ?: return null,
            kind = kindOf(getString("kind")),
            mediaRef = getString("media_ref"),
            capturedAt = getString("captured_at"),
            provenanceClass = null,
        )
    }

    private fun DocumentSnapshot.toDecision(): Decision? {
        if (!exists()) return null
        val agent = agentOf(getString("agent")) ?: return null
        return Decision(
            id = getString("id") ?: id,
            jobId = getString("job_id").orEmpty(),
            stepId = getString("step_id"),
            agent = agent,
            agentVersion = getString("agent_version") ?: "unknown",
            model = getString("model"),
            verdict = getString("verdict").orEmpty(),
            rationale = getString("rationale").orEmpty(),
            costUsd = getDouble("cost_usd"),
            at = getString("at") ?: now(),
        )
    }

    private fun DocumentSnapshot.toProcedure(): Procedure? {
        if (!exists()) return null
        // The steps are the whole procedure and are stored as one array on the document, which
        // is why publishing is a server act: this shape is written once and read many times.
        @Suppress("UNCHECKED_CAST")
        val raw = (get("steps") as? List<Map<String, Any?>>).orEmpty()
        return Procedure(
            id = getString("id") ?: id,
            tenantId = getString("tenant_id").orEmpty(),
            key = getString("key") ?: id,
            title = getString("title").orEmpty(),
            version = (getLong("version") ?: 1L).toInt(),
            strictness = (getLong("strictness") ?: 1L).toInt(),
            minimumTier = tierOf(getString("minimum_tier")),
            steps = raw.map(::stepOf),
            createdAt = getString("created_at") ?: now(),
        )
    }

    private fun stepOf(m: Map<*, *>): ink.warrant.contract.Step {
        @Suppress("UNCHECKED_CAST")
        val fields = (m["fields"] as? List<Map<*, *>>).orEmpty().map(::fieldDefOf)
        return ink.warrant.contract.Step(
            id = m["id"]?.toString() ?: "",
            index = (m["index"] as? Number)?.toInt() ?: 0,
            title = m["title"]?.toString().orEmpty(),
            explanation = m["explanation"]?.toString().orEmpty(),
            maxAddFields = (m["max_add_fields"] as? Number)?.toInt() ?: 2,
            fields = fields,
        )
    }

    private fun fieldDefOf(m: Map<*, *>) = FieldDef(
        key = m["key"]?.toString().orEmpty(),
        kind = kindOf(m["kind"]?.toString()),
        prompt = m["prompt"]?.toString().orEmpty(),
        source = when (m["source"]?.toString()) {
            "instrument" -> FieldSource.INSTRUMENT
            "human" -> FieldSource.HUMAN
            else -> FieldSource.CAMERA
        },
        requiredAtStrictness = (m["required_at_strictness"] as? Number)?.toInt() ?: 0,
        acceptanceRule = when (m["acceptance_rule"]?.toString()) {
            "within" -> AcceptanceRule.WITHIN
            "matches" -> AcceptanceRule.MATCHES
            "consistent_with" -> AcceptanceRule.CONSISTENT_WITH
            "per_spec" -> AcceptanceRule.PER_SPEC
            "signed_by" -> AcceptanceRule.SIGNED_BY
            else -> AcceptanceRule.MUST_SHOW
        },
        acceptanceDescription = m["acceptance_description"]?.toString(),
        guidance = m["guidance"]?.toString().orEmpty(),
    )

    private fun kindOf(raw: String?) = when (raw) {
        "measurement" -> FieldKind.MEASUREMENT
        "video" -> FieldKind.VIDEO
        "scan" -> FieldKind.SCAN
        "choice" -> FieldKind.CHOICE
        "text" -> FieldKind.TEXT
        "signature" -> FieldKind.SIGNATURE
        "location" -> FieldKind.LOCATION
        else -> FieldKind.PHOTO
    }

    private fun statusOf(raw: String?) = when (raw) {
        "performed" -> StepStatus.PERFORMED
        "deferred" -> StepStatus.DEFERRED
        "waived" -> StepStatus.WAIVED
        "impossible" -> StepStatus.IMPOSSIBLE
        else -> StepStatus.PENDING
    }

    private fun tierOf(raw: String?) = when (raw) {
        "attested" -> Tier.ATTESTED
        "instrumented" -> Tier.INSTRUMENTED
        else -> Tier.OPEN
    }

    private fun agentOf(raw: String?) = when (raw) {
        "scoper" -> Agent.SCOPER
        "foreman" -> Agent.FOREMAN
        "inspector" -> Agent.INSPECTOR
        "skeptic" -> Agent.SKEPTIC
        "auditor" -> Agent.AUDITOR
        "instructor" -> Agent.INSTRUCTOR
        "wright" -> Agent.WRIGHT
        else -> null
    }
}
