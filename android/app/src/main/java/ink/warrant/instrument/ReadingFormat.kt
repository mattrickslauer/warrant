package ink.warrant.instrument

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Decimal places a reading is written to.
 *
 * Two. The reference instrument sends a 32-bit float which widens to a double and prints as
 * `26.606204986572266` — seventeen significant digits from a sensor with nothing like that
 * resolution. A number carries an implicit claim about how precisely it was measured, and this
 * product is not in the business of overstating what its evidence supports.
 */
private const val DECIMALS = 2

/**
 * A reading, written the way it should be read.
 *
 * Rounds to [DECIMALS], drops trailing zeros so a whole number stays whole, and refuses to
 * dress a non-finite value up as a measurement.
 */
fun formatReading(value: Double): String {
    // A garbage frame decoded as a float arrives as NaN or an infinity. Rendering
    // "Infinity Nm" inside a green measured badge is the worst outcome available: it reads as
    // evidence. Better to be visibly not a reading.
    if (!value.isFinite()) return "invalid"

    return BigDecimal.valueOf(value)          // via the shortest decimal form, not the exact
        .setScale(DECIMALS, RoundingMode.HALF_UP)   // binary one, so 2.345 rounds to 2.35
        .stripTrailingZeros()
        .toPlainString()
}
