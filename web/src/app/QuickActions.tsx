"use client";

// The short list under the carousel.
//
// The menu is behind a hamburger, which is the right place for navigation and the wrong place
// for the three things a person actually does on their second visit. These are those three, on
// the surface, one click from where the product opens.
//
// A row needing an account says so and still goes somewhere: clicking it lands on the sign-in
// gate for that destination, which explains what the account is for and then drops you on the
// page you asked for. A row that greys out and swallows the click teaches people that the
// product is broken; a row that names its price teaches them what an account means here.
//
// The Kotlin twin is android/…/ui/QuickActions.kt, and both read their gating out of the same
// shape — nav.ts here, Destinations.kt there — so the two surfaces cannot drift into
// disagreeing about what needs an account.

import Link from "next/link";
import { useSession } from "@/auth/session-context";
import { enabled, quickActions, reachNote } from "./shell/nav";

export function QuickActions() {
  const { session } = useSession();
  const signedIn = Boolean(session) && !session?.anonymous;

  return (
    <div className="quick">
      <p className="quick__label">Or</p>
      {quickActions(signedIn).map((action) => {
        const note = reachNote(action.reach);
        const body = (
          <>
            {/* One line each, ellipsised rather than wrapped. A hint that wraps is a hint that
                was too long to be a hint. */}
            <span className="quick__text">
              <span className="quick__title">{action.label}</span>
              <span className="quick__hint">{action.hint}</span>
            </span>
            {note ? <span className="quick__note w-mono">{note}</span> : null}
          </>
        );

        if (!enabled(action)) {
          return (
            <span className="quick__row quick__row--inert" key={action.dest.id} aria-disabled>
              {body}
            </span>
          );
        }
        return (
          <Link
            className={`quick__row${action.reach === "needs-account" ? " quick__row--gated" : ""}`}
            key={action.dest.id}
            href={action.dest.route}
          >
            {body}
          </Link>
        );
      })}
    </div>
  );
}
