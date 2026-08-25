package ink.warrant.ui.job

import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import ink.warrant.contract.Job
import ink.warrant.contract.JobStatus
import ink.warrant.contract.Procedure
import ink.warrant.contract.ProcedureStatus
import ink.warrant.contract.Step
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A job with a step nobody can perform still reaches an end.
 *
 * The failure, in full. `proc_segway_xyber_brake_pad_replacement` carried a `choice` field
 * with an empty `choices` array. On the step page that is a question with nothing to tap; the
 * bar — the only way forward on a step — fell through to "Record", which enables itself only
 * once something has been typed, and nothing can be typed at a question with no answers and
 * no keyboard. So the bar was permanently grey.
 *
 * That alone stopped the run. Underneath it, two further rules held the job shut even if the
 * technician had found their way past: the step could never be complete, so it sat in
 * `outstanding` forever, so the handover read "Not finished yet" for the rest of the job's
 * life and the record could never seal. A procedure with one malformed field took the whole
 * job with it, and the only remaining move was to force-quit the app — which loses every
 * capture already made.
 *
 * What follows pins the fix at the level the screen actually reads: the state, not the
 * button. [StepActionTest] covers the button.
 */
class UnperformableStepTest {

    private fun field(key: String, kind: FieldKind, choices: List<String> = emptyList()) = FieldDef(
        key = key,
        kind = kind,
        prompt = "Do the thing",
        source = if (kind == FieldKind.PHOTO) FieldSource.CAMERA else FieldSource.HUMAN,
        requiredAtStrictness = 0,
        choices = choices,
        acceptanceRule = AcceptanceRule.MUST_SHOW,
        guidance = "What good looks like",
    )

    private fun step(id: String, index: Int, vararg fields: FieldDef) = Step(
        id = id,
        index = index,
        title = "Step $index",
        explanation = "why this step exists",
        maxAddFields = 1,
        fields = fields.toList(),
    )

    /** Step two asks a question the procedure forgot to write the answers to. */
    private val procedure = Procedure(
        id = "proc_segway_xyber_brake_pad_replacement",
        tenantId = "t",
        key = "segway-xyber-brake-pad-replacement",
        title = "Brake pad replacement",
        version = 3,
        strictness = 1,
        minimumTier = Tier.OPEN,
        steps = listOf(
            step("s1", 1, field("pad_seated", FieldKind.PHOTO)),
            step("s2", 2, field("test_ride_performance", FieldKind.CHOICE)),
            step("s3", 3, field("bay_clear", FieldKind.PHOTO)),
        ),
        status = ProcedureStatus.PUBLISHED,
        createdAt = "2026-08-25T00:00:00Z",
    )

    private val job = Job(
        id = "t/j1",
        tenantId = "t",
        procedureId = procedure.id,
        procedureVersion = 3,
        status = JobStatus.OPEN,
        strictness = 1,
        tier = Tier.OPEN,
        startedAt = "2026-08-25T00:00:00Z",
        steps = emptyList(),
    )

    /** Everything captured except the question that has no answers. */
    private val state = JobViewModel.UiState(
        procedure = procedure,
        job = job,
        filled = setOf("s1:pad_seated", "s3:bay_clear"),
    )

    @Test
    fun `the impossible step holds the job until somebody says why`() {
        // The state before the fix, and still the state until a reason is given. This is
        // correct: a step nobody has explained is a step that is genuinely still owed.
        assertFalse(state.stepComplete("s2"))
        assertEquals(listOf("s2"), state.outstanding.map { it.id })
        assertEquals(
            HandoverState.OUTSTANDING,
            handoverStateFor(state.outstanding.size, state.sealedRecordId),
        )
    }

    @Test
    fun `a stated reason lets the job reach its handover`() {
        val after = state.copy(reasoned = setOf("s2"))

        assertTrue("nothing can hold the step once the question is retired", after.stepComplete("s2"))
        assertEquals(emptyList<String>(), after.outstanding.map { it.id })
        assertEquals(
            HandoverState.WAITING,
            handoverStateFor(after.outstanding.size, after.sealedRecordId),
        )
    }

    @Test
    fun `the step that was explained is still named on the handover`() {
        // The counterweight. Dropping it out of "Still owed" without putting it anywhere is a
        // hole in the record that looks like nothing happened, which is the one thing this
        // product exists to abolish.
        val after = state.copy(reasoned = setOf("s2"))
        assertEquals(listOf("s2"), after.explained.map { it.id })

        val (_, why) = handoverHeadline(HandoverState.WAITING, 0, after.explained.size)
        assertTrue("the handover must not claim a clean job: $why", why.contains("deficient"))
    }

    @Test
    fun `a reason does not excuse the work that could still have been done`() {
        // The refusal that keeps exit two from becoming a skip. Step one's photograph was
        // never taken; saying why step two was impossible does not retire it.
        val after = JobViewModel.UiState(
            procedure = procedure,
            job = job,
            filled = setOf("s3:bay_clear"),
            reasoned = setOf("s1", "s2"),
        )
        assertFalse("an answerable field is still owed", after.stepComplete("s1"))
        assertEquals(listOf("s1"), after.outstanding.map { it.id })
    }

    @Test
    fun `a step the fleet settled is not sent back to the technician`() {
        // `deferred`, `waived` and `impossible` are all written by the fleet, never by this
        // client. A step carrying one has been decided, and listing it under "Still owed"
        // walks somebody back to a step nobody is waiting on them for.
        val settled = state.copy(statuses = mapOf("s2" to StepStatus.IMPOSSIBLE))
        assertEquals(emptyList<String>(), settled.outstanding.map { it.id })
        assertEquals(listOf("s2"), settled.explained.map { it.id })
    }

    @Test
    fun `work done after the reason was given counts as done`() {
        // Somebody says why they cannot do a step, walks on, then comes back with the tool
        // and does it. The step is performed, whatever was said in the middle, and it must
        // not be filed under "Explained, not performed".
        val done = state.copy(
            reasoned = setOf("s2"),
            filled = state.filled + "s2:test_ride_performance",
        )
        assertTrue(done.stepComplete("s2"))
        assertEquals(emptyList<String>(), done.explained.map { it.id })
    }

    @Test
    fun `a reason on one job is never carried into the next`() {
        val fresh = newJobState(procedure, job, fabricated = false)
        assertEquals(emptySet<String>(), fresh.reasoned)
    }
}
