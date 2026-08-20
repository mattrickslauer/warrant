package ink.warrant.instrument

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

/**
 * A driver for a device that stated its own encoding.
 *
 * This sits between [EnvironmentalSensingDriver] — a published profile we implemented by hand —
 * and [GenericGattDriver], which guesses. It is neither: the device's `0x2904` descriptor names
 * the width, the scale and the unit, so nothing is inferred and nothing was written per-vendor.
 *
 * `specs/2026-08-19-wright-design.md` §2 defect 1: a number with no unit is not a measurement.
 * This driver refuses to exist without one, which is the same rule §4 puts on Wright, enforced
 * here so it holds even when no model is involved.
 */
class DeclaredFormatDriverTest {

    private val service: UUID = UUID.fromString("0000fe95-0000-1000-8000-00805f9b34fb")
    private val characteristic: UUID = UUID.fromString("00000100-0000-1000-8000-00805f9b34fb")

    private fun format(formatCode: Int, exponent: Int, unit: Int) = PresentationFormat.parse(
        byteArrayOf(
            formatCode.toByte(), exponent.toByte(),
            (unit and 0xFF).toByte(), ((unit shr 8) and 0xFF).toByte(),
            0x01, 0x00, 0x00,
        )
    )!!

    @Test
    fun `decodes at the declared scale and reports the declared unit`() {
        val d = DeclaredFormatDriver.from(service, characteristic, format(0x0E, -2, 0x272F))!!
        assertEquals(23.5, d.decode(byteArrayOf(0x2E, 0x09))!!, 1e-9)
        assertEquals("°C", d.produces.unit)
    }

    @Test
    fun `refuses to exist when the device names a unit we cannot resolve`() {
        // The alternative is a driver whose produces.unit is empty, which is exactly the defect
        // GenericGattDriver has. Refusing is the honest outcome: no driver beats a unitless one.
        assertNull(DeclaredFormatDriver.from(service, characteristic, format(0x0E, -2, 0x27FF)))
    }

    @Test
    fun `the plausible range is what the encoding can express, not a claim about the sensor`() {
        // sint16 at hundredths spans -327.68 to 327.67. That bound is a property of the wire
        // format and nothing else — it catches an overflowing decode and makes no assertion
        // about what this particular device can physically measure.
        val d = DeclaredFormatDriver.from(service, characteristic, format(0x0E, -2, 0x272F))!!
        assertEquals(-327.68, d.produces.min, 1e-9)
        assertEquals(327.67, d.produces.max, 1e-9)
        assertTrue(d.produces.plausible(23.5))
        assertTrue(!d.produces.plausible(400.0))
    }

    @Test
    fun `it claims only the characteristic it was built for`() {
        val d = DeclaredFormatDriver.from(service, characteristic, format(0x06, 0, 0x27AD))!!
        assertEquals(CharacteristicRef(service, characteristic), d.characteristicFor(listOf(service)))
        assertNull(d.characteristicFor(listOf(sig(0x180A))))
    }

    @Test
    fun `a frame narrower than the declared format is not a reading`() {
        val d = DeclaredFormatDriver.from(service, characteristic, format(0x10, 0, 0x2724))!!
        assertNull(d.decode(byteArrayOf(0x01, 0x02, 0x03)))
    }

    @Test
    fun `its id separates a declared encoding from both a vetted driver and a guess`() {
        // Three distinct standings, and the record should be able to tell them apart:
        // vetted (we wrote it), declared (the device stated it), guessed (nobody knows).
        val d = DeclaredFormatDriver.from(service, characteristic, format(0x0E, -2, 0x272F))!!
        assertEquals("ble-declared-format@1", d.id)
        assertEquals("declared-", DeclaredFormatDriver.TOOL_ID_PREFIX)
        assertNotNull(d.label)
    }
}
