package ink.warrant.instrument

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

/**
 * What a BLE device says about itself, before anyone guesses.
 *
 * `specs/2026-08-19-wright-design.md` §2 names three defects in [GenericGattDriver]: it has no
 * unit, it takes the first characteristic it finds, and it never checks itself. This file
 * addresses the first two at their source — by reading what the device already declares.
 */

/**
 * The numeric formats a `0x2904` descriptor can name, with the width each occupies on the wire.
 *
 * Non-numeric formats (`utf8s`, `utf16s`, `struct`, the sub-byte widths) are deliberately
 * absent. A characteristic declaring one of those is not carrying a reading, and [PresentationFormat.parse]
 * refuses it rather than returning something a caller might decode anyway.
 */
enum class GattFormat(val code: Int, val width: Int, val bits: Int = width * 8) {
    BOOLEAN(0x01, 1),
    UINT8(0x04, 1),
    UINT12(0x05, 2, bits = 12),
    UINT16(0x06, 2),
    UINT24(0x07, 3),
    UINT32(0x08, 4),
    UINT48(0x09, 6),
    UINT64(0x0A, 8),
    SINT8(0x0C, 1),
    SINT12(0x0D, 2, bits = 12),
    SINT16(0x0E, 2),
    SINT24(0x0F, 3),
    SINT32(0x10, 4),
    SINT48(0x11, 6),
    SINT64(0x12, 8),
    FLOAT32(0x14, 4),
    FLOAT64(0x15, 8);

    val signed: Boolean get() = this in SIGNED
    val isFloat: Boolean get() = this == FLOAT32 || this == FLOAT64

    /**
     * The span this encoding can express, before the declared exponent scales it.
     *
     * A property of the wire format and nothing else. It is a real plausibility bound — an
     * overflowing decode falls outside it — and it makes no claim whatever about what a
     * particular sensor can physically measure.
     */
    val rawMin: Double get() = when {
        isFloat -> -FLOAT_BOUND
        signed -> -Math.pow(2.0, (bits - 1).toDouble())
        else -> 0.0
    }

    val rawMax: Double get() = when {
        isFloat -> FLOAT_BOUND
        signed -> Math.pow(2.0, (bits - 1).toDouble()) - 1
        else -> Math.pow(2.0, bits.toDouble()) - 1
    }

    companion object {
        /** IEEE-754's own range is useless as a bound, so floats get an arbitrary sane cap. */
        private const val FLOAT_BOUND = 1e9

        private val SIGNED = setOf(SINT8, SINT12, SINT16, SINT24, SINT32, SINT48, SINT64)
        private val BY_CODE = entries.associateBy { it.code }
        fun of(code: Int): GattFormat? = BY_CODE[code]
    }
}

/**
 * The `0x2904` Characteristic Presentation Format descriptor: seven bytes in which a device
 * states its own width, scale and unit.
 *
 * **This is the difference between reading a specification and guessing at one.** Where it is
 * present, Wright has no inference to do — see the design §6. Where it is absent, it has all of
 * it to do.
 */
