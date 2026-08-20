package ink.warrant.data

import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import ink.warrant.contract.Procedure
import ink.warrant.contract.Step
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier

/**
 * The seeded procedures, ported from `web/src/data/fixtures/procedures.ts`.
 *
 * Kept identical to the web fixtures on purpose: a judge who runs the browser task and then
 * installs the app sees the same three procedures, and the ONLY difference between them is
 * what each surface can actually prove. That comparison is the pitch, so the fixtures must
 * not drift apart.
 */

/** The public, Open-tier task. Nothing to buy, nothing to install, no location, no timer. */
val cutABanana = Procedure(
    id = "proc_banana_v1",
    tenantId = "anon",
    key = "cut-a-banana",
    title = "Cut a banana",
    version = 1,
    strictness = 1,
    minimumTier = Tier.OPEN,
    disqualifiers = listOf("no banana visible in the opening capture"),
    releases = listOf("nothing — this is a demonstration procedure"),
    createdAt = "2026-08-18T09:00:00Z",
    steps = listOf(
        Step(
            id = "s1", index = 1, title = "Show the banana", condition = null,
            explanation = "Every record needs a starting state. Without one, a photograph of " +
                "slices proves somebody cut something, not that they cut this.",
            maxAddFields = 2,
            fields = listOf(
                FieldDef(
                    key = "banana_before", kind = FieldKind.PHOTO,
                    prompt = "Photograph the whole, unpeeled banana",
                    source = FieldSource.CAMERA, requiredAtStrictness = 0,
                    acceptanceRule = AcceptanceRule.MUST_SHOW,
                    acceptanceDescription = "a single unpeeled banana, whole",
                    guidance = "The whole banana in frame, reasonably lit. A hand holding it is fine.",
                ),
            ),
        ),
        Step(
            id = "s2", index = 2, title = "Cut it", condition = null,
            explanation = "This is the work. A model reads the photograph, so what it can " +
                "conclude is inferred — it can see slices, it cannot measure them.",
            maxAddFields = 2,
            fields = listOf(
                FieldDef(
                    key = "slices", kind = FieldKind.PHOTO,
                    prompt = "Photograph the slices",
                    source = FieldSource.CAMERA, requiredAtStrictness = 0,
                    acceptanceRule = AcceptanceRule.MUST_SHOW,
                    acceptanceDescription = "banana cut into separate slices, cuts running all the way through",
                    guidance = "Slices separated so the cuts are visible. Roughly even is enough " +
                        "— nobody is grading your knife work.",
                ),
            ),
        ),
        Step(
            id = "s3", index = 3, title = "Put the knife away", condition = null,
            explanation = "Nobody can verify this from a photograph, and pretending otherwise " +
                "would be the exact failure this system exists to prevent. So it is asserted: " +
                "you say it, by name, and the record says you said it.",
            maxAddFields = 0,
            fields = listOf(
                FieldDef(
                    key = "knife_stored", kind = FieldKind.SIGNATURE,
                    prompt = "Confirm the knife is stored safely",
                    source = FieldSource.HUMAN, requiredAtStrictness = 0,
                    acceptanceRule = AcceptanceRule.SIGNED_BY,
                    acceptanceTarget = "whoever performed the job",
                    guidance = "Type a name. It goes on the record as an assertion, attributed " +
                        "to you — not as something the system checked.",
                ),
            ),
        ),
    ),
)

/**
 * The floor. Two photographs, no props, no assertion — the shortest path there is from
 * nothing to a sealed record, so a judge with an empty desk can still run one end to end.
 *
 * It is also the only fixture that uses `consistent_with`. Photograph a mug, then photograph
 * a mug in your hand, and neither frame on its own says you lifted THAT mug. The second
 * capture is judged against the first rather than against a description, which is precisely
 * the check the Skeptic exists to make.
 */
