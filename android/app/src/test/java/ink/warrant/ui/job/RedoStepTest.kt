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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Doing a step again, and what that is allowed to touch.
 *
 * The failure this pins is a screen with no way forward. An agent rejects a step the technician
 * has already finished; every field on it is filled, so [activeFieldFor] points at nothing, the
 * bar reads "Next step", and on a single-field step the strip that could have gone back is not
 * drawn at all. The person is looking at a rejection with nothing to tap.
 *
 * [JobViewModel.UiState.withStepRedone] is the whole of the fix, and it is a pure transition for
 * the same reason `withFlashCycled` beside it is: what a redo must NOT touch is most of the
 * point, and that is exactly the part a screenshot cannot show.
 */
class RedoStepTest {

    private fun field(key: String, kind: FieldKind = FieldKind.PHOTO) = FieldDef(
        key = key,
        kind = kind,
        prompt = "Do the thing",
        source = if (kind == FieldKind.PHOTO) FieldSource.CAMERA else FieldSource.HUMAN,
        requiredAtStrictness = 0,
        acceptanceRule = AcceptanceRule.MUST_SHOW,
        guidance = "What good looks like",
    )

    private fun step(id: String, index: Int, vararg keys: String) = Step(
        id = id,
        index = index,
        title = "Step $index",
        explanation = "why",
        maxAddFields = 1,
        fields = keys.map { field(it) },
    )

    private val procedure = Procedure(
        id = "proc_brakes",
        tenantId = "anon",
        key = "front-brake-service",
        title = "Front brake service",
        version = 1,
        strictness = 0,
        minimumTier = Tier.OPEN,
        steps = listOf(step("s1", 1, "pad", "disc"), step("s2", 2, "torque")),
        createdAt = "2026-08-21T00:00:00Z",
    )

    private val job = Job(
        id = "job_one",
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
                jobId = "job_one",
                stepId = it.id,
                status = StepStatus.PENDING,
                fields = emptyList(),
            )
        },
    )

    /** Both steps done, which is the state a rejection actually arrives in. */
    private fun finished() = JobViewModel.UiState(
        procedure = procedure,
        job = job,
        filled = setOf("s1:pad", "s1:disc", "s2:torque"),
        statuses = mapOf("s1" to StepStatus.PERFORMED, "s2" to StepStatus.PERFORMED),
    )

    @Test
    fun `a finished step has nothing to point at, which is the bug`() {
        val state = finished()
        assertTrue("s1 reads complete", state.stepComplete("s1"))
        val active = activeFieldFor(
            fields = state.fieldsFor("s1"),
            strictness = 0,
            selected = null,
        ) { key -> state.isFilled("s1", key) }
        assertEquals(
            "nothing outstanding, so the bar becomes Next step",
            null,
            active,
        )
    }

    @Test
    fun `redoing a step points the page back at its first field`() {
        val state = finished().withStepRedone("s1")

        assertFalse(state.stepComplete("s1"))
        val active = activeFieldFor(
            fields = state.fieldsFor("s1"),
            strictness = 0,
            selected = null,
        ) { key -> state.isFilled("s1", key) }
        assertNotNull("the redone step asks again", active)
        assertEquals("pad", active?.key)

        val bar = primaryActionFor(
            field = active,
            fieldFilled = false,
            lastStep = false,
            instrumentConnected = false,
            instrumentHasReading = false,
            inputReady = false,
        )
        assertEquals(ActionKind.CAPTURE, bar.kind)
    }

    @Test
    fun `every field of that step is emptied, not only the first`() {
        val state = finished().withStepRedone("s1")
        assertFalse(state.isFilled("s1", "pad"))
        assertFalse(state.isFilled("s1", "disc"))
    }

    @Test
    fun `no other step is touched`() {
        val state = finished().withStepRedone("s1")
        assertTrue("s2 keeps its evidence", state.isFilled("s2", "torque"))
        assertTrue(state.stepComplete("s2"))
        assertEquals(StepStatus.PERFORMED, state.statuses["s2"])
    }

    @Test
    fun `a step id that is a prefix of another does not take it with it`() {
        // `s1` and `s10` share five characters. The key is "$stepId:$key", so the colon is what
        // keeps them apart — and a redo that emptied a neighbouring step would look like the
        // record losing evidence nobody asked it to lose.
        val state = finished()
            .copy(filled = setOf("s1:pad", "s10:pad"))
            .withStepRedone("s1")
        assertFalse(state.isFilled("s1", "pad"))
        assertTrue(state.isFilled("s10", "pad"))
    }

    @Test
    fun `a reason given on the old attempt does not retire the new one`() {
        // Exit two was taken, then the technician came back with the tool. Leaving `reasoned`
        // set would retire the step's own fields — see FieldDef.holdsStep — so the page would
        // point at nothing on a step that had just been emptied, which is the bug again.
        val state = finished()
            .copy(reasoned = setOf("s1"))
            .withStepRedone("s1")
        assertFalse("s1" in state.reasoned)
    }

    @Test
    fun `a live status is left alone and a settled one is dropped`() {
        // `performed` is not the fleet closing the step to the hands, so it stays: the next
        // capture is what moves it. `impossible` IS, and a step carrying one is filtered out of
        // every list a technician sees — so redoing it would strand them on a step nothing
        // admits exists.
        val performed = finished().withStepRedone("s1")
        assertEquals(StepStatus.PERFORMED, performed.statuses["s1"])

        val closed = finished()
            .copy(statuses = mapOf("s1" to StepStatus.IMPOSSIBLE))
            .withStepRedone("s1")
        assertEquals(null, closed.statuses["s1"])
        assertTrue("it is owed again", closed.outstanding.any { it.id == "s1" })
    }

    @Test
    fun `a redone step is owed again, so the handover names it`() {
        val state = finished().withStepRedone("s1")
        assertTrue(state.outstanding.any { it.id == "s1" })
        assertFalse(state.outstanding.any { it.id == "s2" })
    }
}
