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
import ink.warrant.ui.components.FlashMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The lamp is remembered per step, and forgotten per job.
 *
 * Two separate promises, and both are the kind that fail quietly. One step's lighting is not
 * another's — a shot up inside a wheel arch needs the lamp and the one of the bay floor two
 * steps later does not — so a choice that bleeds sideways silently changes evidence the
 * technician never chose to change. And a choice that outlives its job would arrive on the
 * next run of an unrelated procedure with nothing on screen explaining why the lamp is on.
 *
 * Both are checkable here because the whole transition is [JobViewModel.UiState.withFlashCycled],
 * plain Kotlin with no view model, no dispatcher and no device — the same reason `JobStartTest`
 * can test the reset.
 */
class FlashPerStepTest {

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
        id = "proc_brakes",
        tenantId = "anon",
        key = "front-brake-service",
        title = "Front brake service",
        version = 1,
        strictness = 0,
        minimumTier = Tier.OPEN,
        steps = listOf(step("s1", 1), step("s2", 2)),
        createdAt = "2026-08-21T00:00:00Z",
    )

    private fun job(id: String) = Job(
        id = id,
        tenantId = "anon",
        procedureId = procedure.id,
        procedureVersion = 1,
        status = JobStatus.OPEN,
        strictness = 0,
        tier = Tier.OPEN,
        startedAt = "2026-08-21T00:00:00Z",
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
    fun `a step nobody has touched is off`() {
        val state = JobViewModel.UiState()
        assertEquals(FlashMode.Off, state.flashFor("s1"))
        assertEquals(FlashMode.Off, state.flashFor("a step that does not exist"))
    }

    @Test
    fun `cycling one step walks that step through the three states`() {
        var state = JobViewModel.UiState()

        state = state.withFlashCycled("s1")
        assertEquals(FlashMode.Auto, state.flashFor("s1"))

        state = state.withFlashCycled("s1")
        assertEquals(FlashMode.On, state.flashFor("s1"))

        state = state.withFlashCycled("s1")
        assertEquals(FlashMode.Off, state.flashFor("s1"))
    }

    @Test
    fun `one step's lamp does not reach across to another`() {
        val state = JobViewModel.UiState()
            .withFlashCycled("s1")
            .withFlashCycled("s1")

        assertEquals(FlashMode.On, state.flashFor("s1"))
        assertEquals("s2 was never touched", FlashMode.Off, state.flashFor("s2"))
    }

    @Test
    fun `the choice survives walking away from the step and back`() {
        // Stepping is an index move on the same state, so what this really pins is that the
        // lamp is keyed by step id and not by "the step in hand".
        val state = JobViewModel.UiState(procedure = procedure, job = job("job_one"))
            .withFlashCycled("s1")
            .copy(stepIndex = 1)
            .withFlashCycled("s2")
            .copy(stepIndex = 0)

        assertEquals(FlashMode.Auto, state.flashFor("s1"))
        assertEquals(FlashMode.Auto, state.flashFor("s2"))
    }

    @Test
    fun `the lamp does not survive into the next job`() {
        val dirty = JobViewModel.UiState(procedure = procedure, job = job("job_one"))
            .withFlashCycled("s1")
            .withFlashCycled("s1")
        assertEquals(FlashMode.On, dirty.flashFor("s1"))

        val next = newJobState(procedure, job("job_two"), fabricated = true)

        assertTrue("a lamp belongs to the job that chose it", next.flash.isEmpty())
        assertEquals(FlashMode.Off, next.flashFor("s1"))
    }
}
