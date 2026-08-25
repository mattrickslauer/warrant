package ink.warrant.instrument

import ink.warrant.contract.FieldDef
import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.abs
import kotlin.math.max

/**
 * What a simulated instrument reports, for the field it is standing in for.
 *
 * The simulator used to hold ONE number — 28.4 Nm — and hand it to whatever asked. So a
 * procedure that asks for brake pad thickness on a pair of calipers got back a torque figure,
 * in a unit the step never mentioned, outside a band it could not satisfy. That is worse than
 * having no simulator at all: a demo whose readings are visibly nonsense teaches the person
 * watching that the numbers in this product are decoration.
 *
 * A real instrument's unit is fixed by the tool. The simulator has no tool, so it takes the
 * unit from the only other place that legitimately knows one: what the step DECLARED it
 * accepts. `acceptance_unit`, `acceptance_min`, `acceptance_max` — the same three values the
 * Inspector judges the reading against. Sampling inside them is not cheating the check; the
 * reading still carries the `fake-` tool id, still reads SIMULATED on the frame, and still
 * cannot seal as measured. What it can now do is look like the measurement the step asked for.
 */
data class SimulatedReading(val value: Double, val unit: String)

/**
 * A unit's own idea of scale and resolution, for the two things a declared band cannot supply.
 *
 * `decimals` is the resolution the instrument that reads this unit actually has, and it is the
 * more important half. Calipers read hundredths of a millimetre; a click wrench does not
 * pretend to more than a tenth of a newton-metre; nobody reports 1834.27 rpm. A number carries
 * an implicit claim about how precisely it was measured — the same argument [formatReading]
 * makes — and a simulated number that overstates its resolution is telling that lie twice.
 *
 * `min`/`max` are only reached when a field declares a unit and no band at all, which the
 * compiler forbids for `within` but not for the other rules. It is a plausible working range
 * for the unit, not a claim about any particular machine.
 *
 * Keys are matched case-sensitively FIRST, because `Nm` is torque and `nm` is a nanometre, and
 * a table that folds case is a table that answers a caliper in newton-metres all over again.
 */
private data class Scale(val min: Double, val max: Double, val decimals: Int)

private val SCALES: Map<String, Scale> = mapOf(
    // Length, as a workshop measures it.
    "mm" to Scale(1.0, 12.0, 2),
    "cm" to Scale(1.0, 30.0, 1),
    "m" to Scale(0.1, 5.0, 2),
    "µm" to Scale(10.0, 500.0, 0),
    "um" to Scale(10.0, 500.0, 0),
    "nm" to Scale(50.0, 2000.0, 0),
    "in" to Scale(0.05, 2.0, 3),
    "thou" to Scale(1.0, 60.0, 0),
    // Torque.
    "Nm" to Scale(2.0, 40.0, 1),
    "N·m" to Scale(2.0, 40.0, 1),
    "ft-lb" to Scale(2.0, 30.0, 1),
    "ft·lb" to Scale(2.0, 30.0, 1),
    "lb-ft" to Scale(2.0, 30.0, 1),
    "in-lb" to Scale(10.0, 200.0, 0),
    // Pressure.
    "psi" to Scale(20.0, 45.0, 1),
    "bar" to Scale(1.5, 3.0, 2),
    "kPa" to Scale(150.0, 320.0, 0),
    // Electrical.
    "V" to Scale(11.0, 14.5, 2),
    "mV" to Scale(10.0, 900.0, 0),
    "A" to Scale(0.1, 20.0, 2),
    "mA" to Scale(1.0, 900.0, 0),
    "Ω" to Scale(0.1, 100.0, 2),
    "ohm" to Scale(0.1, 100.0, 2),
    "Wh" to Scale(50.0, 600.0, 0),
    // Temperature, rotation, the rest.
    "°C" to Scale(15.0, 40.0, 1),
    "°F" to Scale(60.0, 105.0, 1),
    "rpm" to Scale(500.0, 4000.0, 0),
    "Hz" to Scale(10.0, 500.0, 1),
    "dB" to Scale(40.0, 95.0, 1),
    "%" to Scale(20.0, 95.0, 0),
    "kg" to Scale(1.0, 50.0, 2),
    "g" to Scale(5.0, 900.0, 1),
    "L" to Scale(0.5, 8.0, 2),
    "mL" to Scale(50.0, 900.0, 0),
    "s" to Scale(1.0, 60.0, 1),
    "ms" to Scale(10.0, 900.0, 0),
)

/** The last resort: no unit, no band, nothing declared. Deliberately unremarkable. */
private val UNITLESS = Scale(0.0, 100.0, 2)

