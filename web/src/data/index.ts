// The one binding. Phase 3 swaps FixtureSource for LiveSource here and nowhere else.
import { FixtureSource } from "./fixture-source";
import type { DataSource } from "./source";

let singleton: DataSource | null = null;

export function getDataSource(): DataSource {
  if (!singleton) singleton = new FixtureSource();
  return singleton;
}

export * from "./source";
export { FixtureSource } from "./fixture-source";
export * from "./seal";
