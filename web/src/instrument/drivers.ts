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
  /**
   * No unit, and a range wide enough to hold any field's.
   *
   * Every other driver's unit is a fact about its hardware, which is why it is fixed here and
   * never chosen by a person. This one has no hardware, so it has no unit of its own; it answers
   * in whatever unit the step it is standing in for declared. Claiming "Nm" here — which it used
   * to — meant a procedure asking for pad thickness on a pair of calipers got a torque reading
   * back. See `simulatedReadingFor`, and its Kotlin twin in instrument/SimulatedReading.kt.
   */
  produces: { unit: "", min: -1e9, max: 1e9 },
  service: "",
  characteristic: "",
  namePrefixes: [],
  decode: () => null,
};

/**
 * What a simulated instrument reports, for the field it is standing in for.
 *
 * The simulator used to hold ONE number and hand it to whatever asked, so a caliper step got a
 * torque figure in a unit it never mentioned and outside a band it could not satisfy. A real
 * instrument's unit comes from the tool; the simulator has no tool, so it takes the unit from
 * the only other place that legitimately knows one — what the step DECLARED it accepts. That is
 * not cheating the check: the reading still carries the `fake-` tool id and still cannot seal as
 * measured. It just looks like the measurement the step asked for.
 */
export interface SimulatedReading {
  value: number;
  unit: string;
}

/** The subset of a field definition the simulator reads. */
export interface AcceptanceBand {
  acceptance_min?: number | null;
  acceptance_max?: number | null;
  acceptance_unit?: string | null;
}

/**
 * A unit's own idea of scale and resolution.
 *
 * `decimals` is the more important half: calipers read hundredths of a millimetre, a click
 * wrench does not pretend to more than a tenth of a newton-metre, nobody reports 1834.27 rpm.
 * `min`/`max` are reached only when a field declares a unit and no band, which the compiler
 * forbids for `within` but not for the other rules.
 *
 * Matched case-sensitively FIRST, because `Nm` is torque and `nm` is a nanometre.
 */
interface Scale { min: number; max: number; decimals: number }

const SCALES: Readonly<Record<string, Scale>> = {
  // Length, as a workshop measures it.
  "mm": { min: 1, max: 12, decimals: 2 },
  "cm": { min: 1, max: 30, decimals: 1 },
  "m": { min: 0.1, max: 5, decimals: 2 },
  "µm": { min: 10, max: 500, decimals: 0 },
  "um": { min: 10, max: 500, decimals: 0 },
  "nm": { min: 50, max: 2000, decimals: 0 },
  "in": { min: 0.05, max: 2, decimals: 3 },
  "thou": { min: 1, max: 60, decimals: 0 },
  // Torque.
  "Nm": { min: 2, max: 40, decimals: 1 },
  "N·m": { min: 2, max: 40, decimals: 1 },
  "ft-lb": { min: 2, max: 30, decimals: 1 },
  "ft·lb": { min: 2, max: 30, decimals: 1 },
  "lb-ft": { min: 2, max: 30, decimals: 1 },
  "in-lb": { min: 10, max: 200, decimals: 0 },
  // Pressure.
  "psi": { min: 20, max: 45, decimals: 1 },
  "bar": { min: 1.5, max: 3, decimals: 2 },
  "kPa": { min: 150, max: 320, decimals: 0 },
  // Electrical.
  "V": { min: 11, max: 14.5, decimals: 2 },
  "mV": { min: 10, max: 900, decimals: 0 },
  "A": { min: 0.1, max: 20, decimals: 2 },
  "mA": { min: 1, max: 900, decimals: 0 },
  "Ω": { min: 0.1, max: 100, decimals: 2 },
  "ohm": { min: 0.1, max: 100, decimals: 2 },
  "Wh": { min: 50, max: 600, decimals: 0 },
  // Temperature, rotation, the rest.
  "°C": { min: 15, max: 40, decimals: 1 },
  "°F": { min: 60, max: 105, decimals: 1 },
  "rpm": { min: 500, max: 4000, decimals: 0 },
  "Hz": { min: 10, max: 500, decimals: 1 },
  "dB": { min: 40, max: 95, decimals: 1 },
  "%": { min: 20, max: 95, decimals: 0 },
  "kg": { min: 1, max: 50, decimals: 2 },
  "g": { min: 5, max: 900, decimals: 1 },
  "L": { min: 0.5, max: 8, decimals: 2 },
  "mL": { min: 50, max: 900, decimals: 0 },
  "s": { min: 1, max: 60, decimals: 1 },
  "ms": { min: 10, max: 900, decimals: 0 },
};

