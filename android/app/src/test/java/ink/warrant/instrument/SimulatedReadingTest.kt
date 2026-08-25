package ink.warrant.instrument

import ink.warrant.contract.AcceptanceRule
import ink.warrant.contract.FieldDef
import ink.warrant.contract.FieldKind
import ink.warrant.contract.FieldSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The simulator answers the question it was asked.
 *
 * The bug these pin: a step asking for brake pad thickness on a pair of calipers got 28.4 Nm
 * back, because the fake driver held one number and one unit for every field in the product.
 */
class SimulatedReadingTest {

    private fun measurement(
        min: Double? = null,
        max: Double? = null,
        unit: String? = null,
    ) = FieldDef(
        key = "pad_thickness",
        kind = FieldKind.MEASUREMENT,
        prompt = "Measure the friction material with calipers",
        source = FieldSource.INSTRUMENT,
        requiredAtStrictness = 1,
        acceptanceRule = AcceptanceRule.WITHIN,
        acceptanceMin = min,
        acceptanceMax = max,
        acceptanceUnit = unit,
        guidance = "Thinnest point of the pad, square to the face.",
    )

    /** Every seed, not one lucky one — the value must never be able to land outside. */
    private fun samples(field: FieldDef?): List<SimulatedReading> =
        (0L until 500L).map { simulatedReadingFor(field, it * 7919L + 13L) }

    @Test
    fun `a caliper field is answered in millimetres, not newton-metres`() {
        val field = measurement(min = 1.5, max = 6.0, unit = "mm")
        for (r in samples(field)) {
            assertEquals("mm", r.unit)
            assertTrue("${r.value} outside 1.5–6.0", r.value in 1.5..6.0)
        }
    }

    @Test
    fun `a torque field is still answered in newton-metres`() {
        val field = measurement(min = 6.0, max = 9.0, unit = "Nm")
        for (r in samples(field)) {
            assertEquals("Nm", r.unit)
            assertTrue("${r.value} outside 6–9", r.value in 6.0..9.0)
        }
    }

    @Test
    fun `the reading lands inside the band and off its edges`() {
        // A demo whose every reading sits exactly on the limit looks rigged, and a reading that
        // sits outside it makes the acceptance check fail for reasons the technician cannot see.
        val values = samples(measurement(min = 6.0, max = 9.0, unit = "Nm")).map { it.value }
        assertTrue(values.all { it > 6.0 && it < 9.0 })
        assertTrue("no jitter at all", values.distinct().size > 5)
    }

    @Test
    fun `resolution matches the instrument that reads the unit`() {
        // Calipers read hundredths of a millimetre. A wrench does not claim thousandths of a
        // newton-metre, and nothing reports a fractional rpm.
        assertTrue(samples(measurement(1.5, 6.0, "mm")).all { decimals(it.value) <= 2 })
        assertTrue(samples(measurement(6.0, 9.0, "Nm")).all { decimals(it.value) <= 1 })
        assertTrue(samples(measurement(500.0, 4000.0, "rpm")).all { decimals(it.value) == 0 })
    }

    @Test
    fun `Nm and nm are not the same unit`() {
        // Case-folding the table is how a nanometre field would get a torque range. The scales
        // are three orders apart; the collision must not be silently resolved.
        val torque = samples(measurement(unit = "Nm")).map { it.value }
        val nano = samples(measurement(unit = "nm")).map { it.value }
        assertTrue(torque.all { it in 2.0..40.0 })
        assertEquals("nm", simulatedReadingFor(measurement(unit = "nm"), 1L).unit)
        assertTrue("nm silently read as torque", nano.any { it !in 2.0..40.0 })
    }

    @Test
    fun `a one-sided minimum reads comfortably above it`() {
        // "At least 3 mm of friction material left." Sitting on 3.00 every time would be a
        // pass that looks like a failure.
        for (r in samples(measurement(min = 3.0, unit = "mm"))) {
            assertEquals("mm", r.unit)
            assertTrue("${r.value} not above 3", r.value > 3.0)
        }
    }

    @Test
    fun `a one-sided maximum stays above zero`() {
        // "No more than 0.5 mm of run-out." Thickness and pressure do not go negative, and a
        // negative simulated reading is not a demo, it is a bug on screen.
        for (r in samples(measurement(max = 0.5, unit = "mm"))) {
            assertTrue("${r.value} not in 0–0.5", r.value > 0.0 && r.value < 0.5)
        }
    }

    @Test
    fun `a unit with no band still gets that unit's scale`() {
        // The compiler forbids a bandless `within`, but the other rules allow one.
        for (r in samples(measurement(unit = "V"))) {
            assertEquals("V", r.unit)
            assertTrue("${r.value} not a plausible voltage", r.value in 11.0..14.5)
        }
    }

    @Test
    fun `no field at all produces a bare unitless number`() {
        // The pairing screen wants something to show and knows nothing about any step. A
        // confident wrong unit there is worse than no unit.
        for (r in samples(null)) {
            assertEquals("", r.unit)
            assertTrue(r.value in 0.0..100.0)
        }
    }

    @Test
    fun `the same seed gives the same reading`() {
        // Seeded rather than Math.random, so the arithmetic above can be pinned rather than
        // asserted loosely and hoped about.
        assertEquals(
            simulatedReadingFor(measurement(1.5, 6.0, "mm"), 42L),
            simulatedReadingFor(measurement(1.5, 6.0, "mm"), 42L),
        )
    }

    private fun decimals(v: Double): Int =
        java.math.BigDecimal(v.toString()).stripTrailingZeros().scale().coerceAtLeast(0)
}
