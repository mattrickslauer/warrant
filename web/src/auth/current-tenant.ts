// Which tenant the work in front of you belongs to.
//
// Every screen that starts a job or lists what a person has done needs this answer, and before
// this file existed each of them wrote `tenantId: "anon"` inline — so a signed-in technician
// started jobs in the visitor tenant and then could not find them anywhere, because the records
// screen looked in the tenant they were actually in.
//
// The rule itself lives in tenant.ts and is enforced by firestore.rules. This is only the
// browser-side reader for it, and it deliberately has no way to override the answer: a tenant
// id that a screen could choose is a tenancy bypass waiting for one careless prop.

import type { SessionView } from "./session-context";

/**
 * The tenant a browser with no session works in.
 *
 * A visitor who has not pressed anything has no Firebase user, so there is no uid to name a
 * tenant after. `anon` is that tenant: local to the fixture layer, never written to Firestore,
 * and replaced by `anon:{uid}` the moment a real anonymous session exists.
 */
export const VISITOR_TENANT = "anon";

export function currentTenantId(session: SessionView | null): string {
  return session?.tenant.id ?? VISITOR_TENANT;
}