/** The last resort: no unit, no band, nothing declared. Deliberately unremarkable. */
const UNITLESS: Scale = { min: 0, max: 100, decimals: 2 };

/**
 * The units whose case can safely be ignored, so "RPM" and "Bar" still find their scale.
 *
 * Word-like names only. An SI symbol's case is part of the symbol — `Nm` is torque, `nm` is a
 * nanometre, `S` is siemens and `s` is seconds — and folding those together is the same class of
 * mistake as answering a caliper in newton-metres.
 */
const WORD_UNITS: Readonly<Record<string, Scale>> = Object.fromEntries(
  Object.entries(SCALES)
    .filter(([k]) => k.length >= 3 && /^[a-z]+$/i.test(k))
    .map(([k, v]) => [k.toLowerCase(), v]),
);

function scaleFor(unit: string): Scale | undefined {
  return SCALES[unit] ?? WORD_UNITS[unit.toLowerCase()];
}

/** Resolution inferred from band width, for a unit the table has never heard of. */
function decimalsForSpan(span: number): number {
  if (span <= 0) return 2;
  if (span < 1) return 3;
  if (span < 10) return 2;
  if (span < 100) return 1;
  return 0;
}

/**
 * The window a simulated value is drawn from, in the field's own terms.
 *
 * A two-sided band is used as declared. A one-sided one is opened out on the missing side, so
 * "at least 3 mm" produces something comfortably over three rather than three point nothing — a
 * demo where every reading sits on the limit is a demo that looks rigged.
 */
function windowFor(field: AcceptanceBand | null | undefined): [number, number, number] {
  const unit = (field?.acceptance_unit ?? "").trim();
  const scale = scaleFor(unit);
  const fallback = scale ?? UNITLESS;
  const span = Math.max(fallback.max - fallback.min, 1e-9);
  const lo = Number.isFinite(field?.acceptance_min) ? (field!.acceptance_min as number) : null;
  const hi = Number.isFinite(field?.acceptance_max) ? (field!.acceptance_max as number) : null;

  let from: number;
  let to: number;
  if (lo !== null && hi !== null) {
    // Equal bounds are a target, not a band. Honour it exactly — inventing slop around a stated
    // target would be the lie, not hitting it.
    [from, to] = [lo, hi];
  } else if (lo !== null) {
    [from, to] = [lo, lo + Math.max(span, Math.abs(lo) * 0.5)];
  } else if (hi !== null) {
    const opened = hi - Math.max(span, Math.abs(hi) * 0.5);
    // Thickness, pressure and voltage do not go negative.
    [from, to] = [hi > 0 ? Math.max(0, opened) : opened, hi];
  } else {
    [from, to] = [fallback.min, fallback.max];
  }

  return [from, to, scale?.decimals ?? decimalsForSpan(to - from)];
}

/** A stable pseudo-random fraction in [0, 1). Seeded, so a test can pin the arithmetic. */
function fractionOf(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

/**
 * The reading a simulated instrument should produce for `field`.
 *
 * Lands in the middle 40% of the window, so a demo does not spend its life on the edge of the
 * acceptance band and so consecutive reads move a little, the way a real tool settling does. The
 * result is rounded to the unit's resolution, because a caliper that reports 3.4172 mm is not a
 * caliper.
 */
export function simulatedReadingFor(
  field: AcceptanceBand | null | undefined,
  seed: number,
): SimulatedReading {
  const [lo, hi, decimals] = windowFor(field);
  const value = lo + (hi - lo) * (0.3 + 0.4 * fractionOf(seed));
  const factor = 10 ** decimals;
  return {
    value: Math.round(value * factor) / factor,
    unit: (field?.acceptance_unit ?? "").trim(),
  };
}

/** A reading for the field in front of the technician, in the unit that field declared. */
export function fakeSample(field?: AcceptanceBand | null): SimulatedReading {
  return simulatedReadingFor(field, Date.now());
}

/** The vetted drivers, in the order a device is matched against them. */
export const DRIVERS: readonly Driver[] = [Esp32ReferenceDriver, EnvironmentalSensingDriver];

/** Whether a value is inside what this driver claims it can produce. */
export function plausible(produces: Produces, value: number): boolean {
  return value >= produces.min && value <= produces.max;
}
