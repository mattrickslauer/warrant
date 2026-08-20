package ink.warrant.instrument

import ink.warrant.contract.Tier
import ink.warrant.instrument.InstrumentSession.Link
import ink.warrant.instrument.InstrumentSession.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the pairing screen is allowed to say, and when.
 *
 * The session held `connecting`, `toolId` and `error` as loose fields, which made three things
 * impossible: showing progress against the ROW the technician actually tapped, telling a
 * refusal apart from an ordinary disconnect, and stopping the two contradicting each other.
 * The transitions live here as a pure function so they can be pinned.
 */
class LinkStateTest {

    private val addr = "AA:BB:CC:DD:EE:FF"

    private fun reading() = InstrumentEvent.Value(
        value = 28.4, unit = "Nm", toolId = "A1B2C3", plausible = true, driverId = "x@1",
    )

    @Test
    fun `connecting names the device being connected to`() {
        val s = reduce(State(), InstrumentEvent.Connecting, addr, "Warrant Ref 01")
        val link = s.link as Link.Connecting
        assertEquals(addr, link.address)
        assertEquals("Warrant Ref 01", link.name)
        assertTrue(s.connecting)
    }

    @Test
    fun `connected becomes paired and carries the tool id`() {
        val s = reduce(State(), InstrumentEvent.Connected("A1B2C3", Esp32ReferenceDriver), addr, null)
        val link = s.link as Link.Paired
        assertEquals("A1B2C3", link.toolId)
        assertEquals(Esp32ReferenceDriver, link.driver)
        assertTrue(s.connected)
        assertFalse(s.connecting)
    }

    @Test
    fun `a failure becomes a rejection that keeps the reason and the device`() {
        val s = reduce(State(), InstrumentEvent.Failed("it refused (status 133)."), addr, "Thing")
        val link = s.link as Link.Rejected
        assertEquals("it refused (status 133).", link.reason)
        assertEquals(addr, link.address)
        assertEquals("Thing", link.name)
        assertFalse(s.connected)
        assertFalse(s.connecting)
    }

    @Test
    fun `the disconnect that follows a rejection must not erase it`() {
        // A refused connection tears the GATT client down, so Disconnected arrives immediately
        // behind Failed. Treating it as an ordinary return to idle makes the explanation flash
        // up and vanish — which is indistinguishable from the silent failure being fixed here.
        val rejected = reduce(State(), InstrumentEvent.Failed("it refused."), addr, null)
        val after = reduce(rejected, InstrumentEvent.Disconnected, addr, null)
        assertTrue(after.link is Link.Rejected)
    }

    @Test
    fun `an ordinary disconnect returns to idle`() {
        val paired = reduce(State(), InstrumentEvent.Connected("A1B2C3", Esp32ReferenceDriver), addr, null)
        assertEquals(Link.Idle, reduce(paired, InstrumentEvent.Disconnected, addr, null).link)
    }

    @Test
    fun `a reading updates the value without disturbing the link`() {
        val paired = reduce(State(), InstrumentEvent.Connected("A1B2C3", Esp32ReferenceDriver), addr, null)
        val withValue = reduce(paired, reading(), addr, null)
        assertEquals(paired.link, withValue.link)
        assertEquals(28.4, withValue.latest!!.value, 1e-9)
    }

    @Test
    fun `only a real pairing raises the tier`() {
        val paired = State(link = Link.Paired(addr, "A1B2C3", Esp32ReferenceDriver))
        assertEquals(Tier.INSTRUMENTED, tierOf(paired))

        // A generated number must never reach a record as measured, however convenient.
        assertEquals(Tier.ATTESTED, tierOf(State(link = Link.Simulated("fake-sim"))))
        assertEquals(Tier.ATTESTED, tierOf(State(link = Link.Rejected(addr, null, "no"))))
        assertEquals(Tier.ATTESTED, tierOf(State()))
    }

    @Test
    fun `a simulated instrument reads as connected but never as measured`() {
        // SettingsScreen keys off `connected`, and simulation must still count as attached.
        val s = State(link = Link.Simulated("fake-sim"))
        assertTrue(s.connected)
        assertTrue(s.simulated)
        assertEquals("fake-sim", s.toolId)
    }
}