val pickUpAnObject = Procedure(
    id = "proc_pickup_v1",
    tenantId = "anon",
    key = "pick-up-an-object",
    title = "Pick up an object",
    version = 1,
    strictness = 1,
    minimumTier = Tier.OPEN,
    disqualifiers = listOf(
        "no object visible in the opening capture",
        "the object in the second capture is not the one in the first",
    ),
    releases = listOf("nothing — this is a demonstration procedure"),
    createdAt = "2026-08-19T09:00:00Z",
    steps = listOf(
        Step(
            id = "p1", index = 1, title = "Show it where it lies", condition = null,
            explanation = "The claim is that one object moved, so the record needs where it " +
                "started — and that means a place, not just a thing. A photograph of " +
                "something already in a hand cannot establish it.",
            maxAddFields = 2,
            fields = listOf(
                FieldDef(
                    key = "object_before", kind = FieldKind.PHOTO,
                    prompt = "Photograph the object where it is sitting",
                    source = FieldSource.CAMERA, requiredAtStrictness = 0,
                    acceptanceRule = AcceptanceRule.MUST_SHOW,
                    acceptanceDescription = "a single object resting on a surface, nobody holding it",
                    guidance = "Anything within reach will do. Stand back far enough that the " +
                        "surface under it is in frame too.",
                ),
            ),
        ),
        Step(
            id = "p2", index = 2, title = "Pick it up", condition = null,
            explanation = "Nothing in this frame is judged on its own. It is judged against " +
                "the opening capture — same object or the step fails — which is what makes " +
                "two ordinary photographs into evidence of a lift rather than evidence of " +
                "two objects.",
            maxAddFields = 2,
            fields = listOf(
                FieldDef(
                    key = "object_held", kind = FieldKind.PHOTO,
                    prompt = "Photograph it held clear of the surface",
                    source = FieldSource.CAMERA, requiredAtStrictness = 0,
                    acceptanceRule = AcceptanceRule.CONSISTENT_WITH,
                    acceptanceTarget = "p1.object_before",
                    guidance = "Lift it, hold it still, shoot. Same room and same light help " +
                        "— the check is continuity, not composition.",
                ),
            ),
        ),
    ),
)

/** The real one. Instrumented tier: it cannot run in a browser, and it says so. */
val frontBrakeService = Procedure(
    id = "proc_front_brake_v3",
    tenantId = "demo.warrant.ink",
    key = "front-brake-service",
    title = "Front brake service",
    version = 3,
    strictness = 2,
    minimumTier = Tier.INSTRUMENTED,
    disqualifiers = listOf("step elapsed under 12 min", "part number mismatch"),
    releases = listOf("return to service", "consume 1x pad set", "reorder below 2"),
    createdAt = "2026-08-14T11:20:00Z",
    steps = listOf(
        Step(
            id = "b1", index = 1, title = "Remove the wheel", condition = null,
            explanation = "Establishes the machine is the one on the work order and the caliper " +
                "is actually accessible.",
            maxAddFields = 3,
            fields = listOf(
                FieldDef(
                    key = "wheel_off", kind = FieldKind.PHOTO,
                    prompt = "Photograph the wheel off, caliper visible",
                    source = FieldSource.CAMERA, requiredAtStrictness = 0,
                    acceptanceRule = AcceptanceRule.MUST_SHOW,
                    acceptanceDescription = "wheel removed, caliper in frame",
                    guidance = "Caliper and disc both in frame. Registration plate out of shot.",
                ),
            ),
        ),
        Step(
            id = "b2", index = 2, title = "Present the new part", condition = null,
            explanation = "The commonest quiet failure is the right job done with the wrong " +
                "part. This resolves against the work order, so it is measured — an equality, " +
                "not an opinion.",
            maxAddFields = 3,
            fields = listOf(
                FieldDef(
                    key = "part_number", kind = FieldKind.SCAN,
                    prompt = "Scan or photograph the part label",
                    source = FieldSource.CAMERA, requiredAtStrictness = 1,
                    acceptanceRule = AcceptanceRule.MATCHES,
                    acceptanceTarget = "work_order.part_number",
                    guidance = "Label legible and square to the lens. If it is worn, photograph " +
                        "the box instead.",
                ),
            ),
        ),
        Step(
            id = "b3", index = 3, title = "Fit and torque", condition = null,
            explanation = "The only step here a photograph cannot answer. A tool reports the " +
                "number, so nothing about this value passed through a human — which is the " +
                "entire difference between watching work and measuring it.",
            maxAddFields = 2,
            fields = listOf(
                FieldDef(
                    key = "pad_torque", kind = FieldKind.MEASUREMENT,
                    prompt = "Torque the caliper bolts",
                    source = FieldSource.INSTRUMENT, requiredAtStrictness = 1,
                    acceptanceRule = AcceptanceRule.WITHIN,
                    acceptanceMin = 26.0, acceptanceMax = 30.0, acceptanceUnit = "Nm",
                    guidance = "26-30 Nm, cited from the manufacturer's figure. The reading " +
                        "arrives from the wrench; there is nothing to type.",
                ),
            ),
        ),
        Step(
            id = "b4", index = 4, title = "Function check", condition = null,
            explanation = "Catches the failure that only appears once everything is back together.",
            maxAddFields = 2,
            fields = listOf(
                FieldDef(
                    key = "lever_travel", kind = FieldKind.VIDEO,
                    prompt = "Film lever travel and return",
                    source = FieldSource.CAMERA, requiredAtStrictness = 1,
                    acceptanceRule = AcceptanceRule.MUST_SHOW,
                    acceptanceDescription = "lever pulled and released, returning fully",
                    guidance = "Three or four seconds. Pull, hold, release.",
                ),
            ),
        ),
    ),
)

