package ink.warrant.data

import ink.warrant.contract.Capture
import ink.warrant.contract.CaptureKind
import ink.warrant.contract.CaptureMode
import ink.warrant.contract.CaptureSurface
import ink.warrant.contract.Decision
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.Job
import ink.warrant.contract.Procedure
import ink.warrant.contract.ProvenanceClass
import ink.warrant.contract.Reading
import ink.warrant.contract.ReasonKind
import ink.warrant.contract.SealedRecord
import ink.warrant.contract.StepOutcome
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier
import kotlinx.coroutines.flow.Flow

/**
 * The seam.
 *
 * Every surface — this app and, by the same shape, the web client — reads and writes through
 * this and nothing else. Two implementations exist: [FixtureSource] now, and LiveSource once
 * Firestore and the agent services are behind it. Screens depend on this interface only, so
 * hooking up the real backend swaps one binding and never rewrites a screen.
 *
 * This mirrors `web/src/data/source.ts` deliberately and almost line for line. Three
 * differences, all intentional:
 *
 *  1. `subscribe` returns a [Flow] rather than taking a callback and handing back an
 *     `Unsubscribe`. Same contract; cancellation is structural instead of manual.
 *  2. [submitReading] exists here and has no counterpart on the web. That asymmetry IS the
 *     tier ceiling, expressed in the type system: a browser cannot pair with an instrument, so
 *     it has no method with which to produce a measured value. See [Tier].
 *  3. [deleteJob] exists here and does not yet exist on the web. Unlike the two above this is
 *     NOT a claim about what a browser can do — a browser could delete a job perfectly well.
 *     It is simply not built there yet, and the rule that decides it lives in
 *     `firestore.rules` rather than in either client, so the web can grow the same method
 *     without a second opinion about what may be deleted.
 */
interface DataSource {
    /** "fixture" or "live". */
    val name: String

    /** True when the surface is serving fabricated data. Screens MUST show this. */
    val fabricated: Boolean

    suspend fun listProcedures(tenantId: String): List<Procedure>
    suspend fun getProcedure(id: String): Procedure?

    suspend fun startJob(procedureId: String, tenantId: String, tier: Tier): Job
    suspend fun getJob(id: String): Job?
    /** `"*"` means every tenant — the same wildcard [listProcedures] takes. */
    suspend fun listJobs(tenantId: String): List<Job>

    /**
     * Throw away a job that never sealed.
     *
     * The only destructive act any client of this product gets, and it is bounded to the one
     * case where nothing is actually destroyed: a job that produced no record. A SEALED job is
     * refused here, refused again by `firestore.rules`, and would be pointless to delete
     * anyway — the record is a separate immutable document that outlives the job it came from,
     * and it is the artifact a stranger was given a link to.
     *
     * Why a delete exists at all, in a product whose entire thesis is that evidence is not
     * editable: because a shop accumulates half-finished runs. A job started against the wrong
     * machine, a demo, a phone that came out of a pocket mid-procedure. None of them ever
     * became evidence, all of them sit in the records list forever, and the one job that
     * genuinely wants an answer ends up three screens down. Refusing to let anybody clean that
     * up does not protect a single record; it just makes the list useless, and a list nobody
     * reads is how a waiting question goes unanswered for a week.
     *
     * So the line is drawn at the seal, not at the delete. Before the seal a job is an attempt.
     * After it, it is a record, and nothing on any surface can touch it.
     *
     * Throws [IllegalArgumentException] if the job has sealed. Deleting a job that is already
     * gone is NOT an error — two taps on a slow list would otherwise show a failure for work
     * that succeeded.
     */
    suspend fun deleteJob(id: String)

    /** Returns as soon as the evidence is stored. The verdict arrives later, over [subscribe]. */
    suspend fun capture(input: CaptureInput): Capture

    /**
     * A number that arrived from a paired instrument without passing through a human. The only
     * path to the measured class, and the reason this app exists rather than a web form.
     */
    suspend fun submitReading(input: ReadingInput): Reading

