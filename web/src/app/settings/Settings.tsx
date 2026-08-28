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
import { useEffect, useMemo, useState } from "react";
import { HoldBanner, Rule } from "@/components";
import { getDataSource } from "@/data";
import { useInstrument } from "@/instrument/session";
import { useSession } from "@/auth/session-context";
import { tenantLabel } from "../shell/AppShell";

export function Settings() {
  const inst = useInstrument();
  const { session, configured } = useSession();
  const source = useMemo(() => getDataSource(), []);

  // `null` while unknown, and rendered as such. A connect button that flashes "Not connected"
  // for a person who IS connected invites them to consent a second time, and a second consent
  // is a second refresh token that invalidates the first.
  const [linked, setLinked] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setStatus(new URLSearchParams(window.location.search).get("workspace"));
  }, []);

  useEffect(() => {
    // Its own endpoint rather than the connect route, which answers with a redirect to Google's
    // consent screen — asking whether somebody is connected must not start a consent flow.
    let live = true;
    fetch("/api/auth/workspace/status")
      .then((r) => r.json())
      .then((d: { linked?: boolean; complete?: boolean }) => {
        // COMPLETE, not merely linked. An account granted only the calendar, back when that was
        // all Warrant asked for, needs to be offered the connect button again — reporting it as
        // connected would leave Drive and Gmail quietly broken with nothing on screen to fix.
        if (live) setLinked(Boolean(d.linked && d.complete !== false));
      })
      .catch(() => { if (live) setLinked(false); });
    return () => { live = false; };
  }, [session]);

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

      {/*
        WORKSPACE. The one place in the product where this grant can be given.
        The routes existed for months and nothing ever called them — /api/auth/calendar had no
        caller in either client — so the calendar link was a feature only a curl could reach.
        A capability with no surface is not a capability.
      */}
      <div className="stack">
        <p className="gallery__label">Google Workspace</p>
        <p className="settings__value">
          {linked === null ? "…" : linked ? "Connected." : "Not connected."}
        </p>
        <p className="settings__note">
          Warrant writes into your Workspace and reads nothing out of it. Dated tasks become
          calendar events, a sealed record lands in your Drive alongside a running ledger, and a
          part the Foreman calls for is drafted as a purchase order in Gmail. The Gmail scope is{" "}
          <span className="w-mono">compose</span>, which can write a draft and cannot send one —
          so the order waits for a person with standing to press send. Warrant cannot see a file
          it did not create, and cannot read your mail.
        </p>
        {status === "declined" && (
          <p className="settings__note">
            You declined. Nothing is lost — tasks still reach you by push and every one of them is
            waiting in the app.
          </p>
        )}
        {status === "no_refresh_token" && (
          <p className="settings__note">
            Google returned a grant with no refresh token, which happens when the account has
            consented before. Remove Warrant under your Google account&rsquo;s third-party access
            and connect again.
          </p>
        )}
        <div className="gate__actions">
          {linked ? (
            <button
              type="button"
              className="w-btn w-btn--ghost"
              onClick={async () => {
                await fetch("/api/auth/workspace", { method: "DELETE" });
                setLinked(false);
              }}
            >
              Disconnect
            </button>
          ) : (
            // A full navigation, not a fetch. This route answers with a redirect to Google's
            // consent screen, and a redirect that lands in a fetch is a page nobody ever sees.
            <a className="w-btn w-btn--ghost" href="/api/auth/workspace">
              Connect Workspace
            </a>
          )}
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
