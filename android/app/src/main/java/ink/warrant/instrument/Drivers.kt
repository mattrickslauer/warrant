package ink.warrant.instrument

import ink.warrant.contract.FieldDef
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

/**
 * The drivers that ship in the box.
 *
 * There are three, and the spread is the argument: one for the reference instrument we built,
 * one for a standard profile any conforming device exposes, and one that reads a device nobody
 * wrote a driver for. Together they demonstrate that the layer above does not change when the
 * tool does.
 */

/**
 * The reference instrument: an ESP32 advertising a GATT characteristic, paired to the app,
 * filling a `measurement` field in a live form.
 *
 * WHAT IT MEASURES IS IRRELEVANT. It exists to prove the path end to end and to make the
 * abstraction concrete: any device speaking this contract works, whether it is a commercial
 * torque wrench, a gauge, a reader, or something you built for four dollars.
 *
 * The UUIDs below are the ones `firmware/warrant_reference_instrument.ino` advertises. If you
 * flash different ones, change them in both places or use [GenericGattDriver].
 */
object Esp32ReferenceDriver : Driver {
    val SERVICE: UUID = UUID.fromString("6e1a0001-b5a3-f393-e0a9-e50e24dcca9e")
    val CHARACTERISTIC: UUID = UUID.fromString("6e1a0002-b5a3-f393-e0a9-e50e24dcca9e")

    override val id = "warrant-esp32-ref@1"
    override val label = "Warrant reference instrument"

    // Torque, because the demo procedure torques a caliper bolt. The ESP32 is not a torque
    // wrench and the record does not pretend it is — see architecture.md §12.
    override val produces = Produces(unit = "Nm", min = 0.0, max = 200.0)

    override val matches = Match(
        serviceUuids = listOf(SERVICE),
        namePrefixes = listOf("Warrant"),
    )

    override fun characteristicFor(services: List<UUID>): CharacteristicRef? =
        if (SERVICE in services) CharacteristicRef(SERVICE, CHARACTERISTIC) else null

    /** Little-endian IEEE-754 float, four bytes. What the reference firmware writes. */
    override fun decode(raw: ByteArray): Double? {
        if (raw.size < 4) return null
        return ByteBuffer.wrap(raw, 0, 4).order(ByteOrder.LITTLE_ENDIAN).float.toDouble()
    }
}

/**
 * The Bluetooth SIG Environmental Sensing service. Any conforming sensor exposes it, and no
 * code of ours had to be written for that particular vendor — which is the point.
 */
object EnvironmentalSensingDriver : Driver {
    private val SERVICE: UUID = sig(0x181A)
    private val TEMPERATURE: UUID = sig(0x2A6E)

    override val id = "ble-sig-environmental@1"
    override val label = "Environmental sensor (BLE standard)"
    override val produces = Produces(unit = "°C", min = -40.0, max = 125.0)
    override val matches = Match(serviceUuids = listOf(SERVICE))

    override fun characteristicFor(services: List<UUID>): CharacteristicRef? =
        if (SERVICE in services) CharacteristicRef(SERVICE, TEMPERATURE) else null

    /** sint16, in hundredths of a degree. Specified by the profile, not guessed. */
    override fun decode(raw: ByteArray): Double? {
        if (raw.size < 2) return null
        val v = ByteBuffer.wrap(raw, 0, 2).order(ByteOrder.LITTLE_ENDIAN).short
        return v / 100.0
    }
}

/**
 * The last resort, and the honest one.
 *
 * When a device matches nothing, this connects, takes the first readable or notifiable
 * characteristic outside the generic-access services, and decodes it as a little-endian float
 * or 16-bit integer. That is a GUESS, and it is labelled as one everywhere it surfaces: a
 * reading produced by this driver is still `measured` — it genuinely came from a paired device
 * without passing through a human — but the tool id records that no vetted driver claimed it.
 *
 * This is the slot Wright fills properly: enumerate, read the public spec for the service,
 * infer the encoding, emit a real driver, test it against the live device, retry on failure.
 */
class GenericGattDriver(
    private val ref: CharacteristicRef,
    override val produces: Produces = Produces(unit = "", min = -1e9, max = 1e9),
) : Driver {
    override val id = "generic-gatt@1"
    override val label = "Unrecognised device (generic read)"
    override val matches = Match()

    override fun characteristicFor(services: List<UUID>): CharacteristicRef? =
        if (ref.service in services) ref else null

    override fun decode(raw: ByteArray): Double? = when {
        raw.size >= 4 -> ByteBuffer.wrap(raw, 0, 4).order(ByteOrder.LITTLE_ENDIAN).float.toDouble()
        raw.size >= 2 -> ByteBuffer.wrap(raw, 0, 2).order(ByteOrder.LITTLE_ENDIAN).short.toDouble()
        raw.size == 1 -> raw[0].toInt().toDouble()
        else -> null
    }
}

/**
 * No hardware, and honest about it.
 *
 * The app must be demonstrable with nothing paired, but a fake reading must never be able to
 * reach a sealed record as `measured`. So this driver exists and produces values, and every
 * surface that shows one marks it — its tool id starts with `fake-`, which the Seal refuses.
 */
object FakeDriver : Driver {
    const val TOOL_ID_PREFIX = "fake-"

    override val id = "fake@1"
    override val label = "Simulated instrument (no hardware)"

    /**
     * No unit, and a range wide enough to hold any field's.
     *
     * Every other driver's unit is a fact about its hardware, which is exactly why it is fixed
     * here and never chosen by a person. This one has no hardware, so it has no unit of its
     * own; it answers in whatever unit the step it is standing in for declared. Claiming "Nm"
     * here — which it used to — meant a procedure asking for pad thickness on a pair of
     * calipers got a torque reading back, and got it flagged implausible for good measure.
     * See [simulatedReadingFor].
     */
    override val produces = Produces(unit = "", min = -1e9, max = 1e9)
    override val matches = Match()

    override fun characteristicFor(services: List<UUID>): CharacteristicRef? = null

    override fun decode(raw: ByteArray): Double? = null

    /**
     * A reading for [field], in the unit that field declared and inside the band it accepts.
     *
     * Null means no measurement field is in front of us — the pairing screen wants something to
     * show — and the answer is a bare unitless number rather than a confident wrong unit.
     */
    fun sample(field: FieldDef? = null): SimulatedReading =
        simulatedReadingFor(field, System.nanoTime())
}