data class PresentationFormat(
    val format: GattFormat,
    /** Signed base-10 exponent. -2 means the wire value is in hundredths. */
    val exponent: Int,
    /** The raw 16-bit SIG unit code, kept so an unrecognised one stays recoverable. */
    val unitCode: Int,
) {
    /**
     * The unit as a person would write it, or null when this code is not in [UNITS].
     *
     * Null is the honest answer and it is load-bearing: the design's §4 conditional refuses to
     * emit a driver without a unit, so an unrecognised code stops a driver rather than
     * decorating a sealed record with a plausible wrong one.
     */
    val unit: String? get() = UNITS[unitCode]

    /**
     * A frame to a number, using only what the device declared.
     *
     * Null for a frame narrower than the declared format. Decoding four bytes as a sint32 when
     * three arrived means inventing the fourth, and the result is a number indistinguishable
     * from a real one — see [Driver.decode] on why that is the worst available outcome.
     */
    fun decode(raw: ByteArray): Double? {
        if (raw.size < format.width) return null
        val value = when (format) {
            GattFormat.FLOAT32 ->
                ByteBuffer.wrap(raw, 0, 4).order(ByteOrder.LITTLE_ENDIAN).float.toDouble()
            GattFormat.FLOAT64 ->
                ByteBuffer.wrap(raw, 0, 8).order(ByteOrder.LITTLE_ENDIAN).double
            else -> integer(raw)
        }
        return value * scale
    }

    /** Little-endian integer of [GattFormat.width] bytes, sign-extended when the format says so. */
    private fun integer(raw: ByteArray): Double {
        var acc = 0L
        for (i in format.width - 1 downTo 0) acc = (acc shl 8) or (raw[i].toLong() and 0xFF)
        if (!format.signed) {
            // A 64-bit unsigned value with its top bit set overflows Long into a negative.
            return acc.toULong().toDouble()
        }
        // From the top of the FORMAT, not the top of the byte width. sint12 occupies two
        // bytes and signs from bit 11; extending from bit 15 turns -100 into +3996, which is
        // in range, plausible, and wrong.
        val bits = format.bits
        if (bits < 64 && acc and (1L shl (bits - 1)) != 0L) acc -= (1L shl bits)
        return acc.toDouble()
    }

    /** Multiplier the wire value carries, from the declared exponent. */
    val scale: Double get() = Math.pow(10.0, exponent.toDouble())

    companion object {
        const val LENGTH = 7

        /**
         * A deliberately partial table of Bluetooth SIG unit codes.
         *
         * Partial because a wrong entry here is worse than a missing one: a missing code
         * surfaces as null and stops a driver, while a wrong one puts a confident, incorrect
         * unit on a sealed record — the precise failure this product exists to prevent. Add a
         * code only against the published assigned-numbers list, never from memory.
         *
         * `0x2700` (unitless) is intentionally absent rather than mapped to an empty string: a
         * characteristic that declares itself unitless is not carrying a measurement, and the
         * caller should treat it exactly as it treats an unknown code.
         */
        private val UNITS: Map<Int, String> = mapOf(
            0x2701 to "m",
            0x2702 to "kg",
            0x2703 to "s",
            0x2704 to "A",
            0x2705 to "K",
            0x2712 to "m/s",
            0x2713 to "m/s²",
            0x2722 to "Hz",
            0x2723 to "N",
            0x2724 to "Pa",
            0x2725 to "J",
            0x2726 to "W",
            0x2728 to "V",
            0x272F to "°C",
            0x27AD to "%",
        )

        /**
         * Seven bytes to a format, or null.
         *
         * Null for anything short — a truncated descriptor padded with assumptions produces a
         * confident wrong encoding — and null for any format code that does not name a number.
         */
        fun parse(raw: ByteArray): PresentationFormat? {
            if (raw.size < LENGTH) return null
            val format = GattFormat.of(raw[0].toInt() and 0xFF) ?: return null
            return PresentationFormat(
                format = format,
                // Byte is already signed in Kotlin: 0xFE is -2, which is the whole point.
                exponent = raw[1].toInt(),
                unitCode = (raw[2].toInt() and 0xFF) or ((raw[3].toInt() and 0xFF) shl 8),
            )
        }
    }
}

enum class GattProperty { READ, WRITE, WRITE_NO_RESPONSE, NOTIFY, INDICATE }

/**
 * One characteristic, with the two descriptors that carry meaning and are almost never read.
 */
data class GattCharacteristic(
    val uuid: UUID,
    val properties: Set<GattProperty>,
    /** `0x2901`, the device's own words for what this is. Free context, usually absent. */
    val userDescription: String?,
    /** `0x2904`. Present means the encoding is stated and does not have to be inferred. */
    val presentationFormat: PresentationFormat?,
) {
    val readable: Boolean get() = GattProperty.READ in properties
    val subscribable: Boolean
        get() = GattProperty.NOTIFY in properties || GattProperty.INDICATE in properties

    /**
     * Readable, decodes to a plausible number, and is not a measurement.
     *
     * Battery level is the canonical case: a uint8 of 87 looks exactly like a reading, and it
     * is enumerated before the vendor characteristic on a great many devices. Taking it is the
     * defect in `InstrumentClient.fallbackDriver` that Wright exists to not repeat.
     */
    val likelyDecoy: Boolean get() = uuid in DECOYS

    companion object {
        /**
         * Characteristics that are readable and are never a reading: battery level, everything
         * in Device Information, and the Generic Access housekeeping.
         *
         * This is a denylist and therefore incomplete by construction — it cannot know a
         * vendor's own status characteristic. It removes the cases that are both well-known and
         * overwhelmingly common, which is the whole of the value available at this layer; the
         * rest is Wright's judgement, and the tracking gate in design §7 is what catches what
         * gets past both.
         */
        private val DECOYS: Set<UUID> = setOf(
            0x2A19,                                     // battery level
            0x2A23, 0x2A24, 0x2A25, 0x2A26, 0x2A27,     // device information
            0x2A28, 0x2A29, 0x2A2A, 0x2A50,
            0x2A00, 0x2A01, 0x2A04, 0x2A05,             // generic access / attribute
            // Found ranking as candidates against a real device, 2026-08-20. The clock
            // decodes cleanly AND changes constantly, so it survives a plausibility check and
            // a naive does-it-move check alike. It lost by enumeration order alone.
            0x2A2B, 0x2A0F, 0x2A08,                     // current time, local time, date time
            0x2A07,                                     // transmit power level
        ).map(::sig).toSet()
    }
}

