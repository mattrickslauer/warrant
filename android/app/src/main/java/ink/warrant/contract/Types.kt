package ink.warrant.contract

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The contract, in Kotlin.
 *
 * Hand-written from `contract/entities/<entity>.schema.json`, deliberately — see the spec, §4:
 * "TypeScript is generated; the Kotlin five are typed; a contract test guards the boundary.
 * Same guarantee, a day cheaper." `ContractShapeTest` is that guard.
 *
 * SHAPE RULE, from `contract/README.md`: flat with a discriminator. A [Field] carries every
 * possible value slot with most of them null, and [Field.kind] says which one is meaningful.
 * It is uglier than a sealed hierarchy and it works identically in TypeScript, Kotlin and
 * Vertex — a model cannot get it wrong, and there is no projection step to maintain. Do not
 * "improve" this into a sealed class; the ugliness is load-bearing.
 *
 * Enums are strings, matching the schema exactly, so the same JSON feeds all three consumers.
 */

// ----------------------------------------------------------------- enumerations

@Serializable
enum class FieldKind {
    @SerialName("measurement") MEASUREMENT,
    @SerialName("photo") PHOTO,
    @SerialName("video") VIDEO,
    @SerialName("scan") SCAN,
    @SerialName("choice") CHOICE,
    @SerialName("text") TEXT,
    @SerialName("signature") SIGNATURE,
    @SerialName("location") LOCATION,
}

/** `instrument` is the only source that can yield the measured class. */
@Serializable
enum class FieldSource {
    @SerialName("instrument") INSTRUMENT,
    @SerialName("camera") CAMERA,
    @SerialName("human") HUMAN,
}

/** Decides the provenance class. within/matches/per_spec resolve without a model. */
@Serializable
enum class AcceptanceRule {
    @SerialName("within") WITHIN,
    @SerialName("matches") MATCHES,
    @SerialName("must_show") MUST_SHOW,
    @SerialName("consistent_with") CONSISTENT_WITH,
    @SerialName("per_spec") PER_SPEC,
    @SerialName("signed_by") SIGNED_BY,
}

@Serializable
enum class ProvenanceClass {
    @SerialName("measured") MEASURED,
    @SerialName("specified") SPECIFIED,
    @SerialName("inferred") INFERRED,
    @SerialName("asserted") ASSERTED,
}

/** What the surface performing this job can actually supply. */
@Serializable
enum class Tier {
    @SerialName("open") OPEN,
    @SerialName("attested") ATTESTED,
    @SerialName("instrumented") INSTRUMENTED,
}

@Serializable
enum class JobStatus {
    @SerialName("open") OPEN,
    @SerialName("waiting") WAITING,
    @SerialName("held") HELD,
    @SerialName("sealed") SEALED,
}

/**
 * There is no skip. `deferred` keeps the job open and the machine held; `waived` seals with a
 * signed waiver and releases; `impossible` seals deficient and files a procedure defect.
 */
@Serializable
enum class StepStatus {
    @SerialName("pending") PENDING,
    @SerialName("performed") PERFORMED,
    @SerialName("deferred") DEFERRED,
    @SerialName("waived") WAIVED,
    @SerialName("impossible") IMPOSSIBLE,
}

@Serializable
enum class CaptureKind {
    @SerialName("photo") PHOTO,
    @SerialName("video") VIDEO,
    @SerialName("audio") AUDIO,
    @SerialName("scan") SCAN,
}

/**
 * `live` means the frame was grabbed from an active camera stream on this device. An uploaded
 * file says nothing about when or where it was made, so it can never support a stronger class
 * than a claim.
 */
@Serializable
enum class CaptureMode {
    @SerialName("live") LIVE,
    @SerialName("upload") UPLOAD,
}

/**
 * `browser` cannot reach the measured class: no pairing, no attestation, and its sensors are
 * supplied by the person being verified. This app is the reason `app_instrument` exists.
 */
