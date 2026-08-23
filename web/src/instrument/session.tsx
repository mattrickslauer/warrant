"use client";

// The paired instrument, for as long as it stays paired.
//
// One per tab, held above the router so a technician pairs a tool once and then walks through
// several steps and several jobs with it in their hand. The connection outliving any one screen
// is exactly the thing a per-screen hook gets wrong — and it is why this is a context provider
// mounted in the root layout rather than state inside /instruments.
//
// The Kotlin twin is android/…/instrument/InstrumentSession.kt. The state machine below is the
// same five links for the same reasons; only the transport differs, because the browser's
// device chooser does the scanning that Android does in-process.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import {
  DRIVERS, FakeDriver, TOOL_ID_PREFIX_FAKE, fakeSample, genericGattDriver, plausible,
  type Driver,
} from "./drivers";

export type Tier = "open" | "attested" | "instrumented";

export interface Reading {
  value: number;
  unit: string;
  toolId: string;
  /** False when the value is outside what the driver claims it can produce. */
  plausible: boolean;
  driverId: string;
  at: string;
}

/**
 * Where the connection has got to, as ONE value rather than several that can disagree.
 *
 * This was three loose fields — `connecting`, `toolId`, `error` — which made it impossible to
 * show progress against the thing the technician actually clicked, and impossible to tell a
 * refusal apart from an ordinary disconnect. Both of those are things a person standing at a
 * bench needs to see.
 */
export type Link =
  /** Nothing attempted, or disconnected cleanly. */
  | { kind: "idle" }
  /** In flight. The device name is carried so the row that was clicked can show it. */
  | { kind: "connecting"; name: string | null }
  /** Attached and reading. */
  | { kind: "paired"; deviceId: string; name: string | null; toolId: string; driver: Driver }
  /** The attempt finished and did not pair. The reason is the whole point of the state. */
  | { kind: "rejected"; name: string | null; reason: string }
  /** No hardware; generated values. Never raises the tier — see tierOf(). */
  | { kind: "simulated"; toolId: string };

export interface InstrumentState {
  link: Link;
  latest: Reading | null;
}

export interface InstrumentSession extends InstrumentState {
  /** True when this browser can reach an instrument by any route at all. */
  readonly supported: boolean;
  /**
   * True when it can reach one THE WAY THIS PAGE OFFERS TO.
   *
   * Distinct from `supported` on purpose: a browser can expose WebUSB and Web Serial and still
   * have no Web Bluetooth — every headless Chrome does, and so does Chrome on iOS. Gating the
   * pair button on `supported` there offers a control whose only possible outcome is the
   * refusal banner.
   */
  readonly bluetooth: boolean;
  /** Which transports this browser exposes, for the sentence that explains `supported`. */
  readonly transports: string[];
  readonly connecting: boolean;
  readonly connected: boolean;
  /**
   * True when readings are simulated because no hardware is paired. Every surface that shows a
   * simulated value MUST say so.
   */
  readonly simulated: boolean;
  readonly toolId: string | null;
  readonly driver: Driver | null;
  /** The refusal, if the last attempt was refused. */
  readonly error: string | null;
  pair(): Promise<void>;
  simulate(): void;
  disconnect(): void;
}

const Ctx = createContext<InstrumentSession | null>(null);

// The generic-access services, which every device exposes and none of them measures anything
// with. A generic driver that grabbed one of these would read a device name and call it a
// measurement.
const GENERIC_ACCESS = new Set([
  "00001800-0000-1000-8000-00805f9b34fb",
  "00001801-0000-1000-8000-00805f9b34fb",
  "0000180a-0000-1000-8000-00805f9b34fb",
]);

function bluetooth(): Bluetooth | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth ?? null;
}

function transportsOf(): string[] {
  if (typeof navigator === "undefined") return [];
  const n = navigator as Navigator & { bluetooth?: unknown; usb?: unknown; serial?: unknown };
  return [
    n.bluetooth ? "Bluetooth" : null,
    n.usb ? "USB" : null,
    n.serial ? "Serial" : null,
  ].filter((x): x is string => x !== null);
}

