package ink.warrant.ui.job

import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.Agent
import ink.warrant.contract.Decision
import ink.warrant.contract.Field
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import ink.warrant.contract.Job
import ink.warrant.contract.JobStatus
import ink.warrant.contract.Procedure
import ink.warrant.contract.ProvenanceClass
import ink.warrant.contract.Step
import ink.warrant.contract.StepOutcome
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier
import ink.warrant.data.AttentionKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which verdict belongs under which photograph.
 *
 * The TypeScript twin is `scripts/handover.test.mjs`, and this is the same suite written twice
 * for the same reason `StepActionTest` is. The handover now prints the fleet's decisions
 * directly beneath the capture they were about, and a frame carrying the wrong step's verdicts
 * shows a technician a rejection of one photograph underneath a different one — which reads as
 * the fleet being wrong about something it never looked at, and which no screenshot review
 * would catch, because the page looks perfectly correct either way.
 */
class HandoverFramesTest {

    private fun step(id: String, index: Int, requiredAt: Int = 0) = Step(
        id = id,
        index = index,
        title = "Step $index",
        explanation = "why",
        maxAddFields = 2,
        requiredAtStrictness = requiredAt,
        fields = listOf(
            FieldDef(
                key = "photo",
                kind = FieldKind.PHOTO,
                prompt = "Photograph it",
                source = FieldSource.CAMERA,
                requiredAtStrictness = 0,
                acceptanceRule = AcceptanceRule.MUST_SHOW,
                guidance = "What good looks like",
            ),
        ),
    )

    private fun procedure(vararg steps: Step) = Procedure(
        id = "proc_x",
        tenantId = "anon",
        key = "x",
        title = "X",
        version = 1,
        strictness = 1,
        minimumTier = Tier.OPEN,
        steps = steps.toList(),
        createdAt = "2026-08-27T00:00:00Z",
    )

    private fun field(
        key: String,
        kind: FieldKind = FieldKind.PHOTO,
        mediaRef: String? = "cap_$key",
        valueText: String? = null,
        valueNumber: Double? = null,
        unit: String? = null,
        provenance: ProvenanceClass? = null,
    ) = Field(
        id = "fld_$key",
        stepId = "s1",
        key = key,
        kind = kind,
        mediaRef = mediaRef,
        valueText = valueText,
        valueNumber = valueNumber,
        unit = unit,
        provenanceClass = provenance,
    )

    private fun outcome(
        stepId: String,
        status: StepStatus = StepStatus.PENDING,
        fields: List<Field> = emptyList(),
        addedFields: List<FieldDef> = emptyList(),
        reason: String? = null,
    ) = StepOutcome(
        id = "out_$stepId",
        jobId = "job_one",
        stepId = stepId,
        status = status,
        fields = fields,
        addedFields = addedFields,
        reasonTranscript = reason,
    )

    private fun job(vararg outcomes: StepOutcome) = Job(
        id = "job_one",
        tenantId = "anon",
        procedureId = "proc_x",
        procedureVersion = 1,
        status = JobStatus.OPEN,
        strictness = 1,
        tier = Tier.OPEN,
        startedAt = "2026-08-27T00:00:00Z",
        steps = outcomes.toList(),
    )

    private fun decision(stepId: String?, verdict: String = "PASS") = Decision(
        id = "dec_${stepId}_$verdict",
        jobId = "job_one",
        stepId = stepId,
        agent = Agent.INSPECTOR,
        agentVersion = "1",
        verdict = verdict,
        rationale = "looks right",
        at = "2026-08-27T00:01:00Z",
    )

    @Test
    fun `one frame per capture, in the order the work happened`() {
        val frames = handoverFrames(
            job(
                outcome("s1", StepStatus.PERFORMED, listOf(field("photo"))),
                outcome("s2", StepStatus.PERFORMED, listOf(field("photo"), field("photo_again"))),
            ),
            procedure(step("s1", 1), step("s2", 2)),
            emptyList(),
        )
        assertEquals(listOf("s1:photo", "s2:photo", "s2:photo_again"), frames.map { it.id })
        assertEquals(
            listOf("cap_photo", "cap_photo", "cap_photo_again"),
            frames.map { it.captureId },
        )
    }

    @Test
    fun `a step that produced nothing is still a page, carrying its reason`() {
        // The positive control for the placeholder branch: a job where step 2 was explained
        // must not look, on the last screen anybody reads, like a job with one step.
        val frames = handoverFrames(
            job(
                outcome("s1", StepStatus.PERFORMED, listOf(field("photo"))),
                outcome("s2", StepStatus.DEFERRED, reason = "the tool is in the other van"),
            ),
            procedure(step("s1", 1), step("s2", 2)),
            emptyList(),
        )
        assertEquals(2, frames.size)
        assertNull(frames[1].captureId)
        assertNull(frames[1].answered)
        assertEquals("the tool is in the other van", frames[1].reason)
        assertEquals(StepStatus.DEFERRED, frames[1].status)
    }