val procedures: List<Procedure> = listOf(cutABanana, pickUpAnObject, frontBrakeService)

// ----------------------------------------------------------------- the timeline

/**
 * The demo timeline. THIS is what makes [FixtureSource] honest.
 *
 * Beats are indexed by step, then by capture ATTEMPT — so attempt 0 on the slices asks for a
 * better photograph and attempt 1 passes, which is the ADD FIELD behaviour the real Inspector
 * has. Edit the numbers here to retune the demo; nothing else changes.
 */
sealed interface DemoBeat {
    /** Milliseconds after the capture that triggered this run. */
    val at: Long

    data class Decide(
        override val at: Long,
        val agent: ink.warrant.contract.Agent,
        val verdict: String,
        val rationale: String,
        val model: String? = null,
        val cost: Double = 0.0,
    ) : DemoBeat

    data class AddField(override val at: Long, val field: FieldDef) : DemoBeat

    data class Status(override val at: Long, val status: StepStatus) : DemoBeat

    data class Escalate(override val at: Long, val question: String) : DemoBeat
}

private fun gemma(verdict: String, rationale: String, at: Long) = DemoBeat.Decide(
    at = at, agent = ink.warrant.contract.Agent.INSPECTOR, verdict = verdict,
    rationale = rationale, model = "gemma-3-4b", cost = 0.00002,
)

private fun flash(verdict: String, rationale: String, at: Long) = DemoBeat.Decide(
    at = at, agent = ink.warrant.contract.Agent.INSPECTOR, verdict = verdict,
    rationale = rationale, model = "gemini-3.5-flash", cost = 0.00081,
)

private fun skeptic(verdict: String, rationale: String, at: Long) = DemoBeat.Decide(
    at = at, agent = ink.warrant.contract.Agent.SKEPTIC, verdict = verdict,
    rationale = rationale, model = "multimodalembedding", cost = 0.00011,
)

/** The field the Inspector appends when the first slices photograph is not good enough. */
private val reframe = FieldDef(
    key = "slices_reframed",
    kind = FieldKind.PHOTO,
    prompt = "Photograph the slices again — get them all in frame",
    source = FieldSource.CAMERA,
    requiredAtStrictness = 0,
    acceptanceRule = AcceptanceRule.MUST_SHOW,
    acceptanceDescription = "all slices visible, cuts running all the way through",
    guidance = "Step back a little. The point is that every cut is visible, not that the photo " +
        "is pretty.",
)

