"use client";

// The account, and the tenant it produced.
//
// Showing the tenant is not decoration. The whole identity model is "your account decides the
// shape of the tenant" (docs/architecture.md §7), and a person cannot check that claim unless
// the product tells them which tenant they landed in and why. The Kotlin twin is
// android/…/ui/account/AccountScreen.kt and the explanations are word for word.

import { Rule } from "@/components";
import { useSession } from "@/auth/session-context";
import { tenantLabel } from "../shell/AppShell";

export function Account() {
  const { session, signOut } = useSession();
  if (!session) return null; // The gate above this never renders it signed out.

  const workspace = session.tenant.kind === "workspace";

  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="eyebrow">Signed in</p>
        <h1 className="hero">{session.name ?? session.email}</h1>
        {/* Mono: the address came from Google, not from anything typed here. */}
        {session.email && <p className="account__email w-mono">{session.email}</p>}
      </div>

      <Rule />

      <div className="stack">
        <p className="gallery__label">Tenant</p>
        <p className="account__tenant">{tenantLabel(session.tenant)}</p>
        <p className="account__id w-mono">{session.tenant.id} · {session.tenant.kind}</p>
        <p className="account__note">
          {workspace
            ? "A Workspace domain, so procedures you author here are your organisation's. " +
              "Multiple technicians work under this tenant."
            : "A personal Google account, so this is a tenant of one. Adding technicians needs " +
              "Workspace — their directory is the membership list."}
        </p>
        <p className="account__note account__note--quiet">
          Offboarding is your directory&rsquo;s job and it already works: disable the account and
          this access ends the same instant.
        </p>
      </div>

      <Rule />

      <div className="stack">
        <p className="gallery__label">What sealing means for this account</p>
        <p className="account__note">
          Signing out drops the session this browser holds. It does not revoke anything at
          Google, and it does not touch a record that was already sealed — that is the point of
          sealing.
        </p>
        <div className="gate__actions">
          <button type="button" className="w-btn w-btn--ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
