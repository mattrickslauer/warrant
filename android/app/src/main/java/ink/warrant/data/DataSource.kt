package ink.warrant.data

import ink.warrant.contract.Capture
import ink.warrant.contract.CaptureKind
import ink.warrant.contract.CaptureMode
import ink.warrant.contract.CaptureSurface
import ink.warrant.contract.Decision
import ink.warrant.contract.FieldDef
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
 * This mirrors `web/src/data/source.ts` deliberately and almost line for line. Two differences,
 * both intentional:
 *
 *  1. `subscribe` returns a [Flow] rather than taking a callback and handing back an
 *     `Unsubscribe`. Same contract; cancellation is structural instead of manual.
 *  2. [submitReading] exists here and has no counterpart on the web. That asymmetry IS the
 *     tier ceiling, expressed in the type system: a browser cannot pair with an instrument, so
 *     it has no method with which to produce a measured value. See [Tier].
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

    /** Returns as soon as the evidence is stored. The verdict arrives later, over [subscribe]. */
    suspend fun capture(input: CaptureInput): Capture

    /**
     * A number that arrived from a paired instrument without passing through a human. The only
     * path to the measured class, and the reason this app exists rather than a web form.
     */
    suspend fun submitReading(input: ReadingInput): Reading

    /** The second exit. A step is never silently abandoned. */
    suspend fun declareBlocked(input: BlockedInput): StepOutcome

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
)

data class BlockedInput(
    val jobId: String,
    val stepId: String,
    val reasonKind: ReasonKind,
    val transcript: String,
    val audioRef: String? = null,
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
