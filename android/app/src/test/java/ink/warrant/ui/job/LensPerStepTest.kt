package ink.warrant.ui.job

import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import ink.warrant.contract.Job
import ink.warrant.contract.JobStatus
import ink.warrant.contract.Procedure
import ink.warrant.contract.Step
import ink.warrant.contract.StepOutcome
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier
import ink.warrant.ui.components.Lens
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which way the camera points is remembered per step, and forgotten per job.
 *
 * The twin of `FlashPerStepTest` next door, and the same two quiet failures. One step's subject
 * is the machine in front of you and another's is your own face — `proc_smile_v1` is two of the
 * second kind and `proc_front_brake_v3` is four of the first — so a choice that bleeds sideways
 * silently points the lens at the wrong thing on a step the technician never touched. And a
 * choice that outlives its job would open the next run of an unrelated procedure looking at
 * somebody's face with nothing on screen explaining why.
 *
 * Checkable here because the whole transition is [JobViewModel.UiState.withLensFlipped], plain
 * Kotlin with no view model, no dispatcher and no device.
 */
class LensPerStepTest {

    private fun step(id: String, index: Int) = Step(
        id = id,
        index = index,
        title = "Step $index",
        explanation = "why",
        maxAddFields = 1,
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

    private val procedure = Procedure(
        id = "proc_smile",
        tenantId = "anon",
        key = "smile",
        title = "Smile",
        version = 1,
        strictness = 0,
        minimumTier = Tier.OPEN,
        steps = listOf(step("m1", 1), step("m2", 2)),
        createdAt = "2026-08-27T00:00:00Z",
    )

    private fun job(id: String) = Job(
        id = id,
        tenantId = "anon",
        procedureId = procedure.id,
        procedureVersion = 1,
        status = JobStatus.OPEN,
        strictness = 0,
        tier = Tier.OPEN,
        startedAt = "2026-08-27T00:00:00Z",
        steps = procedure.steps.map {
            StepOutcome(
                id = "out_${it.id}",
                jobId = id,
                stepId = it.id,
                status = StepStatus.PENDING,
                fields = emptyList(),
            )
        },
    )

    @Test
    fun `a step nobody has touched points at the work`() {
        val state = JobViewModel.UiState()
        assertEquals(Lens.Back, Lens.Default)
        assertEquals(Lens.Back, state.lensFor("m1"))
        assertEquals(Lens.Back, state.lensFor("a step that does not exist"))
    }

    @Test
    fun `a tap turns the camera around, and another turns it back`() {
        assertEquals(Lens.Front, Lens.Back.next())
        assertEquals(Lens.Back, Lens.Front.next())
        Lens.entries.forEach { start -> assertEquals(start, start.next().next()) }
    }

    @Test
    fun `the chip names the lens you are on, not the one a tap would get`() {
        // A button labelled with its destination and a chip labelled with its state look
        // identical and mean opposite things. This is the one that is a statement.
        assertEquals("Back camera", Lens.Back.label)
        assertEquals("Front camera", Lens.Front.label)
    }

    @Test
    fun `flipping one step does not reach across to another`() {
        val state = JobViewModel.UiState().withLensFlipped("m1")

        assertEquals(Lens.Front, state.lensFor("m1"))
        assertEquals("m2 was never touched", Lens.Back, state.lensFor("m2"))
    }

    @Test
    fun `the choice survives walking away from the step and back`() {
        // Stepping is an index move on the same state, so what this really pins is that the
        // lens is keyed by step id and not by "the step in hand".
        val state = JobViewModel.UiState(procedure = procedure, job = job("job_one"))
            .withLensFlipped("m1")
            .copy(stepIndex = 1)
            .withLensFlipped("m2")
            .copy(stepIndex = 0)

        assertEquals(Lens.Front, state.lensFor("m1"))
        assertEquals(Lens.Front, state.lensFor("m2"))
    }

    @Test
    fun `the lens does not survive into the next job`() {
        val dirty = JobViewModel.UiState(procedure = procedure, job = job("job_one"))
            .withLensFlipped("m1")
        assertEquals(Lens.Front, dirty.lensFor("m1"))

        val next = newJobState(procedure, job("job_two"), fabricated = true)

        assertTrue("a lens belongs to the job that chose it", next.lens.isEmpty())
        assertEquals(Lens.Back, next.lensFor("m1"))
    }
}
