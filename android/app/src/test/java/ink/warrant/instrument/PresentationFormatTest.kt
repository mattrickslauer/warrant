package ink.warrant.instrument

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The `0x2904` Characteristic Presentation Format descriptor, which almost nothing reads and
 * which answers, outright, the question Wright otherwise has to infer: what width is this
 * value, how is it scaled, and what does it measure.
 *
 * A device exposing this is STATING its encoding. Reading it is not inference, and every
 * reading Wright can take from a descriptor is a reading it does not have to guess at from
 * bytes — see `specs/2026-08-19-wright-design.md` §6.
 */
class PresentationFormatTest {

    /** sint16 · exponent -2 · degree Celsius · SIG namespace · no description. */
    private val sint16Celsius = byteArrayOf(
        0x0E,                     // format: sint16
        0xFE.toByte(),            // exponent: -2
        0x2F, 0x27,               // unit: 0x272F, degree Celsius, little-endian
        0x01,                     // namespace: Bluetooth SIG
        0x00, 0x00,               // description
    )

    @Test
    fun `reads the format, exponent and unit a device declares`() {
        val f = PresentationFormat.parse(sint16Celsius)!!
        assertEquals(GattFormat.SINT16, f.format)
        assertEquals(-2, f.exponent)
        assertEquals(0x272F, f.unitCode)
        assertEquals("°C", f.unit)
    }

    @Test
    fun `the exponent is signed, so a scale of one hundredth is not a scale of 254`() {
        // 0xFE read as unsigned is 254 and the resulting value would be off by 10^256.
        // This is the exact class of error the descriptor exists to prevent.
        assertEquals(0.01, PresentationFormat.parse(sint16Celsius)!!.scale, 1e-12)
    }

    @Test
    fun `a truncated descriptor is not a format`() {
        // Seven bytes or it is not a presentation format. Padding a short one with assumptions
        // produces a confident, wrong encoding.
        assertNull(PresentationFormat.parse(sint16Celsius.copyOf(6)))
        assertNull(PresentationFormat.parse(ByteArray(0)))
    }

    @Test
    fun `a unit outside the table is reported as unknown rather than guessed at`() {
        // The table is deliberately partial. An unrecognised code must surface as unknown so
        // Wright refuses to emit a driver, because a plausible wrong unit on a sealed record is
        // worse than no driver at all.
        val exotic = sint16Celsius.copyOf().also { it[2] = 0xFF.toByte(); it[3] = 0x27 }
        val f = PresentationFormat.parse(exotic)!!
        assertEquals(0x27FF, f.unitCode)
        assertNull(f.unit)
    }

    @Test
    fun `a format we cannot decode into a number is refused`() {
        // 0x19 is utf8s. It is a perfectly valid descriptor and it does not describe a reading.
        val utf8s = sint16Celsius.copyOf().also { it[0] = 0x19 }
        assertNull(PresentationFormat.parse(utf8s))
    }

    // --- decoding a frame with the encoding the device declared -----------------------------

    /** A 0x2904 descriptor with an arbitrary format and exponent. */
    private fun descriptor(formatCode: Int, exponent: Int, unit: Int = 0x272F) = byteArrayOf(
        formatCode.toByte(), exponent.toByte(),
        (unit and 0xFF).toByte(), ((unit shr 8) and 0xFF).toByte(),
        0x01, 0x00, 0x00,
    )

    @Test
    fun `decodes a frame at the width and scale the device declared`() {
        // sint16, hundredths. 2350 on the wire is 23.5 degrees, and no part of that came from
        // a guess about the encoding — the device said all of it.
        val f = PresentationFormat.parse(descriptor(0x0E, -2))!!
        assertEquals(23.5, f.decode(byteArrayOf(0x2E, 0x09))!!, 1e-9)
    }

    @Test
    fun `signed formats sign-extend rather than reading as a large positive`() {
        val sint16 = PresentationFormat.parse(descriptor(0x0E, -2))!!
        assertEquals(-5.25, sint16.decode(byteArrayOf(0xF3.toByte(), 0xFD.toByte()))!!, 1e-9)

        // sint24 exercises the general path: three bytes, sign bit in the top one.
        val sint24 = PresentationFormat.parse(descriptor(0x0F, 0))!!
        assertEquals(-100.0, sint24.decode(byteArrayOf(0x9C.toByte(), 0xFF.toByte(), 0xFF.toByte()))!!, 1e-9)
    }

    @Test
    fun `unsigned formats do not go negative at the top of their range`() {
        // 0xFFFF read as sint16 is -1 and as uint16 is 65535. A humidity or pressure reading
        // near full scale is exactly where this bug shows up, and only there.
        val f = PresentationFormat.parse(descriptor(0x06, 0))!!
        assertEquals(65535.0, f.decode(byteArrayOf(0xFF.toByte(), 0xFF.toByte()))!!, 1e-9)
    }

    @Test
    fun `float32 is read as IEEE-754 rather than as an integer`() {
        val f = PresentationFormat.parse(descriptor(0x14, 0))!!
        // 23.5f little-endian.
        assertEquals(23.5, f.decode(byteArrayOf(0x00, 0x00, 0xBC.toByte(), 0x41))!!, 1e-6)
    }

    @Test
    fun `a frame narrower than the declared format is not a reading`() {
        // The device said sint32. Three bytes arrived. Decoding them is inventing the fourth.
        val f = PresentationFormat.parse(descriptor(0x10, 0))!!
        assertNull(f.decode(byteArrayOf(0x01, 0x02, 0x03)))
        assertNull(f.decode(ByteArray(0)))
    }

    @Test
    fun `sint12 sign-extends from bit 11, not from bit 15`() {
        // sint12 occupies two bytes but only twelve bits mean anything. -100 is 0xF9C, which
        // sits on the wire as 9C 0F. Sign-extending from the top of the BYTE WIDTH instead of
        // the top of the FORMAT reads it as +3996 — in range, plausible, and wrong by the width
        // of the scale. Exactly the failure mode that survives a plausibility check.
        val f = PresentationFormat.parse(descriptor(0x0D, 0))!!
        assertEquals(-100.0, f.decode(byteArrayOf(0x9C.toByte(), 0x0F))!!, 1e-9)
    }

    @Test
    fun `uint12 uses the same twelve bits without a sign`() {
        val f = PresentationFormat.parse(descriptor(0x05, 0))!!
        assertEquals(3996.0, f.decode(byteArrayOf(0x9C.toByte(), 0x0F))!!, 1e-9)
    }
}
