package ink.warrant.data

import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.Field
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import ink.warrant.contract.Job
import ink.warrant.contract.JobStatus
import ink.warrant.contract.StepOutcome
import ink.warrant.contract.StepStatus
import ink.warrant.contract.Tier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rule that decides whether a records row says "1 thing is waiting on you".
 *
 * Worth pinning rather than eyeballing, because both directions of getting it wrong are bad in
 * ways nobody notices quickly. A false positive nags a technician about a step that closed
 * last week until they stop reading the badge at all. A false negative is a question the fleet
 * asked that no surface ever mentions — which is the failure this screen was built for.
 */
class AttentionTest {

    private fun outcome(
        stepId: String,
        status: StepStatus = StepStatus.PENDING,
        question: String? = null,
        answer: String? = null,
        hold: String? = null,
        added: List<FieldDef> = emptyList(),
        accepted: List<String> = emptyList(),
        fields: List<Field> = emptyList(),
    ) = StepOutcome(
        id = "out_$stepId",
        jobId = "t/job_1",
        stepId = stepId,
        status = status,
        escalationQuestion = question,
        escalationAnswer = answer,
        escalationAnsweredBy = answer?.let { "sam" },
        escalationAnsweredAt = answer?.let { "2026-08-24T10:00:00Z" },
        holdReason = hold,
        addedFields = added,
        acceptedFields = accepted,
        fields = fields,
    )

    private fun job(vararg steps: StepOutcome) = Job(
        id = "t/job_1",
        tenantId = "t",
        procedureId = "p",
        procedureVersion = 1,
        status = JobStatus.OPEN,
        strictness = 1,
        tier = Tier.OPEN,
        startedAt = "2026-08-24T09:00:00Z",
        steps = steps.toList(),
    )

    private fun addedField(key: String) = FieldDef(
        key = key,
        kind = FieldKind.PHOTO,
        prompt = "Photograph the $key",
        source = FieldSource.CAMERA,
        requiredAtStrictness = 0,
        acceptanceRule = AcceptanceRule.MUST_SHOW,
        guidance = "In focus, whole part in frame.",
    )

    @Test
    fun `a question on a pending step is waiting on somebody`() {
        val j = job(outcome("s1", question = "Which side did you measure?"))
        val items = openItems(j)

        assertEquals(1, items.size)
        assertEquals(AttentionKind.QUESTION, items[0].kind)
        assertEquals("Which side did you measure?", items[0].ask)
        assertTrue(items[0].outstanding)
        assertTrue(items[0].answerable)
        assertTrue(needsResponse(j))
    }

    @Test
    fun `an answered question stays on the list but stops being outstanding`() {
        // It has NOT gone away — the fleet still has to rule on what was said. Dropping it the
        // moment somebody typed would claim a settlement that has not happened.
        val j = job(outcome("s1", question = "Which side?", answer = "The nearside."))
        val items = openItems(j)

        assertEquals(1, items.size)
        assertFalse(items[0].outstanding)
        assertEquals("The nearside.", items[0].answer)
        assertFalse(needsResponse(j))
        assertEquals(0, outstandingCount(j))
    }

    @Test
    fun `a settled step owes nothing, whatever it still carries`() {
        // The exact false positive worth guarding: a step the fleet ruled on can keep the
        // question that was asked before it did, and a screen reading the field rather than
        // the status would nag about it for ever.
        for (settled in listOf(
            StepStatus.PERFORMED,
            StepStatus.DEFERRED,
            StepStatus.WAIVED,
            StepStatus.IMPOSSIBLE,
        )) {
            val j = job(outcome("s1", status = settled, question = "Which side?", hold = "stuck"))
            assertTrue("$settled should owe nothing", openItems(j).isEmpty())
            assertFalse("$settled should not need a response", needsResponse(j))
        }
    }

    @Test
    fun `a hold is a person's problem and is reported separately from a question`() {
        val j = job(outcome("s1", question = "Which side?", hold = "The fleet could not be reached."))
        val items = openItems(j)

        assertEquals(2, items.size)
        assertEquals(setOf(AttentionKind.QUESTION, AttentionKind.HOLD), items.map { it.kind }.toSet())
        assertEquals(2, outstandingCount(j))
    }

    @Test
    fun `an added field is outstanding until something fills it`() {
        val unfilled = job(outcome("s1", added = listOf(addedField("disc_face"))))
        val items = openItems(unfilled)

        assertEquals(1, items.size)
        assertEquals(AttentionKind.EVIDENCE, items[0].kind)
        // The one kind that cannot be dealt with from a records screen: it needs the camera.
        assertFalse(items[0].answerable)

        val accepted = job(
            outcome("s1", added = listOf(addedField("disc_face")), accepted = listOf("disc_face")),
        )
        assertTrue(openItems(accepted).isEmpty())

        val captured = job(
            outcome(
                "s1",
                added = listOf(addedField("disc_face")),
                fields = listOf(
                    Field(
                        id = "s1__disc_face",
                        stepId = "s1",
                        key = "disc_face",
                        kind = FieldKind.PHOTO,
                        mediaRef = "tenants/t/captures/job_1/c1.jpg",
                    ),
                ),
            ),
        )
        // Captured but not yet accepted is in flight, not outstanding. Asking for it again
        // would send a technician back to a machine to photograph what they already did.
        assertTrue(openItems(captured).isEmpty())
    }

    @Test
    fun `a job with nothing outstanding needs no response`() {
        val j = job(
            outcome("s1", status = StepStatus.PERFORMED),
            outcome("s2"),
        )
        assertTrue(openItems(j).isEmpty())
        assertFalse(needsResponse(j))
        assertEquals(0, outstandingCount(j))
    }

    @Test
    fun `items come back in step order`() {
        val j = job(
            outcome("s1", question = "First?"),
            outcome("s2", question = "Second?"),
            outcome("s3", question = "Third?"),
        )
        assertEquals(listOf("s1", "s2", "s3"), openItems(j).map { it.stepId })
    }
}