export function InstrumentProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<InstrumentState>({ link: { kind: "idle" }, latest: null });
  const [transports, setTransports] = useState<string[]>([]);
  const device = useRef<BluetoothDevice | null>(null);

  // Feature detection runs after mount, never during render: the server has no navigator, and a
  // component that renders "unsupported" on the server and "supported" in the browser is a
  // hydration mismatch that React resolves by keeping the wrong one.
  useEffect(() => { setTransports(transportsOf()); }, []);

  const disconnect = useCallback(() => {
    try { device.current?.gatt?.disconnect(); } catch { /* already gone */ }
    device.current = null;
    setState({ link: { kind: "idle" }, latest: null });
  }, []);

  /**
   * Pair over Web Bluetooth.
   *
   * The browser owns the scan: `requestDevice` shows the chooser, and nothing reaches this code
   * until a human has picked a device. That is a stricter consent model than Android's, and it
   * is why there is no device list on the pairing page — the list is the browser's.
   */
  const pair = useCallback(async () => {
    const ble = bluetooth();
    if (!ble) {
      setState({
        link: {
          kind: "rejected",
          name: null,
          reason: "This browser cannot reach a Bluetooth instrument. Chrome or Edge on " +
            "desktop or Android can; Safari and Firefox do not implement Web Bluetooth.",
        },
        latest: null,
      });
      return;
    }

    setState({ link: { kind: "connecting", name: null }, latest: null });

    let chosen: BluetoothDevice;
    try {
      chosen = await ble.requestDevice({
        filters: [
          ...DRIVERS.map((d) => ({ services: [d.service] })),
          ...DRIVERS.flatMap((d) => d.namePrefixes.map((namePrefix) => ({ namePrefix }))),
        ],
        optionalServices: DRIVERS.map((d) => d.service),
      });
    } catch (e) {
      // A dismissed chooser is not a failure and must not be reported as one — the person
      // changed their mind, which is a thing they are allowed to do.
      const err = e as { name?: string; message?: string };
      if (err.name === "NotFoundError") {
        setState({ link: { kind: "idle" }, latest: null });
        return;
      }
      setState({
        link: { kind: "rejected", name: null, reason: err.message ?? "The chooser failed." },
        latest: null,
      });
      return;
    }

    const name = chosen.name ?? null;
    setState({ link: { kind: "connecting", name }, latest: null });

    try {
      const server = await chosen.gatt?.connect();
      if (!server) throw new Error("This device exposed no GATT server.");

      const services = await server.getPrimaryServices();
      const uuids = services.map((s) => s.uuid.toLowerCase());

      // A vetted driver first. Only when none claims the device does the generic one guess,
      // and when it does, its id says so on every reading it produces.
      let driver = DRIVERS.find((d) => uuids.includes(d.service.toLowerCase())) ?? null;
      let characteristic: BluetoothRemoteGATTCharacteristic | null = null;

      if (driver) {
        characteristic = await server
          .getPrimaryService(driver.service)
          .then((s) => s.getCharacteristic(driver!.characteristic));
      } else {
        for (const service of services) {
          if (GENERIC_ACCESS.has(service.uuid.toLowerCase())) continue;
          const chars = await service.getCharacteristics().catch(() => []);
          const usable = chars.find((c) => c.properties.notify || c.properties.read);
          if (usable) {
            driver = genericGattDriver(service.uuid, usable.uuid);
            characteristic = usable;
            break;
          }
        }
      }

      if (!driver || !characteristic) {
        // Advertised the right thing, does not actually expose the characteristic. A real and
        // common failure, and it must not be confused with a zero reading.
        throw new Error("Connected, but this device exposes no readable characteristic.");
      }

      const toolId = `${driver.id.split("@")[0]}:${chosen.id.slice(0, 12)}`;
      const d = driver;

      const onValue = (event: Event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        const raw = target.value;
        if (!raw) return;
        const value = d.decode(raw);
        if (value === null) return; // not a reading — a keep-alive, a status frame
        setState((prev) => ({
          ...prev,
          latest: {
            value,
            unit: d.produces.unit,
            toolId,
            plausible: plausible(d.produces, value),
            driverId: d.id,
            at: new Date().toISOString(),
          },
        }));
      };

      characteristic.addEventListener("characteristicvaluechanged", onValue);
      if (characteristic.properties.notify) {
        await characteristic.startNotifications();
      } else {
        await characteristic.readValue();
      }

      chosen.addEventListener("gattserverdisconnected", () => {
        device.current = null;
        setState({ link: { kind: "idle" }, latest: null });
      });

      device.current = chosen;
      setState({ link: { kind: "paired", deviceId: chosen.id, name, toolId, driver: d }, latest: null });
    } catch (e) {
      try { chosen.gatt?.disconnect(); } catch { /* already gone */ }
      setState({
        link: { kind: "rejected", name, reason: (e as Error).message ?? "The connection failed." },
        latest: null,
      });
    }
  }, []);

  /**
   * Simulated readings, for demonstrating the flow with no hardware on the bench.
   *
   * The tool id is prefixed `fake-` and `simulated` is set, and both travel with the value
   * everywhere it goes. A simulated reading must never be able to pass itself off as a
   * measurement — that would forge exactly the evidence this system exists to make checkable.
   */
  const simulate = useCallback(() => {
    disconnect();
    const toolId = `${TOOL_ID_PREFIX_FAKE}sim`;
    setState({
      link: { kind: "simulated", toolId },
      latest: {
        value: fakeSample(),
        unit: FakeDriver.produces.unit,
        toolId,
        plausible: true,
        driverId: FakeDriver.id,
        at: new Date().toISOString(),
      },
    });
  }, [disconnect]);

  const value = useMemo<InstrumentSession>(() => {
    const { link } = state;
    return {
      ...state,
      supported: transports.length > 0,
      bluetooth: transports.includes("Bluetooth"),
      transports,
      connecting: link.kind === "connecting",
      connected: link.kind === "paired" || link.kind === "simulated",
      simulated: link.kind === "simulated",
      toolId: link.kind === "paired" || link.kind === "simulated" ? link.toolId : null,
      driver: link.kind === "paired" ? link.driver : link.kind === "simulated" ? FakeDriver : null,
      error: link.kind === "rejected" ? link.reason : null,
      pair,
      simulate,
      disconnect,
    };
  }, [state, transports, pair, simulate, disconnect]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInstrument(): InstrumentSession {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useInstrument must be used inside <InstrumentProvider>.");
  return ctx;
}

/**
 * The tier this surface can actually reach right now.
 *
 * Derived, never set. And a SIMULATED instrument deliberately does not raise it: a generated
 * number must never reach a record as measured, no matter how convenient that would be during a
 * demo. This lives at the top level because several screens have to agree on the answer, and
 * three copies of a rule is three chances to break the one rule the product is about.
 *
 * A browser is `open` and not `attested`: attestation is what the installed app adds, and a web
 * page cannot claim it. Pairing an instrument in a browser jumps straight from open to
 * instrumented, because the reading's provenance comes from the device, not from the surface.
 */
export function tierOf(state: Pick<InstrumentState, "link">): Tier {
  return state.link.kind === "paired" ? "instrumented" : "open";
}
