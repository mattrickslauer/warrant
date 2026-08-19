#!/usr/bin/env node
// Copies the generated artifacts into the app. They are generated OUTSIDE web/ so the
// Android client can consume the same sources without depending on the web build.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
mkdirSync(join(root, "web/src/generated"), { recursive: true });
copyFileSync(join(root, "contract/types.ts"), join(root, "web/src/generated/types.ts"));
copyFileSync(join(root, "design/tokens.css"), join(root, "web/src/generated/tokens.css"));
console.log("synced types.ts and tokens.css into web/src/generated/");
