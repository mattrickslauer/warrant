package ink.warrant.instrument

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Decoding is where a driver hurts you.
 *
 * A wrong scale factor produces a plausible-looking number that passes every downstream check
 * and lands on a sealed record as a measurement. These tests pin the wire formats against
 * bytes written the way the device writes them, which is the only part of that risk a unit test
 * can actually retire — see `architecture.md` §5 on why plausibility, not proof, is the
 * standard here.
 */
class DriverTest {

    private fun leFloat(v: Float): ByteArray =
        ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putFloat(v).array()

    private fun leShort(v: Short): ByteArray =
        ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(v).array()

    @Test
    fun `esp32 reference decodes the little-endian float its firmware writes`() {
        val decoded = Esp32ReferenceDriver.decode(leFloat(28.4f))
        assertEquals(28.4, decoded!!, 0.0001)
    }

    @Test
    fun `a short frame is not a reading`() {
        // A truncated packet must produce nothing. Decoding it as a number would be the worst
        // thing this layer could do: it would be indistinguishable from a real measurement.
        assertNull(Esp32ReferenceDriver.decode(byteArrayOf(1, 2)))
        assertNull(Esp32ReferenceDriver.decode(ByteArray(0)))
    }

    @Test
    fun `environmental sensing follows the SIG profile, hundredths of a degree`() {
        // The profile specifies sint16 in 0.01 °C. 2350 is 23.5 °C, not 2350 °C.
        assertEquals(23.5, EnvironmentalSensingDriver.decode(leShort(2350))!!, 0.0001)
        // Negative temperatures are signed, not a huge positive number.
        assertEquals(-5.25, EnvironmentalSensingDriver.decode(leShort(-525))!!, 0.0001)
    }

    @Test
    fun `plausibility bounds the value without pretending to verify it`() {
        assertTrue(Esp32ReferenceDriver.produces.plausible(28.4))
        assertTrue(!Esp32ReferenceDriver.produces.plausible(-1.0))
        assertTrue(!Esp32ReferenceDriver.produces.plausible(5000.0))

        // The honest limit, demonstrated rather than asserted. A tenfold scale error that
        // overshoots the range is caught:
        assertTrue(!Esp32ReferenceDriver.produces.plausible(284.0))
        // ...but the same error in the other direction lands inside the range and sails
        // through. 2.84 Nm is not a torque anyone would apply to a caliper bolt, and this
        // check has no way to know that. Plausibility is not verification — architecture.md §5
        // chooses this trade deliberately, and this test is here so nobody forgets it was a
        // choice.
        assertTrue(Esp32ReferenceDriver.produces.plausible(2.84))
    }

    @Test
    fun `the sig uuid helper builds the standard base uuid`() {
        assertEquals("0000181a-0000-1000-8000-00805f9b34fb", sig(0x181A).toString())
        assertEquals("00002a6e-0000-1000-8000-00805f9b34fb", sig(0x2A6E).toString())
    }

    @Test
    fun `a simulated reading is marked so it can never pass as measured`() {
        // The Seal refuses this prefix. If this test fails, a fabricated number can reach a
        // sealed record as a measurement, which is the one outcome this system exists to
        // prevent.
        assertTrue(FakeDriver.TOOL_ID_PREFIX.isNotBlank())
        assertEquals("fake-", FakeDriver.TOOL_ID_PREFIX)
        assertTrue(FakeDriver.sample() in 26.0..30.0)
    }

    @Test
    fun `the reference driver only claims a device advertising its service`() {
        assertEquals(
            CharacteristicRef(Esp32ReferenceDriver.SERVICE, Esp32ReferenceDriver.CHARACTERISTIC),
            Esp32ReferenceDriver.characteristicFor(listOf(Esp32ReferenceDriver.SERVICE)),
        )
        assertNull(Esp32ReferenceDriver.characteristicFor(listOf(sig(0x180A))))
    }
}