@Serializable
enum class CaptureSurface {
    @SerialName("browser") BROWSER,
    @SerialName("app") APP,
    @SerialName("app_instrument") APP_INSTRUMENT,
}

@Serializable
enum class Agent {
    @SerialName("scoper") SCOPER,
    @SerialName("foreman") FOREMAN,
    @SerialName("inspector") INSPECTOR,
    @SerialName("skeptic") SKEPTIC,
    @SerialName("auditor") AUDITOR,
    @SerialName("instructor") INSTRUCTOR,
    @SerialName("wright") WRIGHT,
}

@Serializable
enum class ReasonKind {
    @SerialName("voice") VOICE,
    @SerialName("text") TEXT,
}

/** The Foreman's call on what happens to the job, the machine, the booking and the parts order. */
@Serializable
enum class DispositionAction {
    @SerialName("chase") CHASE,
    @SerialName("reorder") REORDER,
    @SerialName("escalate") ESCALATE,
    @SerialName("revise") REVISE,
}

/** Which resolution step supplied the bound. See data-model.md §5. */
@Serializable
enum class ResolvedFrom {
    @SerialName("override_instance") OVERRIDE_INSTANCE,
    @SerialName("override_type") OVERRIDE_TYPE,
    @SerialName("spec") SPEC,
    @SerialName("asked") ASKED,
}

// ----------------------------------------------------------------- entities

/** What a procedure DECLARES a step must produce. The filled version is [Field]. */
@Serializable
data class FieldDef(
    val key: String,
    val kind: FieldKind,
    val prompt: String,
    val source: FieldSource,
    @SerialName("required_at_strictness") val requiredAtStrictness: Int,
    val choices: List<String> = emptyList(),
    @SerialName("acceptance_rule") val acceptanceRule: AcceptanceRule,
    @SerialName("acceptance_min") val acceptanceMin: Double? = null,
    @SerialName("acceptance_max") val acceptanceMax: Double? = null,
    @SerialName("acceptance_unit") val acceptanceUnit: String? = null,
    @SerialName("acceptance_target") val acceptanceTarget: String? = null,
    @SerialName("acceptance_description") val acceptanceDescription: String? = null,
    /**
     * What good looks like, in plain language. Shown to the human BEFORE the capture — the
     * same rule the Inspector applies after it.
     */
    val guidance: String,
) {
    /**
     * Whether this field must be filled at the given strictness. The schema stores the
     * threshold rather than a boolean so one procedure runs at every level unchanged.
     */
    fun requiredAt(strictness: Int): Boolean = strictness >= requiredAtStrictness

    /**
     * The class this field can reach if it is satisfied as declared. A property of the RULE,
     * not of anybody's confidence — that is what keeps the categories from blurring under
     * pressure (architecture.md §1).
     */
    val declaredClass: ProvenanceClass
        get() = when (acceptanceRule) {
            AcceptanceRule.WITHIN, AcceptanceRule.MATCHES -> ProvenanceClass.MEASURED
            AcceptanceRule.PER_SPEC -> ProvenanceClass.SPECIFIED
            AcceptanceRule.MUST_SHOW, AcceptanceRule.CONSISTENT_WITH -> ProvenanceClass.INFERRED
            AcceptanceRule.SIGNED_BY -> ProvenanceClass.ASSERTED
        }
}

/**
 * A [FieldDef] once it has been filled. Flat with a discriminator: [kind] decides which value
 * slot is meaningful, the rest are null.
 */
