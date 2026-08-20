// A resolver hook that lets Node import the app's own TypeScript modules.
//
// Next and tsc both accept extensionless relative imports (`./admin`) and the `@/` alias.
// Node's ESM resolver accepts neither, so server-side modules — the session code, the tenant
// claim migration — could not be exercised outside a running Next server. That would leave
// the riskiest code in the auth layer testable only by clicking through a browser.
//
// Used as:
//   node --experimental-strip-types --conditions=react-server \
//        --import ./scripts/ts-resolve.mjs --test scripts/whatever.test.mjs
//
// `--conditions=react-server` matters: it makes the `server-only` package resolve to its
// empty build rather than the module whose whole job is to throw.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(new URL("./ts-resolve-hooks.mjs", import.meta.url), pathToFileURL("./"));