/**
 * The units whose case can safely be ignored, so "RPM" and "Bar" still find their scale.
 *
 * Word-like names only. An SI symbol's case is part of the symbol — `Nm` is torque, `nm` is a
 * nanometre, `S` is siemens and `s` is seconds — and folding those together is the same class
 * of mistake as answering a caliper in newton-metres.
 */
private val WORD_UNITS: Map<String, Scale> =
    SCALES.filterKeys { key -> key.length >= 3 && key.all { it.isLetter() } }
        .mapKeys { it.key.lowercase() }

private fun scaleFor(unit: String): Scale? = SCALES[unit] ?: WORD_UNITS[unit.lowercase()]

/**
 * The window the simulated value is drawn from, in the field's own terms.
 *
 * A two-sided band is used as declared. A one-sided one is opened out on the missing side by
 * the unit's own span, so "at least 3 mm" produces something comfortably over three rather than
 * three point nothing — a demo where every reading sits on the limit is a demo that looks
 * rigged. With no band at all the unit supplies the window, and with no unit either the field
 * has told us nothing and neither will the number.
 */
private fun windowFor(field: FieldDef?): Triple<Double, Double, Int> {
    val unit = field?.acceptanceUnit?.trim().orEmpty()
    val scale = scaleFor(unit)
    val declaredMin = field?.acceptanceMin?.takeIf { it.isFinite() }
    val declaredMax = field?.acceptanceMax?.takeIf { it.isFinite() }
    val fallback = scale ?: UNITLESS
    val span = max(fallback.max - fallback.min, 1e-9)

    val (lo, hi) = when {
        declaredMin != null && declaredMax != null && declaredMax > declaredMin ->
            declaredMin to declaredMax

        // Equal bounds are a target, not a band. Honour it exactly; a tool that hits the
        // number dead on is unusual but not a lie, and inventing slop around a stated target
        // would be.
        declaredMin != null && declaredMax != null -> declaredMin to declaredMax

        declaredMin != null -> declaredMin to (declaredMin + max(span, abs(declaredMin) * 0.5))

        declaredMax != null -> {
            val opened = declaredMax - max(span, abs(declaredMax) * 0.5)
            // Thickness, pressure and voltage do not go negative. If the declared ceiling is
            // positive, the floor stays at zero rather than wandering below it.
            (if (declaredMax > 0) max(0.0, opened) else opened) to declaredMax
        }

        else -> fallback.min to fallback.max
    }

    val decimals = scale?.decimals ?: decimalsForSpan(hi - lo)
    return Triple(lo, hi, decimals)
}

/**
 * Resolution inferred from how wide the band is, for a unit the table has never heard of.
 *
 * A shop that works to a 0.4-wide band is reading to hundredths whatever the unit is called;
 * one working to a band of several hundred is not reading to hundredths of anything.
 */
private fun decimalsForSpan(span: Double): Int = when {
    span <= 0.0 -> 2
    span < 1 -> 3
    span < 10 -> 2
    span < 100 -> 1
    else -> 0
}

/**
 * A stable pseudo-random fraction in [0, 1). Seeded rather than [Math.random] so a test can
 * pin the arithmetic instead of asserting a range and hoping.
 */
private fun fractionOf(seed: Long): Double {
    var x = seed * 6364136223846793005L + 1442695040888963407L
    x = x xor (x ushr 33)
    x *= -0x7ee3623a03d3c83fL
    x = x xor (x ushr 29)
    // Unsigned shift, so the top 53 bits are non-negative and the quotient lands in [0, 1).
    return (x ushr 11).toDouble() / (1L shl 53).toDouble()
}

/**
 * The reading a simulated instrument should produce for [field].
 *
 * Lands in the middle 40% of the window, so a demo does not spend its life on the edge of the
 * acceptance band and so consecutive reads move a little, the way a real tool settling does.
 * The result is rounded to the unit's resolution, because a caliper that reports 3.4172 mm is
 * not a caliper.
 */
fun simulatedReadingFor(field: FieldDef?, seed: Long): SimulatedReading {
    val (lo, hi, decimals) = windowFor(field)
    val value = lo + (hi - lo) * (0.3 + 0.4 * fractionOf(seed))
    return SimulatedReading(
        value = roundTo(value, decimals),
        unit = field?.acceptanceUnit?.trim().orEmpty(),
    )
}

/** Rounds half up, via the shortest decimal form, so 2.345 goes to 2.35 and not 2.34. */
private fun roundTo(value: Double, decimals: Int): Double =
    BigDecimal.valueOf(value).setScale(decimals, RoundingMode.HALF_UP).toDouble()
