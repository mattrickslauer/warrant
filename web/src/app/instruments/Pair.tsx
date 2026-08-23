"use client";

// Pairing.
//
// The browser owns the scan — `requestDevice` puts up the chooser and nothing reaches our code
// until a human has picked something — so where android lists every device in range, this page
// lists every DRIVER instead. A technician holding an unfamiliar tool still gets the answer
// android gives them ("nothing here reads that"), and it is still the listing Wright works from.

import Link from "next/link";
import { EvidenceChip, HoldBanner, ReadingBadge, Rule } from "@/components";
import { CLASS_BY_TIER } from "@/data/source";
import { DRIVERS, FakeDriver } from "@/instrument/drivers";
import { tierOf, useInstrument } from "@/instrument/session";

export function Pair() {
  const inst = useInstrument();
  const tier = tierOf(inst);

  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="eyebrow">Instrument</p>
        <h1 className="hero">Pair an instrument</h1>
        <p className="lede">
          A number that arrives from a paired device, without passing through a human, is the
          only kind this system will call measured.
        </p>
      </div>

      {/* What the surface can reach, stated where it can be changed. It used to sit on the
          picker, where it was a paragraph you read once and could do nothing about. */}
      <div className="stack">
        <p className="gallery__label">This surface can reach</p>
        <div className="gallery__row">
          {CLASS_BY_TIER[tier].map((c) => <EvidenceChip key={c} cls={c} />)}
          {tier !== "instrumented" && <EvidenceChip cls="measured" out />}
        </div>
        <p className="pair__why">
          {tier === "instrumented"
            ? "An instrument is paired, so a measured value is obtainable."
            : inst.connected
              // Connected, but to a simulation. The tier deliberately does NOT rise: a
              // fabricated reading must never reach a record as measured.
              ? "A simulated instrument is attached. It does not raise the ceiling — a " +
                "generated reading cannot seal as measured."
              : inst.bluetooth
                ? `Nothing is paired. This browser could pair over ${inst.transports.join(" · ")}.`
                : inst.supported
                  // Has a transport, but not the one this page offers. Saying "could pair over
                  // USB · Serial" next to a dead Bluetooth button is worse than saying nothing.
                  ? `Nothing is paired. This browser exposes ${inst.transports.join(" · ")}, but ` +
                    "not Web Bluetooth, which is the route this page pairs over."
                  : "This browser cannot reach an instrument at all. Chrome or Edge, on desktop " +
                    "or Android, implement Web Bluetooth; Safari and Firefox do not."}
        </p>
      </div>

      <Rule />

      <LinkState />

      <div className="stack">
        <p className="gallery__label">Drivers in this build</p>
        <p className="pair__why">
          Three, and the spread is the argument: one for the reference instrument we built, one
          for a standard profile any conforming device exposes, and one that reads a device
          nobody wrote a driver for. Nothing above this layer changes when the tool does.
        </p>
        <ul className="drivers">
          {DRIVERS.map((d) => (
            <li className="driver" key={d.id}>
              <span className="driver__label">{d.label}</span>
              <span className="driver__id w-mono">{d.id}</span>
              <span className="driver__produces w-mono">
                {d.produces.unit || "unitless"} · {d.produces.min}–{d.produces.max}
              </span>
            </li>
          ))}
          <li className="driver driver--generic">
            <span className="driver__label">Unrecognised device (generic read)</span>
            <span className="driver__id w-mono">generic-gatt@1</span>
            <span className="driver__produces">
              a guess, and labelled as one on every reading it produces
            </span>
          </li>
        </ul>
        <p className="pair__why">
          The generic slot is the one Wright fills properly: enumerate the services, read the
          public spec, infer the encoding, emit a real driver, test it against the live device.
        </p>
      </div>

      <Rule />

      <div className="stack">
        <p className="gallery__label">Simulation</p>
        <p className="pair__why">
          A simulated instrument lets the flow be walked without hardware. It does not raise the
          ceiling — a generated number can never seal as measured, which is the one rule this
          product will not bend for a demo. Its tool id starts <span className="w-mono">fake-</span>,
          and the Seal refuses it.
        </p>
        <div className="gate__actions">
          <button
            type="button"
            className="w-btn w-btn--ghost"
            onClick={() => (inst.simulated ? inst.disconnect() : inst.simulate())}
          >
            {inst.simulated ? "Stop simulating" : "Simulate an instrument"}
          </button>
          <Link className="w-btn w-btn--text" href="/firmware">Build the reference instrument</Link>
        </div>
      </div>
    </div>
  );
}

/** Where the connection got to, and — when it did not get there — why. */
function LinkState() {
  const inst = useInstrument();
  const { link } = inst;

  return (
    <div className="stack">
      <p className="gallery__label">Connection</p>

      {link.kind === "idle" && (
        <p className="pair__why">Nothing paired.</p>
      )}

      {link.kind === "connecting" && (
        <p className="pair__why" aria-live="polite">
          Connecting{link.name ? ` to ${link.name}` : ""}…
        </p>
      )}

      {link.kind === "rejected" && (
        <HoldBanner title={link.name ? `${link.name} refused` : "Pairing failed"}>
          {link.reason}
        </HoldBanner>
      )}

      {link.kind === "paired" && (
        <div className="stack">
          <p className="pair__paired">{link.name ?? "Paired device"}</p>
          <p className="pair__why w-mono">
            {link.driver.label} · {link.toolId}
          </p>
        </div>
      )}

      {link.kind === "simulated" && (
        <HoldBanner kind="fixture" title="Simulated, not measured">
          {FakeDriver.label}. Readings are generated here, carry the tool id{" "}
          <span className="w-mono">{link.toolId}</span>, and cannot seal as measured.
        </HoldBanner>
      )}

      {inst.latest && (
        <ReadingBadge
          value={inst.latest.value}
          unit={inst.latest.unit}
          at={inst.latest.at}
          toolId={inst.latest.toolId}
        />
      )}

      <div className="gate__actions">
        <button
          type="button"
          className="w-btn"
          disabled={inst.connecting || !inst.bluetooth}
          onClick={() => void inst.pair()}
        >
          {inst.connecting
            ? "Waiting for the chooser…"
            : inst.bluetooth ? "Pair over Bluetooth" : "No Web Bluetooth in this browser"}
        </button>
        {inst.connected && (
          <button type="button" className="w-btn w-btn--ghost" onClick={() => inst.disconnect()}>
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