data class GattService(val uuid: UUID, val characteristics: List<GattCharacteristic>) {
    val infrastructure: Boolean get() = uuid in INFRASTRUCTURE

    companion object {
        /** Services that exist to describe the device rather than to measure anything. */
        private val INFRASTRUCTURE: Set<UUID> = setOf(
            0x1800,   // generic access
            0x1801,   // generic attribute
            0x180A,   // device information
            0x180F,   // battery
            0x1804,   // transmit power
            0x1805,   // current time
            0x1806,   // next DST change
            0x1807,   // reference time update
        ).map(::sig).toSet()
    }
}

/** One characteristic worth reading, and the service it was found under. */
data class Candidate(val service: GattService, val characteristic: GattCharacteristic)

/**
 * Everything a device exposes, as enumerated over the proxy.
 */
data class GattTree(val services: List<GattService>) {

    /**
     * The characteristics that could plausibly carry a reading, best evidence first.
     *
     * Two rules, and they are the whole of §2's defect 2:
     *
     * 1. **Exclude what cannot be a reading** — infrastructure services and known decoys. Not
     *    "take the first one and hope".
     * 2. **Prefer a declared encoding to one that must be inferred.** A characteristic carrying
     *    a `0x2904` descriptor has stated its width, scale and unit; one without it is a guess
     *    waiting to happen. Offering the declared one first is the same ordering the Wright
     *    turn contract states, applied before a model is ever called.
     */
    fun readingCandidates(): List<Candidate> =
        services.asSequence()
            .filterNot { it.infrastructure }
            .flatMap { service -> service.characteristics.map { Candidate(service, it) } }
            .filterNot { it.characteristic.likelyDecoy }
            .filter { it.characteristic.readable || it.characteristic.subscribable }
            .sortedByDescending { it.characteristic.presentationFormat != null }
            .toList()

    /**
     * Every characteristic on the device with the verdict on each, newest question first: not
     * "what did it pick" but "why did the rest lose".
     *
     * Diagnostics, written to the log on connect. At a bench with a phone and an unfamiliar
     * device, a chosen characteristic with no account of the alternatives is the point at which
     * you start guessing — so nothing is allowed to drop out of this list silently.
     */
    fun explain(): List<String> {
        val chosen = readingCandidates().firstOrNull()
        return services.flatMap { service ->
            service.characteristics.map { c ->
                val where = "${service.uuid.head()}/${c.uuid.head()}"
                val props = c.properties
                    .sortedBy { it.name }
                    .joinToString("+") { it.name.lowercase() }
                    .ifEmpty { "no properties" }
                val declared = c.presentationFormat?.let { f ->
                    " declared=${f.format.name.lowercase()}e${f.exponent}" +
                        (f.unit?.let { u -> " $u" } ?: " (unit unresolved)")
                }.orEmpty()
                val verdict = when {
                    chosen?.service?.uuid == service.uuid &&
                        chosen.characteristic.uuid == c.uuid -> "CHOSEN"
                    service.infrastructure -> "skipped, infrastructure service"
                    c.likelyDecoy -> "skipped, known decoy and never a reading"
                    !c.readable && !c.subscribable -> "skipped, neither readable nor subscribable"
                    else -> "candidate, outranked"
                }
                "$where [$props]$declared - $verdict"
            }
        }
    }
}

/** First field of a UUID: enough to identify it in a log line, short enough to scan. */
private fun UUID.head(): String = toString().take(8)