    @Test
    fun `a verdict lands on the step it was about and on no other`() {
        val frames = handoverFrames(
            job(
                outcome("s1", StepStatus.PERFORMED, listOf(field("photo"))),
                outcome("s2", StepStatus.PERFORMED, listOf(field("photo"))),
            ),
            procedure(step("s1", 1), step("s2", 2)),
            listOf(decision("s1", "PASS"), decision("s2", "ADD_FIELD")),
        )
        assertEquals(listOf("PASS"), frames[0].decisions.map { it.verdict })
        assertEquals(listOf("ADD_FIELD"), frames[1].decisions.map { it.verdict })
    }

    @Test
    fun `a job-level decision is attached to no photograph at all`() {
        // The Foreman's disposition arrives with a null step id. Hanging it on the first frame
        // would print a ruling about the whole job under one capture as though it were about
        // that one.
        val frames = handoverFrames(
            job(outcome("s1", StepStatus.PERFORMED, listOf(field("photo")))),
            procedure(step("s1", 1)),
            listOf(decision(null, "DEFER")),
        )
        assertTrue(frames[0].decisions.isEmpty())
    }

    @Test
    fun `both captures of one step carry that step's verdicts`() {
        // Decisions are scoped to a step and nothing finer, so the two frames of a grown step
        // share them. Splitting them by guessing from the rationale text would be worse.
        val frames = handoverFrames(
            job(outcome("s1", StepStatus.PERFORMED, listOf(field("photo"), field("photo_wide")))),
            procedure(step("s1", 1)),
            listOf(decision("s1", "ESCALATE"), decision("s1", "PASS")),
        )
        assertEquals(2, frames.size)
        assertEquals(2, frames[0].decisions.size)
        assertEquals(2, frames[1].decisions.size)
    }

    @Test
    fun `what an agent is still asking for rides on the frame it is about`() {
        val added = FieldDef(
            key = "photo_again",
            kind = FieldKind.PHOTO,
            prompt = "Again, wider",
            source = FieldSource.CAMERA,
            requiredAtStrictness = 0,
            acceptanceRule = AcceptanceRule.MUST_SHOW,
            guidance = "step back",
        )
        val frames = handoverFrames(
            job(
                outcome("s1", StepStatus.PERFORMED, listOf(field("photo"))),
                outcome("s2", StepStatus.PENDING, listOf(field("photo")), addedFields = listOf(added)),
            ),
            procedure(step("s1", 1), step("s2", 2)),
            emptyList(),
        )
        assertTrue(frames[0].issues.isEmpty())
        assertEquals(1, frames[1].issues.size)
        assertEquals(AttentionKind.EVIDENCE, frames[1].issues[0].kind)
    }

    @Test
    fun `a signature is a frame with a value and nothing to fetch`() {
        // Its media_ref would be a NAME. Handing that to storage builds a path out of a person.
        val frames = handoverFrames(
            job(outcome("s1", StepStatus.PERFORMED, listOf(
                field("who", kind = FieldKind.SIGNATURE, mediaRef = "Ada", valueText = "Ada"),
            ))),
            procedure(step("s1", 1)),
            emptyList(),
        )
        assertNull(frames[0].captureId)
        assertEquals("Ada", frames[0].value)
    }

    @Test
    fun `a measurement reads as its number and its unit, without a trailing zero`() {
        val frames = handoverFrames(
            job(outcome("s1", StepStatus.PERFORMED, listOf(
                field("torque", kind = FieldKind.MEASUREMENT, mediaRef = null, valueNumber = 7.0, unit = "Nm"),
            ))),
            procedure(step("s1", 1)),
            emptyList(),
        )
        // `7.0 Nm` reads as a rounding; `7 Nm` reads as a value.
        assertEquals("7 Nm", frames[0].value)
    }

    @Test
    fun `provenance is rendered, never guessed — absent until the Seal stamps it`() {
        val p = procedure(step("s1", 1))
        assertNull(
            handoverFrames(job(outcome("s1", StepStatus.PERFORMED, listOf(field("photo")))), p, emptyList())[0]
                .provenance,
        )
        assertEquals(
            ProvenanceClass.INFERRED,
            handoverFrames(
                job(outcome("s1", StepStatus.PERFORMED, listOf(field("photo", provenance = ProvenanceClass.INFERRED)))),
                p,
                emptyList(),
            )[0].provenance,
        )
    }

    @Test
    fun `a step with any outcome counts as ruled, not only one that passed`() {
        // A progress line that counted passes alone would stall for ever on a job that is going
        // to seal deficient — which is precisely the job somebody watches this line on.
        val p = verificationProgress(
            job(outcome("s1", StepStatus.PERFORMED), outcome("s2", StepStatus.DEFERRED)),
            procedure(step("s1", 1), step("s2", 2)),
        )
        assertEquals(Progress(ruled = 2, total = 2), p)
        assertTrue(p.settled)
    }

    @Test
    fun `a pending step is not ruled on`() {
        val p = verificationProgress(
            job(outcome("s1", StepStatus.PERFORMED), outcome("s2")),
            procedure(step("s1", 1), step("s2", 2)),
        )
        assertEquals(Progress(ruled = 1, total = 2), p)
        assertTrue(!p.settled)
    }

    @Test
    fun `an optional step is not counted, for the reason it cannot hold the seal`() {
        val p = verificationProgress(
            job(outcome("s1", StepStatus.PERFORMED), outcome("s2")),
            procedure(step("s1", 1), step("s2", 2, requiredAt = 4)),
        )
        assertEquals(Progress(ruled = 1, total = 1), p)
    }
}
