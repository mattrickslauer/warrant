"use client";

// Why this particular page is asking.
//
// Every gate in the product is the same screen, and the only thing that differs is the
// sentence explaining what you are about to be let into. That sentence matters more than it
// looks: "sign in to continue" with no object is how an app teaches people to sign in
// reflexively, and the whole identity model here rests on the account meaning something
// specific.
//
// The Kotlin twin is android/…/auth/SignInGate.kt, and the copy is deliberately word for word:
// two surfaces explaining an account two different ways is two chances to explain it wrongly.

import Link from "next/link";
import { HoldBanner, Rule } from "@/components";
import { useSession } from "./session-context";
import { GoogleMark } from "@/app/shell/AppShell";

export type AuthPurpose = "author" | "account";

const PURPOSE: Record<AuthPurpose, { label: string; why: string }> = {
  author: {
    label: "Create a procedure",
    why:
      "Running a procedure needs no account. Authoring one does — a procedure governs every " +
      "job that is ever run against it, so it has to belong to somebody.",
  },
  account: {
    label: "Account",
    why:
      "There is nothing to show until you sign in. Your account is what decides which tenant " +
      "your procedures, jobs and records belong to.",
  },
};

/**
 * Shows `children` only to a signed-in person; otherwise explains what is needed and why.
 *
 * The gate is a page rather than a dialog on purpose: being asked to sign in is a real fork in
 * the road, and a modal over a screen you cannot use is a worse way to say so.
 *
 * An ANONYMOUS session does not open the gate. A visitor who pressed "try it without an
 * account" has a Firebase user and a tenant, and every screen that merely reads their own work
 * treats them as signed in — but a procedure they authored would belong to a tenant that
 * evaporates with the browser, which is the one thing this gate exists to prevent.
 */
export function SignInGate({
  purpose,
  children,
}: {
  purpose: AuthPurpose;
  children: React.ReactNode;
}) {
  const { session, configured, error, signIn } = useSession();
  const { label, why } = PURPOSE[purpose];

  if (session && !session.anonymous) return <>{children}</>;

  return (
    <div className="stack stack--lg gate">
      <div className="stack">
        <p className="eyebrow">{label}</p>
        <h1 className="hero">Sign in to continue</h1>
        <p className="lede">{why}</p>
      </div>

      <Rule />

      <div className="stack">
        <p className="gallery__label">What your account decides</p>
        <p className="gate__note">
          A Google Workspace account puts you in your organisation&rsquo;s tenant — everyone at
          your domain shares procedures, jobs, parts and records. A personal Google account gets
          a tenant of one.
        </p>
        <p className="gate__note">
          Offboarding comes free: when an employer disables an account, that person&rsquo;s
          access ends the same instant.
        </p>
      </div>

      {session?.anonymous ? (
        <HoldBanner title="This work is unclaimed">
          You are working as a visitor, so what you have already done is kept — signing in links
          it to your account rather than replacing it. Nothing you have captured is lost.
        </HoldBanner>
      ) : null}

      {!configured ? (
        <HoldBanner kind="fixture" title="Sign-in is not configured in this build">
          There is no Firebase project behind this deployment, so there is nothing to sign in
          to. Every surface still runs — on fixture data, and it says so wherever it does.
        </HoldBanner>
      ) : null}

      {error ? (
        <HoldBanner title="Sign-in failed">{error}</HoldBanner>
      ) : null}

      <div className="gate__actions">
        {/* There is no sign-up button, because there is no account of ours to create. The
            first successful sign-in is what brings the tenant into existence. */}
        <button
          type="button"
          className="w-btn signin__google"
          disabled={!configured}
          onClick={() => void signIn()}
        >
          <GoogleMark />
          Continue with Google
        </button>
        <Link className="w-btn w-btn--ghost" href="/">Back</Link>
      </div>
    </div>
  );
}
