package ink.warrant.instrument

import android.bluetooth.BluetoothGattCharacteristic
import java.util.UUID

/**
 * The driver contract, from `docs/architecture.md` §5.
 *
 * ```
 * Driver
 *   matches     scan filter — service UUID, name prefix, manufacturer data
 *   produces    kind: measurement · unit · range
 *   read()      raw bytes → { value, unit, tool_id, timestamp, raw }
 * ```
 *
 * NOTHING ABOVE THIS CARES WHICH TOOL IT IS. A `measurement` field knows only that a number
 * arrived from a paired device without passing through a human, and that is the sole property
 * that makes it *measured* rather than typed. A new tool is a driver, not a schema change.
 *
 * This is the seam Wright writes into: point it at an unfamiliar device, it enumerates the
 * GATT services, infers the encoding, and emits one of these.
 */
interface Driver {

    /** Stable identifier for the driver itself, not the device. Goes onto the record. */
    val id: String

    /** Human-facing name, for the pairing screen. */
    val label: String

    /** What this driver produces. The unit is fixed by the driver, never chosen by a person. */
    val produces: Produces

    /** The scan filter. A device matches if any of these is satisfied. */
    val matches: Match

    /**
     * Which characteristic on a connected device this driver reads. Returning null means "this
     * device advertised the right thing but does not actually expose the characteristic", which
     * is a real and common failure and must not be confused with a zero reading.
     */
    fun characteristicFor(services: List<UUID>): CharacteristicRef?

    /**
     * Raw bytes to a value. The one place a wire format is understood.
     *
     * Returning null means "these bytes are not a reading" — a keep-alive, a status frame, a
     * truncated packet. A driver that guesses here produces a plausible number from nonsense,
     * which is the single worst thing it could do.
     */
    fun decode(raw: ByteArray): Double?
}

data class Produces(
    val unit: String,
    /** Plausible range. Outside it, the reading is reported but flagged — see [Driver.decode]. */
    val min: Double,
    val max: Double,
)

data class Match(
    val serviceUuids: List<UUID> = emptyList(),
    val namePrefixes: List<String> = emptyList(),
)

data class CharacteristicRef(val service: UUID, val characteristic: UUID)

/**
 * Whether a value is inside what this driver claims it can produce.
 *
 * This is a PLAUSIBILITY check and nothing more. It will not catch a wrong scale factor that
 * yields a sensible-looking number — see architecture.md §5, which chooses this deliberately
 * over the aviation route of certified tooling and formal verification. Good enough, cheap, and
 * honest about which it is.
 */
fun Produces.plausible(value: Double): Boolean = value in min..max

/** Convenience for the 16-bit Bluetooth SIG UUIDs, which are all offsets into one base. */
fun sig(short: Int): UUID =
    UUID.fromString(String.format("%08x-0000-1000-8000-00805f9b34fb", short))

internal fun BluetoothGattCharacteristic.supportsNotify(): Boolean =
    properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0

internal fun BluetoothGattCharacteristic.supportsRead(): Boolean =
    properties and BluetoothGattCharacteristic.PROPERTY_READ != 0
