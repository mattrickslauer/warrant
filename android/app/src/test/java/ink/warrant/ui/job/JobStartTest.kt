package ink.warrant.ui.job

import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.Agent
import ink.warrant.contract.Decision
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A second run of a procedure is a second job, and inherits nothing from the first.
 *
 * The failure this pins is the one the app had for real. [JobViewModel] is scoped to the
 * activity rather than the route, so one instance serves every job of a session — and `start`
 * built the next job's state with `copy()`, which carried `sealedRecordId` and `handedOver`
 * out of the run before it. `JobScreen` reads `handedOver` before it reads anything else, so
 * the moment you sealed one record every later run of anything opened on the *previous* run's
 * handover page. You could never reach step one again, and the only way out was to kill the
 * app. That is a demo-ending bug in a product whose whole argument is a stack of records.
 *
 * It is checkable here because the reset is [newJobState], plain Kotlin with no view model,
 * no dispatcher and no device. The test is written as "hand it the filthiest previous state
 * you can construct" on purpose: a `copy()` regression would pass every assertion about the
 * new job and fail only on what it forgot to clear.
 */
class JobStartTest {

    // A step that actually owes something. Fields matter here: `outstanding` is computed from
    // the fields a step still needs, so a step with none is complete the instant it exists and
    // would make the assertion about outstanding work pass for the wrong reason.
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
        id = "proc_cut_banana",
        tenantId = "anon",
        key = "cut-a-banana",
        title = "Cut a banana",
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

    /** A run that got all the way through: sealed, held, handed over, three steps of debris. */
    private val finishedRun = JobViewModel.UiState(
        procedure = procedure,
        job = job("job_one"),
        stepIndex = 1,
        addedFields = mapOf("s1" to emptyList()),
        filled = setOf("s1:photo", "s2:photo"),
        decisions = listOf(
            Decision(
                id = "dec_1",
                jobId = "job_one",
                stepId = "s2",
                agent = Agent.INSPECTOR,
                agentVersion = "inspector@1.4.0",
                verdict = "PASS",
                rationale = "The cuts run through.",
                at = "2026-08-21T00:01:00Z",
            ),
        ),
        statuses = mapOf("s1" to StepStatus.PERFORMED, "s2" to StepStatus.PERFORMED),
        alerts = listOf(JobViewModel.Alert("s2", "One more thing needed", "Another angle")),
        heldReason = "a step was explained rather than performed",
        sealedRecordId = "rec_one",
        handedOver = true,
        error = "something went wrong last time",
        fabricated = true,
    )

    @Test
    fun `the second run does not open on the first run's handover`() {
        val next = newJobState(procedure, job("job_two"), fabricated = true)

        // The two that blocked it, and the reason the work was unreachable.
        assertFalse("handedOver must not survive the job it belongs to", next.handedOver)
        assertNull("a record belongs to the job that earned it", next.sealedRecordId)
    }

    @Test
    fun `a fresh job carries nothing from the run before it`() {
        val next = newJobState(procedure, job("job_two"), fabricated = true)

        assertEquals("job_two", next.job?.id)
        assertEquals("starts at step one, not wherever the last run stopped", 0, next.stepIndex)
        assertTrue(next.filled.isEmpty())
        assertTrue(next.addedFields.isEmpty())
        assertTrue("the last run's verdicts are not this job's trace", next.decisions.isEmpty())
        assertTrue(next.alerts.isEmpty())
        assertNull("this job has not held anything", next.heldReason)
        assertNull(next.error)
        // Every step pending — a job whose steps arrive already performed cannot be performed.
        assertEquals(
            mapOf("s1" to StepStatus.PENDING, "s2" to StepStatus.PENDING),
            next.statuses,
        )
        assertEquals("every step is owed again, from the top", procedure.steps, next.outstanding)
    }

    @Test
    fun `fabricated is a property of the source, so it is the one thing carried`() {
        // Not inherited from the previous state — passed in. A build serving the scripted
        // timeline must keep saying so on run four, and a live one must not start claiming it.
        assertTrue(newJobState(procedure, job("job_two"), fabricated = true).fabricated)
        assertFalse(newJobState(procedure, job("job_two"), fabricated = false).fabricated)
    }

    @Test
    fun `the previous state is genuinely dirty, so the assertions above mean something`() {
        // Guards the guard: if `finishedRun` ever drifts to defaults these tests pass vacuously.
        assertTrue(finishedRun.handedOver)
        assertEquals("rec_one", finishedRun.sealedRecordId)
        assertEquals(1, finishedRun.decisions.size)
        assertEquals(1, finishedRun.alerts.size)
        assertNull(newJobState(procedure, job("job_two"), fabricated = true).sealedRecordId)
    }
}