    /** The second exit. A step is never silently abandoned. */
    suspend fun declareBlocked(input: BlockedInput): StepOutcome

    /**
     * Answer the question an agent raised, from wherever the person happens to be.
     *
     * Distinct from [declareBlocked], which says "I cannot do this step". This says "here is
     * the thing you asked me for", and the difference matters to the Foreman reading it: one
     * is a blocker to chase, the other is evidence to rule on.
     *
     * It does NOT settle the step, and it cannot — `firestore.rules` refuses `performed`,
     * `waived` and `impossible` from every client. That refusal is the product: a person
     * answering a question about their own work is an interested party, and the fleet still
     * has to rule on what they said. The answer lands beside the question, never over it.
     */
    suspend fun respond(input: ResponseInput): StepOutcome

    /**
     * Turn a stored capture into something that can actually be shown, or null if nothing can.
     *
     * Takes the capture ID, not a path — because a field's `media_ref` IS a capture id, and
     * the object's path is derived from that id and the [kind] by [Media]. This used to take a
     * bare `ref` and the record screen passed it `field.media_ref`, so every photograph on a
     * live record was handed a capture id where a storage path was expected, resolved to null,
     * and rendered as "evidence stored, not reachable from here" — about bytes that were
     * sitting in the bucket the whole time. The signature is the fix: there is now no way to
     * call this with the wrong one of the two things named `media_ref`.
     *
     * [jobId] is scoped (`tenant/job`), the form ids travel in everywhere else.
     *
     * A ref is not a URL. On the fixture the bytes are a file on this device; on the live path
     * they are an object in Cloud Storage that needs a signed download URL before any surface
     * can read a byte of it. Screens must not know which, so they ask here.
     *
     * Null is a real answer and means "there is no image behind this" — a kind that has no
     * object at all, or media that has gone. A screen that got a broken URL and rendered a
     * torn-image icon would be claiming evidence exists when it does not.
     */
    suspend fun mediaUrl(jobId: String, captureId: String, kind: FieldKind): String?

    suspend fun getRecord(id: String): SealedRecord?

    /**
     * Every sealed record for a tenant, newest first. `"*"` means every tenant.
     *
     * A job knows nothing about the record it produced — sealing is one-way, and the record
     * id is deliberately unguessable because it is a public URL. So going from a job back to
     * its evidence means asking here rather than deriving an id.
     */
    suspend fun listRecords(tenantId: String): List<SealedRecord>
    suspend fun listDecisions(tenantId: String): List<Decision>

    /**
     * What arrives AFTER the technician has moved on.
     *
     * This is the whole reason the seam exists. Verification is asynchronous: the capture is
     * accepted immediately, the screen advances, and a verdict lands seconds or days later —
     * sometimes growing a field that was not in the procedure when the job started. A data
     * layer that returned settled answers would let you build screens in a world where none of
     * that happens, and every one of them would break the day the real backend arrived.
     */
    fun subscribe(jobId: String): Flow<JobEvent>
}

/** What arrives after the technician has moved on. */
sealed interface JobEvent {
    /** Stored, and the step may advance. Says nothing about whether it was any good. */
    data class CaptureAccepted(
        val stepId: String,
        val fieldKey: String,
        val at: String,
    ) : JobEvent

    /** One agent did one thing. Rendered by AgentTrace and carried by the public log. */
    data class DecisionMade(val stepId: String?, val decision: Decision) : JobEvent

    /**
     * The form GREW. The Inspector appended a field to the live procedure because the evidence
     * was insufficient but recoverable. Bounded by the step's `max_add_fields`.
     */
    data class FieldAdded(val stepId: String, val field: FieldDef) : JobEvent

    data class StepStatusChanged(val stepId: String, val status: StepStatus) : JobEvent

    /** ADD FIELD exhausted, or evidence unrecoverable. A human now owns the specific question. */
    data class Escalated(val stepId: String, val question: String) : JobEvent