@Serializable
data class Field(
    val id: String,
    @SerialName("step_id") val stepId: String,
    val key: String,
    val kind: FieldKind,
    @SerialName("value_number") val valueNumber: Double? = null,
    @SerialName("value_text") val valueText: String? = null,
    @SerialName("value_choice") val valueChoice: String? = null,
    val unit: String? = null,
    @SerialName("media_ref") val mediaRef: String? = null,
    /**
     * Set only when the value arrived from a paired instrument. Its presence is what makes
     * the class measured — not the number, not the unit, and never the person typing.
     */
    @SerialName("tool_id") val toolId: String? = null,
    @SerialName("captured_at") val capturedAt: String? = null,
    /** Stamped by the Seal. Never asserted by a model. Null until sealed. */
    @SerialName("provenance_class") val provenanceClass: ProvenanceClass? = null,
    @SerialName("resolved_from_order") val resolvedFromOrder: ResolvedFrom? = null,
    @SerialName("resolved_from_cite") val resolvedFromCite: String? = null,
    /** Evidence attaches to the component, not the position, so it survives the part moving machines. */
    @SerialName("component_ref") val componentRef: String? = null,
) {
    /** True once this field carries whatever its kind needs to count as filled. */
    val isFilled: Boolean
        get() = when (kind) {
            FieldKind.MEASUREMENT -> valueNumber != null
            FieldKind.PHOTO, FieldKind.VIDEO -> mediaRef != null
            FieldKind.SCAN, FieldKind.TEXT, FieldKind.SIGNATURE, FieldKind.LOCATION -> !valueText.isNullOrBlank()
            FieldKind.CHOICE -> !valueChoice.isNullOrBlank()
        }
}

/** One card in a procedure. Always has two exits: capture, or state why not. */
@Serializable
data class Step(
    val id: String,
    val index: Int,
    val title: String,
    /** Show only if. Null means always. */
    val condition: String? = null,
    /** WHY this step exists and what goes wrong without it. Authored by the Scoper. */
    val explanation: String,
    /**
     * Hard cap on Inspector ADD FIELD. On exhaustion the step escalates with the unresolved
     * question — never silently, never another request (architecture.md §3).
     */
    @SerialName("max_add_fields") val maxAddFields: Int,
    val fields: List<FieldDef>,
)

/** Compiled from a Scoper conversation. Versioned; a sealed record names the version it ran. */
@Serializable
data class Procedure(
    val id: String,
    @SerialName("tenant_id") val tenantId: String,
    /** Stable across versions. e.g. front-brake-service. */
    val key: String,
    val title: String,
    val version: Int,
    /** 0 log, 1 standard, 2 assured, 3 regulated. */
    val strictness: Int,
    /** A surface below this is refused before the job starts, never downgraded. */
    @SerialName("minimum_tier") val minimumTier: Tier,
    val disqualifiers: List<String> = emptyList(),
    val releases: List<String> = emptyList(),
    val steps: List<Step>,
    @SerialName("created_at") val createdAt: String,
)

/**
 * One per step, ALWAYS written, never absent. A step can be satisfied or explained; it can
 * never be silently abandoned.
 */
@Serializable
data class StepOutcome(
    val id: String,
    @SerialName("job_id") val jobId: String,
    @SerialName("step_id") val stepId: String,
    val status: StepStatus,
    @SerialName("reason_kind") val reasonKind: ReasonKind? = null,
    /** What the technician said, in their words. */
    @SerialName("reason_transcript") val reasonTranscript: String? = null,
    @SerialName("reason_audio_ref") val reasonAudioRef: String? = null,
    @SerialName("reason_by") val reasonBy: String? = null,
    @SerialName("reason_at") val reasonAt: String? = null,
    /** The Instructor's next action for the person standing there now. */
    @SerialName("recommendation_text") val recommendationText: String? = null,
    @SerialName("recommendation_model") val recommendationModel: String? = null,
    @SerialName("disposition_action") val dispositionAction: DispositionAction? = null,
    @SerialName("disposition_at") val dispositionAt: String? = null,
    /** Required when status is waived. A named person with the standing to waive. */
    @SerialName("waived_by") val waivedBy: String? = null,
    /** A stated reason is always asserted — a named human said it, at this time. */
    @SerialName("provenance_class") val provenanceClass: ProvenanceClass? = null,
    val fields: List<Field>,
)

