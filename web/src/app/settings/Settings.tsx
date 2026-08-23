"use client";

// Settings, kept honest.
//
// Only things that are actually settable appear here. A product of this kind accumulates a
// settings screen full of switches that do nothing long before it accumulates the features they
// pretend to configure, and on a product whose entire claim is *the record means what it says*,
// a decorative toggle is worse than a missing one.
//
// The Kotlin twin is android/…/ui/settings/SettingsScreen.kt.

import Link from "next/link";
import { useMemo } from "react";
import { HoldBanner, Rule } from "@/components";
import { getDataSource } from "@/data";
import { useInstrument } from "@/instrument/session";
import { useSession } from "@/auth/session-context";
import { tenantLabel } from "../shell/AppShell";

export function Settings() {
  const inst = useInstrument();
  const { session, configured } = useSession();
  const source = useMemo(() => getDataSource(), []);

  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="eyebrow">Settings</p>
        <h1 className="hero">Settings</h1>
      </div>

      <div className="stack">
        <p className="gallery__label">Instrument</p>
        <p className="settings__value">
          {inst.simulated
            ? "A simulated instrument is attached."
            : inst.connected
              ? inst.driver?.label ?? "Paired, driver unknown"
              : "Nothing paired."}
        </p>
        <div className="gate__actions">
          <Link className="w-btn w-btn--ghost" href="/instruments">
            {inst.connected ? "Instrument settings" : "Pair an instrument"}
          </Link>
        </div>
      </div>

      <Rule />

      <div className="stack">
        <p className="gallery__label">Simulation</p>
        <p className="settings__note">
          A simulated instrument lets the flow be walked without hardware. It does not raise the
          ceiling — a generated number can never seal as measured, which is the one rule this
          product will not bend for a demo.
        </p>
        <div className="gate__actions">
          <button
            type="button"
            className="w-btn w-btn--ghost"
            onClick={() => (inst.simulated ? inst.disconnect() : inst.simulate())}
          >
            {inst.simulated ? "Stop simulating" : "Simulate an instrument"}
          </button>
        </div>
      </div>

      <Rule />

      <div className="stack">
        <p className="gallery__label">Account</p>
        <p className="settings__value">
          {session ? tenantLabel(session.tenant) : "Not signed in."}
        </p>
        <p className="settings__note">
          {session
            ? "Your account decides which tenant your procedures, jobs and records belong to."
            : "Running a procedure needs no account. Anything that belongs to somebody does."}
        </p>
        <div className="gate__actions">
          <Link className="w-btn w-btn--ghost" href="/account">
            {session ? "Account" : "Sign in"}
          </Link>
        </div>
      </div>

      <Rule />

      <div className="stack">
        <p className="gallery__label">Data</p>
        <p className="settings__value w-mono">source: {source.name}</p>
        <p className="settings__value w-mono">
          auth: {configured ? "firebase project connected" : "no project connected"}
        </p>
        {source.fabricated && (
          <HoldBanner kind="fixture" title="Fixture data">
            This build has no backend. Procedures are bundled, and jobs and records live only as
            long as the tab does.
          </HoldBanner>
        )}
      </div>
    </div>
  );
}
