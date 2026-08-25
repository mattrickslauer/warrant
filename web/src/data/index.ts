// The one binding. Everything above this line depends on the DataSource interface only.

import { FixtureSource } from "./fixture-source";
import { LiveSource } from "./live-source";
import type { DataSource } from "./source";
import { authConfigured } from "@/auth/config";

let singleton: DataSource | null = null;

/**
 * Which implementation the surfaces run on.
 *
 * `fixture` is the default and needs no Google Cloud project, no credentials and no
 * hardware — the whole product runs end to end on it, which is what makes the repository
 * clonable and the smoke test offline.
 *
 * `live` requires a Firebase project AND a signed-in user, because LiveSource reads through
 * the authenticated client so that firestore.rules is what enforces tenancy. If either is
 * missing we fall back rather than throw: a surface that renders fabricated data and SAYS SO
 * is far better than a blank screen, and `fabricated` is on the interface precisely so every
 * screen can say so.
 */
export function getDataSource(): DataSource {
  if (singleton) return singleton;

  const wantsLive = process.env.NEXT_PUBLIC_WARRANT_DATA_SOURCE === "live";
  const canGoLive = wantsLive && authConfigured && typeof window !== "undefined";

  singleton = canGoLive ? new LiveSource() : new FixtureSource();
  return singleton;
}

/** Drop the cached binding. Used when a sign-in changes which source is reachable. */
export function resetDataSource(): void {
  singleton = null;
}

export * from "./source";
export { FixtureSource } from "./fixture-source";
export { LiveSource, scoped, splitScoped } from "./live-source";
export * from "./seal";
