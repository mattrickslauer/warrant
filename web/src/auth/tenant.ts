// Who you are decides which tenant you are in, and nothing else does.
//
// This file is the TypeScript half of a rule written twice, deliberately. The other half is
// `tenantOf()` in firestore.rules, and the two must stay identical — one enforces on the
// server where we hold the Admin SDK and rules do not apply, the other enforces in Firestore
// itself for the authenticated client that drives the real-time listener. A divergence
// between them is a tenancy hole, so they are kept adjacent in review and covered by the
// same test corpus (see auth/tenant.test.ts and firestore-rules.test.mjs, which assert the
// SAME table of claims produces the SAME tenant id on both sides).
//
// See docs/architecture.md §7 and docs/data-model.md §7.

export type TenantKind = "workspace" | "solo" | "anon";

export interface TenantRef {
  /** Workspace domain, or `u:<uid>`, or `anon:<uid>`. The Firestore document id. */
  id: string;
  kind: TenantKind;
  /** The Google Sign-In `hd` claim. Null unless kind is workspace. */
  hd: string | null;
}

/** The subset of a verified Firebase token this decision is allowed to see. */
export interface TenantClaims {
  /** Firebase uid. Equal to the token `sub`. */
  uid: string;
  /**
   * The hosted-domain claim. Firebase does NOT propagate Google's `hd` into its own ID
   * token, so this arrives as a custom claim written by the server after it has verified
   * Google's own ID token against Google's certificates. See auth/hd.ts.
   */
  hd?: string | null;
  sign_in_provider?: string | null;
}

/**
 * A Workspace domain is an enterprise. A consumer account is a tenant of one. An unclaimed
 * visitor is a tenant of one that has not been claimed yet.
 *
 * Order matters: `hd` wins over everything, because a Workspace user who once used the
 * product anonymously must land in their employer's tenant and not keep a private island.
 */
export function tenantFromClaims(claims: TenantClaims): TenantRef {
  const hd = normaliseHd(claims.hd);
  if (hd) return { id: hd, kind: "workspace", hd };
  if (claims.sign_in_provider === "anonymous") {
    return { id: `anon:${claims.uid}`, kind: "anon", hd: null };
  }
  return { id: `u:${claims.uid}`, kind: "solo", hd: null };
}

/**
 * A hosted domain is a DNS name and nothing else.
 *
 * This runs on a value that reaches us from Google, but it also runs on the dev override,
 * and a tenant id becomes a Firestore document id — so anything that could escape a path
 * segment or collide with the `u:` and `anon:` namespaces is refused rather than sanitised.
 * Returning null degrades a would-be Workspace user to a solo tenant, which is safe; the
 * alternative failure mode puts them in a tenant that is not theirs.
 */
export function normaliseHd(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const hd = raw.trim().toLowerCase();
  if (!hd) return null;
  // Consumer Google accounts have no hd, but be explicit: these are never enterprises.
  if (hd === "gmail.com" || hd === "googlemail.com") return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hd)) return null;
  if (hd.length > 253) return null;
  return hd;
}

/** True when this tenant's data has to be migrated once the visitor signs in. */
export function isUnclaimed(tenant: TenantRef): boolean {
  return tenant.kind === "anon";
}
