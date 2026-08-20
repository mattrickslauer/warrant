import "server-only";

// Creating the tenant document, which happens on first sign-in and never again.
//
// There is no organisation wizard and no invite flow — the first person from acme.com to
// sign in creates the acme.com tenant, and the second person from acme.com joins it by
// simply being from acme.com. That is the whole membership model, and it works because the
// directory already exists on Google's side.

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./admin";
import type { TenantRef } from "./tenant";

/** Sovereignty. Evidence and memory never leave the tenant's region. */
export type Region = "us" | "eu";

export function defaultRegion(): Region {
  return process.env.WARRANT_REGION === "eu" ? "eu" : "us";
}

export interface TenantDoc {
  id: string;
  kind: TenantRef["kind"];
  hd: string | null;
  region: Region;
  claimed_at: string | null;
}

/**
 * Ensure `/tenants/{id}` exists, and return it.
 *
 * Idempotent and safe under a stampede: two technicians signing in at the same instant both
 * run this, and `create` losing to an existing document is not an error here.
 */
export async function ensureTenant(tenant: TenantRef): Promise<TenantDoc> {
  const ref = adminDb().collection("tenants").doc(tenant.id);
  const snap = await ref.get();

  if (snap.exists) {
    return { id: tenant.id, ...(snap.data() as Omit<TenantDoc, "id">) };
  }

  const doc: Omit<TenantDoc, "id"> = {
    kind: tenant.kind,
    hd: tenant.hd,
    region: defaultRegion(),
    // An anonymous tenant is unclaimed by definition; every other kind is claimed on sight.
    claimed_at: tenant.kind === "anon" ? null : new Date().toISOString(),
  };

  await ref.set({ ...doc, created_at: FieldValue.serverTimestamp() }, { merge: true });
  return { id: tenant.id, ...doc };
}
