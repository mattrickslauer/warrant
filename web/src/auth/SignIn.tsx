"use client";

// The sign-in control, and the tenant it produced.
//
// Showing the tenant is not decoration. The whole identity model is "your account decides the
// shape of the tenant", and a person cannot check that claim unless the product tells them
// which tenant they landed in and why.

import { useSession } from "./session-context";

export function SignIn() {
  const { session, loading, configured, error, signIn, startAnonymously, signOut } = useSession();

  if (!configured) {
    return <span className="signin__note">Fixture data — no project connected</span>;
  }
  if (loading) {
    return <span className="signin__note" aria-live="polite">…</span>;
  }

  if (!session) {
    return (
      <div className="signin">
        <button type="button" className="signin__google" onClick={() => void signIn()}>
          <GoogleMark />
          Sign in with Google
        </button>
        <button type="button" className="signin__anon" onClick={() => void startAnonymously()}>
          or try it without an account
        </button>
        {error ? <p className="signin__error" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="signin signin--in">
      <TenantBadge session={session} />
      <button type="button" className="signin__out" onClick={() => void signOut()}>
        Sign out
      </button>
      {session.anonymous ? (
        <button type="button" className="signin__google signin__google--small" onClick={() => void signIn()}>
          <GoogleMark />
          Keep this work — sign in
        </button>
      ) : null}
      {error ? <p className="signin__error" role="alert">{error}</p> : null}
    </div>
  );
}

const EXPLAIN: Record<string, string> = {
  workspace: "Workspace domain — everyone here shares this tenant",
  solo: "Personal account — a tenant of one",
  anon: "Not signed in — this work is unclaimed",
};

function TenantBadge({ session }: { session: NonNullable<ReturnType<typeof useSession>["session"]> }) {
  return (
    <span className="tenant" data-kind={session.tenant.kind} title={EXPLAIN[session.tenant.kind]}>
      <span className="tenant__id">{session.tenant.id}</span>
      <span className="tenant__kind">{session.tenant.kind}</span>
    </span>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}
