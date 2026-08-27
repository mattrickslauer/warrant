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
import ink.warrant.contract.ProcedureStatus
import ink.warrant.contract.CeilingUnreachable
import ink.warrant.contract.Deficiency
import ink.warrant.contract.ProvenanceClass
import ink.warrant.contract.Reading
import ink.warrant.contract.RecordIssuer
import ink.warrant.contract.RecordActor
import ink.warrant.contract.ReasonKind
import ink.warrant.contract.SealedRecord
import ink.warrant.contract.StepOutcome
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier
import ink.warrant.capture.Attestation
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

    /**
     * Nothing touches Firestore before there is a Firebase user.
     *
     * `firestore.rules` refuses everything to `request.auth == null`, and a rejected LISTEN is
     * not a quiet empty result — Firestore's async queue rethrows it on the main thread and
     * the process dies. This was found by running the app on a phone: it crashed on launch
     * with PERMISSION_DENIED and no frame of ours in the trace.
     */
    private suspend fun ready() { session.ensureSignedIn() }

    /**
     * The public catalogue has to exist in this tenant before the picker can offer it.
     *
     * Once per process. A stranger's tenant is created empty, so without this every public
     * task renders as "not in this build yet" — which is what the phone actually showed, and
     * is a far more confusing symptom than an error would have been.
     */
    @Volatile private var seeded = false

    private suspend fun seedPublic() {
        if (seeded) return
        ready()
        if (api.isConfigured) api.seedPublicProcedures(session.idToken())
        seeded = true
    }

    private fun now() = Instant.now().toString()
    private fun jobDoc(tenant: String, job: String) =
        db.collection("tenants").document(tenant).collection("jobs").document(job)

    // ------------------------------------------------------------------ procedures

    override suspend fun listProcedures(tenantId: String): List<Procedure> {
        seedPublic()
        val t = if (tenantId == "*") this.tenantId() else tenantId
        return db.collection("tenants").document(t).collection("procedures")
            .get().await().documents.mapNotNull { it.toProcedure() }
    }

    override suspend fun getProcedure(id: String): Procedure? {
        seedPublic()
        val (t, p) = if ('/' in id) split(id) else tenantId() to id
        return db.collection("tenants").document(t).collection("procedures").document(p)
            .get().await().toProcedure()
    }

    // ------------------------------------------------------------------ jobs

    override suspend fun startJob(procedureId: String, tenantId: String, tier: Tier): Job {
        seedPublic()
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
        ready()
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
        ready()
        val t = if (tenantId == "*") this.tenantId() else tenantId
        return db.collection("tenants").document(t).collection("jobs")
            .orderBy("started_at", Query.Direction.DESCENDING)
            .get().await().documents.mapNotNull { doc ->
                // The header alone. A list view that fanned out into every job's
                // subcollections would do N+1 reads to render a row that shows counters.
                doc.toJob(emptyList())
            }
    }

    /**
     * Subcollections first, header LAST, and the order is load-bearing.
     *
     * `firestore.rules` decides whether a step outcome, field or capture may be deleted by
     * reading the status of its PARENT JOB. Delete the header first and that read finds
     * nothing, every remaining delete is refused, and what is left is a shell of orphaned
     * evidence with no row in any list to reach it from — undeletable, because the document
     * the rule needs to consult is the one already gone.
     *
     * Doing it the other way round has the failure mode you want: the header is what makes a
     * job visible, so a delete that dies half way through leaves a job that is still whole,
     * still listed, and still deletable on a second tap.
     *
     * The status is read off the header rather than trusted from the caller. The rules refuse
     * a sealed job independently, so this check is not the control — it is what turns a
     * PERMISSION_DENIED into a sentence a person can act on.
     */
    override suspend fun deleteJob(id: String) {
        ready()
        val (t, j) = split(id)
        val ref = jobDoc(t, j)
        val header = ref.get().await()
        // Already gone is a success. See the note on DataSource.deleteJob.
        if (!header.exists()) return
        require(header.getString("status") != "sealed") { "a sealed job cannot be deleted: $id" }

        for (sub in listOf("step_outcomes", "fields", "captures")) {
            ref.collection(sub).get().await().documents.forEach { it.reference.delete().await() }
        }
        ref.delete().await()
    }

    // ------------------------------------------------------------------ evidence

    override suspend fun capture(input: CaptureInput): Capture {
        ready()
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
            // The stored path, or — for a text capture, the only kind with no object — the
            // answer itself. uploadMedia now returns null for that kind and nothing else.
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
                    CaptureKind.AUDIO, CaptureKind.TEXT -> "text"
                },
                // A text field points at no object, and its answer belongs on the field
                // rather than only on the capture — the Seal reads `value_text` when it
                // publishes, and a null there would seal a record missing the one thing the
                // technician actually said.
                "media_ref" to if (input.kind.hasObject) capRef.id else null,
                "value_text" to if (input.kind.hasObject) null else input.mediaRef,
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

        // Bound to THIS capture, so a token minted on a genuine device cannot be replayed
        // against a later fabrication. Null on any build not installed from Play, and the
        // server then records UNATTESTED rather than inventing a device.
        val integrity = appContext?.let { Attestation.token(it, capRef.id) }
        api.adjudicate(
            session.idToken(), input.jobId, input.stepId, input.fieldKey, capRef.id, integrity,
        )
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
        // No object, so nothing to put anywhere. Null here is the honest answer, and the
        // caller keeps the typed value in media_ref — see capture.schema.json.
        if (!input.kind.hasObject) return null

        // The same builder the record screen reads through. Written and read in one spelling
        // or the evidence is only findable by the surface that stored it.
        val ext = Media.extension(input.kind) ?: return null
        val path = Media.path(tenant, job, captureId, ext)
        val local = File(input.mediaRef)
        val uri = if (local.exists()) Uri.fromFile(local) else Uri.parse(input.mediaRef)

        // Fatal, and that is the point. This used to swallow the throw and hand back null,
        // and the caller then wrote a capture document and asked the fleet to rule on an
        // object that was never uploaded. The fleet did the only thing it could and returned
        // 404, which surfaced to the technician as "the fleet could not be reached" — a
        // sentence about the network, for a file that had failed to leave the phone.
        //
        // A capture that cannot be stored has not happened. Say so here, and let it reach
        // the person standing there while they can still take the photograph again.
        try {
            storage.reference.child(path).putFile(uri).await()
        } catch (e: Exception) {
            Log.w(TAG, "media upload failed for $path", e)
            throw IllegalStateException(
                "The photograph could not be uploaded, so nothing was recorded. " +
                    "Check the connection and take it again.",
                e,
            )
        }
        return path
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
        val at = now()
        val ok = api.submitReading(
            idToken = session.idToken(),
            jobId = input.jobId,
            stepId = input.stepId,
            fieldKey = input.fieldKey,
            key = input.fieldKey,
            value = input.value,
            unit = input.unit,
            frame = input.frame,
        )
        check(ok) { "The reading did not reach the record." }
        return Reading(
            id = "pending",
            fieldId = fieldId(input.stepId, input.fieldKey),
            key = input.fieldKey,
            value = input.value,
            unit = input.unit,
            // What this handset BELIEVES the tool was, for the screen only. The record's own
            // tool_id is written server-side from whichever registered secret verified the
            // frame, and is absent when nothing did — so an unattested reading shows here and
            // still cannot seal as measured.
            toolId = input.toolId,
            at = at,
        )
    }

    /**
     * Needed only to ask Play Integrity for a token. Null in tests and in any build without
     * Play Services, where the capture simply records UNATTESTED.
     */
    var appContext: android.content.Context? = null

    /**
     * Who is writing this, from the signed-in user and never from a caller.
     *
     * `reason_by` is a signature: the Seal reads it back to put a person's name, photograph and
     * role on a sealed record, and `dispose.ts` reads it as the technician a disposition
     * concerns. It used to be a parameter, and this call site passed the literal "technician" —
     * so the member lookup found nobody and no record ever named anyone, while an attacker
     * writing a COLLEAGUE'S uid would have been believed. firestore.rules now refuses the field
     * unless it equals `request.auth.uid`, and this is that uid, from the same session whose
     * token authorises the write.
     */
    private fun signedInUid(): String =
        session.uid ?: error("Not signed in; nothing can be written on nobody's behalf.")

    override suspend fun declareBlocked(input: BlockedInput): StepOutcome {
        ready()
        val (t, j) = split(input.jobId)
        val ref = jobDoc(t, j).collection("step_outcomes").document(input.stepId)
        ref.set(
            mapOf(
                "reason_kind" to input.reasonKind.name.lowercase(),
                "reason_transcript" to input.transcript,
                "reason_audio_ref" to input.audioRef,
                "reason_by" to signedInUid(),
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

    /**
     * An answer to a question an agent asked. Beside the question, never over it.
     *
     * Note what is NOT written: no status. `firestore.rules` refuses `performed`, `waived` and
     * `impossible` from every client (`clientMayNotSettleAStep`), and this path does not try —
     * a person answering a question about their own work is an interested party, and the fleet
     * still rules. The answer is an assertion, and it is stamped as one.
     *
     * `escalation_question` is deliberately left standing. A record that kept the answer and
     * dropped the question is unreadable to whoever checks it years later, and that reader is
     * the only one this document exists for. `hold_reason` DOES clear: it means "the fleet
     * could not act", and a person having now spoken is exactly the condition that ends it.
     */
    override suspend fun respond(input: ResponseInput): StepOutcome {
        ready()
        val (t, j) = split(input.jobId)
        val ref = jobDoc(t, j).collection("step_outcomes").document(input.stepId)
        val at = now()
        ref.set(
            mapOf(
                "escalation_answer" to input.answer,
                "escalation_answered_by" to input.by,
                "escalation_answered_at" to at,
                // A stated answer is asserted, exactly like a stated reason: a named human
                // said it, at this time, and nothing checked it.
                "provenance_class" to "asserted",
                "hold_reason" to null,
            ),
            com.google.firebase.firestore.SetOptions.merge(),
        ).await()
        return ref.get().await().toStepOutcome(emptyList())
            ?: error("step outcome vanished after being answered")
    }

    /**
     * A signed download URL for a stored object.
     *
     * Storage refuses an unauthenticated read, so the path on the capture document is not
     * something an `<img>` — or a `BitmapFactory` — can open. This exchanges it for a URL
     * carrying a token, which is why it is a suspend call and not a string concatenation.
     *
     * A failure returns null rather than throwing. Evidence that cannot be fetched is a gap in
     * what this screen can show, not a reason to fail the whole record: the rest of it — the
     * decisions, the deficiencies, the ceiling — is still exactly as true.
     */
    override suspend fun mediaUrl(jobId: String, captureId: String, kind: FieldKind): String? {
        if (captureId.isBlank() || jobId.isBlank()) return null
        // A kind with no object behind it — text, a choice, a number. Null is the honest
        // answer, and asking Storage for it would build a path out of somebody's sentence.
        val ext = Media.extension(kind) ?: return null
        val (t, j) = runCatching { split(jobId) }.getOrNull() ?: return null
        ready()
        val path = Media.path(t, j, captureId, ext)
        return runCatching { storage.reference.child(path).downloadUrl.await().toString() }
            .onFailure { Log.i(TAG, "no download url for $path", it) }
            .getOrNull()
    }

    // ------------------------------------------------------------------ records

    /**
     * The sealed artifact.
     *
     * `records` is on the `serverWritten` list in firestore.rules — readable inside the tenant,
     * writable by nobody with a client. So this reads, and only reads, and the immutability the
     * record claims on its face is enforced by the database rather than by everyone remembering.
     *
     * The document id is the job id; `id` inside it is bare, so it is scoped on the way out the
     * way a job header already is. A bare id would not survive a round trip back through here,
     * which addresses by tenant.
     */
    override suspend fun getRecord(id: String): SealedRecord? {
        ready()
        val (t, r) = split(id)
        return db.collection("tenants").document(t).collection("records").document(r)
            .get().await().toSealedRecord(t)
    }

    override suspend fun listRecords(tenantId: String): List<SealedRecord> {
        ready()
        val t = if (tenantId == "*") this.tenantId() else tenantId
        return db.collection("tenants").document(t).collection("records")
            .orderBy("sealed_at", Query.Direction.DESCENDING)
            .get().await().documents.mapNotNull { it.toSealedRecord(t) }
    }

    override suspend fun listDecisions(tenantId: String): List<Decision> {
        ready()
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
        // Before ANY listener is registered. A listen registered without a user is rejected,
        // and a rejected listen kills the process rather than returning nothing.
        ready()
        val (t, j) = split(jobId)
        val ref = jobDoc(t, j)
        val seenStatus = mutableMapOf<String, StepStatus>()
        val seenAdded = mutableSetOf<String>()
        val seenEscalation = mutableMapOf<String, String>()

        val stopOutcomes = ref.collection("step_outcomes").addSnapshotListener { snap, e ->
            // Logged, never rethrown. Consuming the error here is what keeps a rules rejection
            // from becoming a crash — and saying nothing at all is how a permanently empty
            // screen gets mistaken for a job with no steps.
            if (e != null) { Log.w(TAG, "step_outcomes listener failed", e) }
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
            if (e != null) { Log.w(TAG, "fields listener failed", e) }
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
                if (e != null) { Log.w(TAG, "decisions listener failed", e) }
                if (e != null || snap == null) return@addSnapshotListener
                for (change in snap.documentChanges) {
                    val decision = change.document.toDecision() ?: continue
                    trySend(JobEvent.DecisionMade(change.document.getString("step_id"), decision))
                }
            }

        val stopHeader = ref.addSnapshotListener { snap, e ->
            if (e != null) { Log.w(TAG, "job header listener failed", e) }
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
            escalationAnswer = getString("escalation_answer"),
            escalationAnsweredBy = getString("escalation_answered_by"),
            escalationAnsweredAt = getString("escalation_answered_at"),
            holdReason = getString("hold_reason"),
            adjudicatedAt = getString("adjudicated_at"),
            fields = fields,
        )
    }

    /**
     * A sealed record, out of the one document the Seal wrote.
     *
     * Everything is embedded — steps, decisions, the ceiling, the people — because a record is
     * read by strangers who hold nothing but a link, and a document that needed six more reads
     * to render would be six more chances for one of them to be refused. `web/src/server/seal.ts`
     * writes this shape; this reads it, and the two are the same list in the same order.
     *
     * A record whose `sealed_at` cannot be read is dropped rather than defaulted to now(). The
     * date is the claim — "this was true at this moment" — and inventing one would be forging
     * the only part of the record that fixes it in time.
     */
    @Suppress("UNCHECKED_CAST")
    private fun DocumentSnapshot.toSealedRecord(tenant: String): SealedRecord? {
        if (!exists()) return null
        val sealedAt = getString("sealed_at") ?: return null

        val steps = (get("steps") as? List<Map<*, *>>).orEmpty().map(::stepOutcomeOf)
        val decisions = (get("decisions") as? List<Map<*, *>>).orEmpty().mapNotNull(::decisionOf)

        val unreachable = (get("ceiling_unreachable") as? List<Map<*, *>>).orEmpty().mapNotNull { m ->
            val cls = classOf(m["class"]?.toString()) ?: return@mapNotNull null
            CeilingUnreachable(cls, m["reason"]?.toString().orEmpty())
        }
        val deficiencies = (get("deficiencies") as? List<Map<*, *>>).orEmpty().map { m ->
            Deficiency(
                stepId = m["step_id"]?.toString().orEmpty(),
                status = statusOf(m["status"]?.toString()),
                reason = m["reason"]?.toString() ?: "no reason recorded",
            )
        }

        return SealedRecord(
            // Scoped on the way out. The bare id in the document would not survive a round
            // trip back through getRecord(), which addresses by tenant.
            id = "$tenant/${getString("id") ?: id}",
            jobId = getString("job_id").orEmpty(),
            tenantId = getString("tenant_id") ?: tenant,
            public = getBoolean("public") ?: false,
            sealedAt = sealedAt,
            ceilingTier = tierOf(getString("ceiling_tier")),
            ceilingReachable = (get("ceiling_reachable") as? List<*>).orEmpty()
                .mapNotNull { classOf(it?.toString()) },
            ceilingUnreachable = unreachable,
            deficiencies = deficiencies,
            // Absent reads as HELD, never as released. A release is the one claim on this
            // document that can put a machine back into service, and a value we failed to
            // read must fall on the side that keeps somebody safe.
            machineReleased = getBoolean("machine_released") ?: false,
            steps = steps,
            decisions = decisions,
            publicId = getString("public_id"),
            issuer = (get("issuer") as? Map<*, *>)?.let { m ->
                RecordIssuer(displayName = m["display_name"]?.toString() ?: "an unnamed issuer")
            },
            actors = (get("actors") as? List<Map<*, *>>).orEmpty().mapNotNull { m ->
                val uid = m["uid"]?.toString() ?: return@mapNotNull null
                RecordActor(
                    uid = uid,
                    displayName = m["display_name"]?.toString() ?: "a technician",
                    photoRef = m["photo_ref"]?.toString(),
                    role = m["role"]?.toString(),
                )
            },
        )
    }

    /**
     * A step outcome out of a MAP rather than a document.
     *
     * The seal embeds the outcomes in the record, so they arrive as plain maps and cannot go
     * through [toStepOutcome], which reads a snapshot. Same fields, same defaults, deliberately
     * kept adjacent so the two cannot drift.
     */
    @Suppress("UNCHECKED_CAST")
    private fun stepOutcomeOf(m: Map<*, *>): StepOutcome {
        val fields = (m["fields"] as? List<Map<*, *>>).orEmpty().mapNotNull(::fieldOf)
        return StepOutcome(
            id = m["id"]?.toString().orEmpty(),
            jobId = m["job_id"]?.toString().orEmpty(),
            stepId = m["step_id"]?.toString().orEmpty(),
            status = statusOf(m["status"]?.toString()),
            reasonKind = when (m["reason_kind"]?.toString()) {
                "voice" -> ReasonKind.VOICE
                "text" -> ReasonKind.TEXT
                else -> null
            },
            reasonTranscript = m["reason_transcript"]?.toString(),
            reasonAudioRef = m["reason_audio_ref"]?.toString(),
            reasonBy = m["reason_by"]?.toString(),
            reasonAt = m["reason_at"]?.toString(),
            recommendationText = m["recommendation_text"]?.toString(),
            recommendationModel = m["recommendation_model"]?.toString(),
            waivedBy = m["waived_by"]?.toString(),
            addFieldsUsed = (m["add_fields_used"] as? Number)?.toInt() ?: 0,
            addedFields = (m["added_fields"] as? List<Map<*, *>>).orEmpty().map(::fieldDefOf),
            acceptedFields = (m["accepted_fields"] as? List<*>).orEmpty().map { it.toString() },
            escalationQuestion = m["escalation_question"]?.toString(),
            escalationAnswer = m["escalation_answer"]?.toString(),
            escalationAnsweredBy = m["escalation_answered_by"]?.toString(),
            escalationAnsweredAt = m["escalation_answered_at"]?.toString(),
            holdReason = m["hold_reason"]?.toString(),
            adjudicatedAt = m["adjudicated_at"]?.toString(),
            fields = fields,
        )
    }

    private fun fieldOf(m: Map<*, *>): Field? {
        val stepId = m["step_id"]?.toString() ?: return null
        val key = m["key"]?.toString() ?: return null
        return Field(
            id = m["id"]?.toString() ?: "${stepId}__$key",
            stepId = stepId,
            key = key,
            kind = kindOf(m["kind"]?.toString()),
            valueNumber = (m["value_number"] as? Number)?.toDouble(),
            valueText = m["value_text"]?.toString(),
            valueChoice = m["value_choice"]?.toString(),
            unit = m["unit"]?.toString(),
            mediaRef = m["media_ref"]?.toString(),
            toolId = m["tool_id"]?.toString(),
            capturedAt = m["captured_at"]?.toString(),
            provenanceClass = classOf(m["provenance_class"]?.toString()),
        )
    }

    private fun decisionOf(m: Map<*, *>): Decision? {
        val agent = agentOf(m["agent"]?.toString()) ?: return null
        return Decision(
            id = m["id"]?.toString().orEmpty(),
            jobId = m["job_id"]?.toString().orEmpty(),
            stepId = m["step_id"]?.toString(),
            agent = agent,
            agentVersion = m["agent_version"]?.toString() ?: "unknown",
            model = m["model"]?.toString(),
            verdict = m["verdict"]?.toString().orEmpty(),
            rationale = m["rationale"]?.toString().orEmpty(),
            costUsd = (m["cost_usd"] as? Number)?.toDouble(),
            at = m["at"]?.toString() ?: now(),
        )
    }

    /**
     * Null for an unknown class, never a default.
     *
     * Every other `…Of` here falls back to the weakest member, which is right when the value is
     * a mode or a kind. This one is the provenance class — the product — and quietly reading an
     * unrecognised string as `asserted` would put a claim on the record nobody made.
     */
    private fun classOf(raw: String?) = when (raw) {
        "measured" -> ProvenanceClass.MEASURED
        "specified" -> ProvenanceClass.SPECIFIED
        "inferred" -> ProvenanceClass.INFERRED
        "asserted" -> ProvenanceClass.ASSERTED
        else -> null
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
            // What this version went out without. Read rather than dropped on the floor: the
            // technician is entitled to know a check was removed from the procedure they are
            // about to run, and a list nobody parses is the same as no list.
            dropped = (get("dropped") as? List<*>).orEmpty().mapNotNull { it as? String },
            // Read rather than left to default. `Your procedures` decides what it may offer
            // from exactly these three, and a draft that read as published would offer to
            // show the world a version nobody had frozen.
            status = procedureStatusOf(getString("status")),
            currentVersion = (getLong("current_version") ?: getLong("version") ?: 1L).toInt(),
            publicId = getString("public_id"),
            createdAt = getString("created_at") ?: now(),
        )
    }

    /**
     * Unknown reads as drafting, deliberately.
     *
     * The permissive default would be `published`, and it is the wrong one: every act this
     * status gates — sharing above all — is refused for a draft, so a value we failed to
     * understand must fall on the side that offers less, not more.
     */
    private fun procedureStatusOf(raw: String?): ProcedureStatus = when (raw) {
        "published" -> ProcedureStatus.PUBLISHED
        "archived" -> ProcedureStatus.ARCHIVED
        else -> ProcedureStatus.DRAFTING
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
            requiredAtStrictness = (m["required_at_strictness"] as? Number)?.toInt() ?: 0,
            fields = fields,
        )
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

// ------------------------------------------------------------------ wire readers
//
// Top level and `internal` rather than private members of [LiveSource], so that a unit test
// can hand them a map and check what comes back. That is not a tidiness preference: the bug
// these carry a regression test for — a CHOICE field arriving with its answers stripped —
// was invisible from every other seam in the app, because the procedure was correct, the
// step page was correct, and the only wrong thing in the chain was one missing key in a
// mapper that no test could reach without a Firebase connection.

/**
 * A declared field, off the wire.
 *
 * Five keys used to be missing from here, and every one of them was a value the procedure
 * had actually stated and this client threw on the floor. They are grouped and named
 * below rather than left as a flat list, because the failure they caused was not a typo:
 * each omission turned a procedure that said something into an app that said nothing.
 *
 *  * **`choices`** was the expensive one. Without it every CHOICE field arrives with an
 *    empty answer list whatever the procedure declared, and the step page — correctly —
 *    says "the procedure lists none" and cannot offer an answer. So a Segway brake service
 *    whose published version carries "Responsive and quiet / Scraping or noisy /
 *    Unresponsive or soft" presented, on the handset, as a question with no answers. The
 *    procedure was never wrong. The reader was.
 *
 *  * **`acceptance_min`, `acceptance_max`, `acceptance_unit`** are the band. `Accepts…`
 *    under a measurement reads off exactly these, so without them the technician is asked
 *    for a reading and told nothing about what would be a good one — while the Inspector
 *    judges it against the band anyway. Being marked down against a figure nobody showed
 *    you is the specific unfairness `guidance` exists to prevent.
 *
 *  * **`acceptance_target`** is what a `matches` or `per_spec` field resolves against.
 *
 * The band is read through `Number`, never `as? Double`. Firestore hands back a `Long`
 * for a whole number and a `Double` otherwise, so a bound of 7 and a bound of 7.5 arrive
 * as different types — and `as? Double` would silently drop every round figure, which is
 * a band that quietly loses one of its two ends.
 */
internal fun fieldDefOf(m: Map<*, *>) = FieldDef(
    key = m["key"]?.toString().orEmpty(),
    kind = kindOf(m["kind"]?.toString()),
    prompt = m["prompt"]?.toString().orEmpty(),
    source = when (m["source"]?.toString()) {
        "instrument" -> FieldSource.INSTRUMENT
        "human" -> FieldSource.HUMAN
        else -> FieldSource.CAMERA
    },
    requiredAtStrictness = (m["required_at_strictness"] as? Number)?.toInt() ?: 0,
    choices = (m["choices"] as? List<*>).orEmpty().mapNotNull { it?.toString() },
    acceptanceRule = when (m["acceptance_rule"]?.toString()) {
        "within" -> AcceptanceRule.WITHIN
        "matches" -> AcceptanceRule.MATCHES
        "consistent_with" -> AcceptanceRule.CONSISTENT_WITH
        "per_spec" -> AcceptanceRule.PER_SPEC
        "signed_by" -> AcceptanceRule.SIGNED_BY
        else -> AcceptanceRule.MUST_SHOW
    },
    acceptanceMin = (m["acceptance_min"] as? Number)?.toDouble(),
    acceptanceMax = (m["acceptance_max"] as? Number)?.toDouble(),
    acceptanceUnit = m["acceptance_unit"]?.toString(),
    acceptanceTarget = m["acceptance_target"]?.toString(),
    acceptanceDescription = m["acceptance_description"]?.toString(),
    guidance = m["guidance"]?.toString().orEmpty(),
)

internal fun kindOf(raw: String?) = when (raw) {
    "measurement" -> FieldKind.MEASUREMENT
    "video" -> FieldKind.VIDEO
    "scan" -> FieldKind.SCAN
    "choice" -> FieldKind.CHOICE
    "text" -> FieldKind.TEXT
    "signature" -> FieldKind.SIGNATURE
    "location" -> FieldKind.LOCATION
    else -> FieldKind.PHOTO
}