    /** A reading landed from a paired instrument. */
    data class ReadingArrived(
        val stepId: String,
        val fieldKey: String,
        val reading: Reading,
    ) : JobEvent

    /** The Gate is holding the machine. */
    data class Held(val reason: String) : JobEvent

    data class Sealed(val recordId: String) : JobEvent
}

data class CaptureInput(
    val jobId: String,
    val stepId: String,
    val fieldKey: String,
    val kind: CaptureKind,
    /** A content URI or file path here; a storage ref once live. Never the bytes themselves. */
    val mediaRef: String,
    val surface: CaptureSurface,
    /** live = grabbed from an open camera stream here and now. Uploads cannot show liveness. */
    val mode: CaptureMode,
    /** On-device ML Kit redaction has run. A record is not readable until this is true. */
    val redacted: Boolean = false,
)

data class ReadingInput(
    val jobId: String,
    val stepId: String,
    val fieldKey: String,
    val value: Double,
    val unit: String,
    /** Device identity. Without this the value is typed, not measured. */
    val toolId: String,
    /**
     * What the instrument SIGNED, relayed unchanged.
     *
     * Null when the device does not sign, and for the simulator. The server writes a reading
     * either way — but only a verified frame earns a `tool_id`, and `tool_id` is the entire
     * difference between `measured` and typed. So this is the field that decides it.
     *
     * The app cannot produce one: the signing key lives on the instrument and never reaches
     * the handset. That is the point — the phone used to hold a shared password and vouch for
     * the number, which is a weaker claim than the record was making.
     */
    val frame: ReadingFrame? = null,
)

/** The instrument's signature over its own bytes. See [ReadingInput.frame]. */
data class ReadingFrame(
    val counter: Long,
    val rawHex: String,
    val signature: String,
)

data class BlockedInput(
    val jobId: String,
    val stepId: String,
    val reasonKind: ReasonKind,
    val transcript: String,
    val audioRef: String? = null,
)

/** An answer to a question an agent asked. See [DataSource.respond]. */
data class ResponseInput(
    val jobId: String,
    val stepId: String,
    /** What the person said, in their words. */
    val answer: String,
    /** Who said it. A named human, or the warrant_uid on the open tier. */
    val by: String,
)

/** What a procedure needs from a surface, and what a surface can actually supply. */
val TIER_RANK: Map<Tier, Int> = mapOf(
    Tier.OPEN to 0,
    Tier.ATTESTED to 1,
    Tier.INSTRUMENTED to 2,
)

val CLASS_BY_TIER: Map<Tier, List<ProvenanceClass>> = mapOf(
    Tier.OPEN to listOf(ProvenanceClass.INFERRED, ProvenanceClass.ASSERTED),
    Tier.ATTESTED to listOf(
        ProvenanceClass.SPECIFIED, ProvenanceClass.INFERRED, ProvenanceClass.ASSERTED,
    ),
    Tier.INSTRUMENTED to listOf(
        ProvenanceClass.MEASURED, ProvenanceClass.SPECIFIED,
        ProvenanceClass.INFERRED, ProvenanceClass.ASSERTED,
    ),
)

/** The one-line reason a class is out of reach. This is the call to action, and it is honest. */
val UNREACHABLE_REASON: Map<ProvenanceClass, String> = mapOf(
    ProvenanceClass.MEASURED to "requires a paired instrument",
    ProvenanceClass.SPECIFIED to "requires a catalogued machine with a published figure",
)

/**
 * A procedure demanding a class the surface cannot reach is REFUSED, never downgraded.
 * Silently running a regulated procedure at a lower assurance than it asks for is the failure
 * this whole product exists to make impossible.
 */
fun surfaceCanRun(procedure: Procedure, tier: Tier): Boolean =
    (TIER_RANK[tier] ?: 0) >= (TIER_RANK[procedure.minimumTier] ?: 0)
