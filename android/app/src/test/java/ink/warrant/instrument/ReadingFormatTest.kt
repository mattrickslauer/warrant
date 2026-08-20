package ink.warrant.instrument

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * How a measurement is written down.
 *
 * The reference instrument sends a 32-bit float, which widens to a double and prints as
 * `26.606204986572266`. Seventeen significant digits from a sensor with nothing like that
 * resolution is a claim about precision that nobody made — on a product whose whole argument is
 * not overstating what the evidence supports, the default `toString` is the wrong answer.
 */
class ReadingFormatTest {

    @Test
    fun `a float widened to a double does not claim seventeen digits of precision`() {
        assertEquals("26.61", formatReading(26.606204986572266))
    }

    @Test
    fun `a whole number is written as one`() {
        assertEquals("28", formatReading(28.0))
        assertEquals("0", formatReading(0.0))
    }

    @Test
    fun `trailing zeros are not padding to a fixed width`() {
        assertEquals("0.5", formatReading(0.5))
        assertEquals("30.1", formatReading(30.10))
    }

    @Test
    fun `negatives keep their sign and their precision`() {
        assertEquals("-5.25", formatReading(-5.25))
    }

    @Test
    fun `it rounds rather than truncating`() {
        assertEquals("2.35", formatReading(2.345))
        assertEquals("3", formatReading(2.999))
    }

    @Test
    fun `a value that is not a number must not be dressed up as a measurement`() {
        // A garbage frame decoded as a float lands here as NaN or an infinity. Printing
        // "Infinity Nm" into a green measured badge is the worst available outcome: it reads
        // as evidence. It has to be visibly not a reading.
        assertEquals("invalid", formatReading(Double.NaN))
        assertEquals("invalid", formatReading(Double.POSITIVE_INFINITY))
        assertEquals("invalid", formatReading(Double.NEGATIVE_INFINITY))
    }
}