/** One run of one procedure version against one asset. */
@Serializable
data class Job(
    val id: String,
    @SerialName("tenant_id") val tenantId: String,
    @SerialName("procedure_id") val procedureId: String,
    /** The version that ran, not the current one. */
    @SerialName("procedure_version") val procedureVersion: Int,
    @SerialName("asset_urn") val assetUrn: String? = null,
    @SerialName("technician_id") val technicianId: String? = null,
    val status: JobStatus,
    val strictness: Int,
    val tier: Tier,
    @SerialName("started_at") val startedAt: String,
    @SerialName("sealed_at") val sealedAt: String? = null,
    val steps: List<StepOutcome>,
)

/**
 * A piece of media. [captureSurface] is what decides the tier ceiling, so it is recorded here
 * and nowhere else.
 */
@Serializable
data class Capture(
    val id: String,
    @SerialName("field_id") val fieldId: String,
    val kind: CaptureKind,
    @SerialName("media_ref") val mediaRef: String,
    @SerialName("capture_mode") val captureMode: CaptureMode,
    @SerialName("capture_surface") val captureSurface: CaptureSurface,
    @SerialName("attestation_device_id") val attestationDeviceId: String? = null,
    @SerialName("attestation_play_integrity") val attestationPlayIntegrity: String? = null,
    /**
     * On-device ML Kit face and plate redaction has run. A record is not readable until this
     * is true.
     */
    val redacted: Boolean,
    /** Model Armor pi_and_jailbreak on the image. */
    @SerialName("armor_verdict") val armorVerdict: String? = null,
    @SerialName("created_at") val createdAt: String,
)

/**
 * A number from a paired instrument. Never embedded, never consolidated, never in Memory Bank
 * — these are queried exactly and ordered by time, and they are what makes wear rate
 * computable (architecture.md §1).
 */
@Serializable
data class Reading(
    val id: String,
    @SerialName("field_id") val fieldId: String? = null,
    @SerialName("component_id") val componentId: String? = null,
    val key: String,
    val value: Double,
    val unit: String,
    /** Device identity. Without this the value is typed, not measured. */
    @SerialName("tool_id") val toolId: String,
    val at: String,
)

/** One agent doing one thing. The row AgentTrace renders and the line the public log carries. */
@Serializable
data class Decision(
    val id: String,
    @SerialName("job_id") val jobId: String,
    @SerialName("step_id") val stepId: String? = null,
    val agent: Agent,
    /** From Agent Registry. The sealed record stamps WHICH agent version decided. */
    @SerialName("agent_version") val agentVersion: String,
    /** Null for deterministic core decisions. */
    val model: String? = null,
    val verdict: String,
    val rationale: String,
    /** Estimated from token counts. The Ledger meters against a hard ceiling. */
    @SerialName("cost_usd") val costUsd: Double? = null,
    val at: String,
)

@Serializable
data class CeilingUnreachable(
    @SerialName("class") val cls: ProvenanceClass,
    val reason: String,
)

@Serializable
data class Deficiency(
    @SerialName("step_id") val stepId: String,
    val status: StepStatus,
    val reason: String,
)

/** Written once by the Seal, never updated. What a stranger checks. */
@Serializable
data class SealedRecord(
    /** Opaque and unguessable. It is a public URL. */
    val id: String,
    @SerialName("job_id") val jobId: String,
    @SerialName("tenant_id") val tenantId: String,
    /** True only for anon and demo tenants. */
    val public: Boolean,
    @SerialName("sealed_at") val sealedAt: String,
    @SerialName("ceiling_tier") val ceilingTier: Tier,
    @SerialName("ceiling_reachable") val ceilingReachable: List<ProvenanceClass>,
    /** Each with the one-line reason it is out of reach at this tier. This is the honest CTA. */
    @SerialName("ceiling_unreachable") val ceilingUnreachable: List<CeilingUnreachable>,
    val deficiencies: List<Deficiency>,
    /** The Gate's answer. Deterministic, from deficiencies and strictness. */
    @SerialName("machine_released") val machineReleased: Boolean,
    val steps: List<StepOutcome>,
    val decisions: List<Decision>,
)
