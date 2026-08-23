// The drivers that ship in the box, on the web.
//
// The Kotlin twin is android/…/instrument/Drivers.kt, and this is the same three-driver spread
// for the same reason: one for the reference instrument we built, one for a standard profile
// any conforming device exposes, and one that reads a device nobody wrote a driver for.
// Together they demonstrate that the layer above does not change when the tool does.
//
// NOTHING ABOVE THIS FILE CARES WHICH TOOL IT IS. A `measurement` field knows only that a
// number arrived from a paired device without passing through a human, and that is the sole
// property that makes it *measured* rather than typed. A new tool is a driver, not a schema
// change — see docs/architecture.md §5.

/** Convenience for the 16-bit Bluetooth SIG UUIDs, which are all offsets into one base. */
export function sig(short: number): string {
  return `${short.toString(16).padStart(8, "0")}-0000-1000-8000-00805f9b34fb`;
}

export interface Produces {
  unit: string;
  /** Plausible range. Outside it, the reading is reported but flagged. */
  min: number;
  max: number;
}

export interface Driver {
  /** Stable identifier for the driver itself, not the device. Goes onto the record. */
  readonly id: string;
  /** Human-facing name, for the pairing screen. */
  readonly label: string;
  /** What this driver produces. The unit is fixed by the driver, never chosen by a person. */
  readonly produces: Produces;
  /** The service this driver asks the browser's device chooser to filter on. */
  readonly service: string;
  /** The characteristic it reads once connected. */
  readonly characteristic: string;
  /** Names this driver also answers to, for devices that advertise no service uuid. */
  readonly namePrefixes: readonly string[];
  /**
   * Raw bytes to a value. The one place a wire format is understood.
   *
   * Returning null means "these bytes are not a reading" — a keep-alive, a status frame, a
   * truncated packet. A driver that guesses here produces a plausible number from nonsense,
   * which is the single worst thing it could do.
   */
  decode(raw: DataView): number | null;
}

/**
 * The reference instrument: an ESP32 advertising a GATT characteristic, paired to the browser,
 * filling a `measurement` field in a live form.
 *
 * WHAT IT MEASURES IS IRRELEVANT. It exists to prove the path end to end and to make the
 * abstraction concrete: any device speaking this contract works, whether it is a commercial
 * torque wrench, a gauge, a reader, or something you built for four dollars.
 *
 * The UUIDs below are the ones `firmware/warrant_reference_instrument.ino` advertises. If you
 * flash different ones, change them in both places or use the generic driver.
 */
export const Esp32ReferenceDriver: Driver = {
  id: "warrant-esp32-ref@1",
  label: "Warrant reference instrument",
  // Torque, because the demo procedure torques a caliper bolt. The ESP32 is not a torque
  // wrench and the record does not pretend it is — see architecture.md §12.
  produces: { unit: "Nm", min: 0, max: 200 },
  service: "6e1a0001-b5a3-f393-e0a9-e50e24dcca9e",
  characteristic: "6e1a0002-b5a3-f393-e0a9-e50e24dcca9e",
  namePrefixes: ["Warrant"],
  /** Little-endian IEEE-754 float, four bytes. What the reference firmware writes. */
  decode(raw) {
    if (raw.byteLength < 4) return null;
    return raw.getFloat32(0, true);
  },
};

/**
 * The Bluetooth SIG Environmental Sensing service. Any conforming sensor exposes it, and no
 * code of ours had to be written for that particular vendor — which is the point.
 */
export const EnvironmentalSensingDriver: Driver = {
  id: "ble-sig-environmental@1",
  label: "Environmental sensor (BLE standard)",
  produces: { unit: "°C", min: -40, max: 125 },
  service: sig(0x181a),
  characteristic: sig(0x2a6e),
  namePrefixes: [],
  /** sint16, in hundredths of a degree. Specified by the profile, not guessed. */
  decode(raw) {
    if (raw.byteLength < 2) return null;
    return raw.getInt16(0, true) / 100;
  },
};

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
export function genericGattDriver(service: string, characteristic: string): Driver {
  return {
    id: "generic-gatt@1",
    label: "Unrecognised device (generic read)",
    produces: { unit: "", min: -1e9, max: 1e9 },
    service,
    characteristic,
    namePrefixes: [],
    decode(raw) {
      if (raw.byteLength >= 4) return raw.getFloat32(0, true);
      if (raw.byteLength >= 2) return raw.getInt16(0, true);
      if (raw.byteLength === 1) return raw.getInt8(0);
      return null;
    },
  };
}

/**
 * No hardware, and honest about it.
 *
 * The product must be demonstrable with nothing paired, but a fake reading must never be able
 * to reach a sealed record as `measured`. So this driver exists and produces values, and every
 * surface that shows one marks it — its tool id starts with `fake-`, which the Seal refuses.
 */
export const TOOL_ID_PREFIX_FAKE = "fake-";

export const FakeDriver: Driver = {
  id: "fake@1",
  label: "Simulated instrument (no hardware)",
  produces: { unit: "Nm", min: 26, max: 30 },
  service: "",
  characteristic: "",
  namePrefixes: [],
  decode: () => null,
};

/** A value inside the demo procedure's acceptance band, with a little jitter. */
export function fakeSample(): number {
  return 28.4 + ((Date.now() % 7) - 3) / 10;
}

/** The vetted drivers, in the order a device is matched against them. */
export const DRIVERS: readonly Driver[] = [Esp32ReferenceDriver, EnvironmentalSensingDriver];

/** Whether a value is inside what this driver claims it can produce. */
export function plausible(produces: Produces, value: number): boolean {
  return value >= produces.min && value <= produces.max;
}
