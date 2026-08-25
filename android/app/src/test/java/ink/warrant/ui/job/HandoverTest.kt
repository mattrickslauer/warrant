package ink.warrant.ui.job

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the end of a job is allowed to claim.
 *
 * The failure this pins is the one the screen had for real: Finish did nothing, because
 * finishing was wired to "advance one step" and there is no step after the last one. The fix
 * is a handover with its own state, and the state has to be honest — which is checkable here,
 * without a device.
 */
class HandoverTest {

    @Test
    fun `an outstanding step outranks everything`() {
        assertEquals(HandoverState.OUTSTANDING, handoverStateFor(outstanding = 1, sealedRecordId = null))
        // Even with a record id in hand: what the technician can still do comes first.
        assertEquals(HandoverState.OUTSTANDING, handoverStateFor(outstanding = 2, sealedRecordId = "rec_1"))
    }

    @Test
    fun `captured but unverified is waiting, not sealed`() {
        // The whole reason this enum exists. Capture never waits on a model, so the moment the
        // technician finishes there is usually no record yet, and the screen must not invent one.
        assertEquals(HandoverState.WAITING, handoverStateFor(outstanding = 0, sealedRecordId = null))
    }

    @Test
    fun `only a real record id reads as sealed`() {
        assertEquals(HandoverState.SEALED, handoverStateFor(outstanding = 0, sealedRecordId = "rec_1"))
    }

    @Test
    fun `the outstanding sentence counts what is owed`() {
        val (head, why) = handoverHeadline(HandoverState.OUTSTANDING, outstanding = 1)
        assertEquals("Not finished yet", head)
        assertTrue("singular step should not be pluralised: $why", why.startsWith("1 step still has"))
        val (_, plural) = handoverHeadline(HandoverState.OUTSTANDING, outstanding = 3)
        assertTrue("plural step should be pluralised: $plural", plural.startsWith("3 steps still have"))
    }

    @Test
    fun `no state claims the record before it exists`() {
        val (head, why) = handoverHeadline(HandoverState.WAITING, outstanding = 0)
        assertEquals("Handed to the fleet", head)
        assertTrue("waiting must not claim a seal: $why", !why.contains("Sealed"))
    }

    @Test
    fun `waiting says so when steps ended with a reason instead of evidence`() {
        // The sentence used to read "Everything this procedure asked for is captured" on every
        // waiting job, which on a job carrying an unperformable step was simply false — and
        // false in the reassuring direction, which is the one that matters. The technician
        // walks off believing it will seal clean and it is going to seal deficient.
        val (head, why) = handoverHeadline(HandoverState.WAITING, outstanding = 0, explained = 1)
        assertEquals("Handed to the fleet", head)
        assertTrue("must not claim everything was captured: $why", !why.contains("Everything"))
        assertTrue("must say how many: $why", why.contains("1 step "))
        assertTrue("must not promise a clean seal: $why", why.contains("deficient"))

        val (_, plural) = handoverHeadline(HandoverState.WAITING, outstanding = 0, explained = 3)
        assertTrue("plural must be pluralised: $plural", plural.contains("3 steps "))
    }

    @Test
    fun `a job with nothing explained keeps the sentence it always had`() {
        val (_, why) = handoverHeadline(HandoverState.WAITING, outstanding = 0, explained = 0)
        assertTrue("the ordinary case is unchanged: $why", why.startsWith("Everything"))
    }
}