/** procedureId -> stepId -> attempt index -> beats */
val scripts: Map<String, Map<String, List<List<DemoBeat>>>> = mapOf(
    "proc_banana_v1" to mapOf(
        "s1" to listOf(
            listOf(
                gemma("PASS", "One unpeeled banana, whole and in frame.", 700),
                DemoBeat.Status(1500, StepStatus.PERFORMED),
            ),
        ),
        // The interesting one: the first capture is not good enough, and the form GROWS a
        // field the procedure did not contain when the job started.
        "s2" to listOf(
            listOf(
                gemma(
                    "ESCALATE",
                    "Slices partly out of frame; cannot confirm the cuts run through. Deferring to Flash.",
                    800,
                ),
                flash(
                    "ADD_FIELD",
                    "Two slices are cropped at the edge of the frame. Asking for a wider capture.",
                    2600,
                ),
                DemoBeat.AddField(2700, reframe),
            ),
            listOf(
                gemma("PASS", "All slices visible, cuts running fully through.", 900),
                DemoBeat.Status(1900, StepStatus.PERFORMED),
            ),
        ),
        "s3" to listOf(
            listOf(
                DemoBeat.Decide(
                    at = 500, agent = ink.warrant.contract.Agent.INSPECTOR, verdict = "PASS",
                    rationale = "Signed by name. Recorded as asserted — nothing was checked.",
                    model = null, cost = 0.0,
                ),
                DemoBeat.Status(1100, StepStatus.PERFORMED),
            ),
        ),
    ),
    // No escalation, no added field, no signature. Two captures and it is sealed — the banana
    // carries the drama, this one carries the floor.
    "proc_pickup_v1" to mapOf(
        "p1" to listOf(
            listOf(
                gemma("PASS", "One object at rest on a surface, no hand on it.", 600),
                DemoBeat.Status(1400, StepStatus.PERFORMED),
            ),
        ),
        // The Inspector can only say something is being held. Whether it is the SAME something
        // is a different question, and a different agent answers it.
        "p2" to listOf(
            listOf(
                gemma("PASS", "Object clear of the surface and held.", 800),
                skeptic(
                    "BELONGS",
                    "Same object as the opening capture — its markings and the surface behind " +
                        "it both carry over.",
                    1600,
                ),
                DemoBeat.Status(2200, StepStatus.PERFORMED),
            ),
        ),
    ),
    "proc_front_brake_v3" to mapOf(
        "b1" to listOf(
            listOf(
                gemma("PASS", "Wheel removed, caliper and disc both visible.", 900),
                DemoBeat.Status(1800, StepStatus.PERFORMED),
            ),
        ),
        "b2" to listOf(
            listOf(
                flash(
                    "PASS",
                    "Label reads 45022-KA; work order expects 45022-KA. Equality, not judgement — measured.",
                    1400,
                ),
                skeptic("BELONGS", "Label wear and background match this job's prior captures.", 2100),
                DemoBeat.Status(2600, StepStatus.PERFORMED),
            ),
        ),
        // No model is asked here at all. 28.4 Nm inside 26-30 is arithmetic, and the record
        // says so — this is the step that makes the measured class legible.
        "b3" to listOf(
            listOf(
                DemoBeat.Decide(
                    at = 400, agent = ink.warrant.contract.Agent.INSPECTOR, verdict = "PASS",
                    rationale = "Reading from a paired tool, inside 26-30 Nm. No model was " +
                        "asked — this is arithmetic.",
                    model = null, cost = 0.0,
                ),
                DemoBeat.Status(900, StepStatus.PERFORMED),
            ),
        ),
        "b4" to listOf(
            listOf(
                flash("PASS", "Lever pulled and fully returned across four seconds.", 1600),
                DemoBeat.Status(2400, StepStatus.PERFORMED),
            ),
        ),
    ),
)
