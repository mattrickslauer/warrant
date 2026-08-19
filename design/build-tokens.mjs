#!/usr/bin/env node
// One token source, two stacks. Reads tokens.json, writes tokens.css and Theme.kt.
// No dependencies on purpose — `node design/build-tokens.mjs` and that is all.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));

// Keys starting with _ are notes for humans, not tokens.
const real = (o) => Object.entries(o).filter(([k]) => !k.startsWith("_"));
const banner = "/* GENERATED from design/tokens.json — do not edit. */";

// ---- web ----
const css = [
  banner,
  ":root{",
  ...real(t.color).map(([k, v]) => `  --${k}: ${v};`),
  ...real(t.font).map(([k, v]) => `  --${k}: ${v};`),
  ...real(t.size).map(([k, v]) => `  --${k}: ${v};`),
  "}",
  "",
].join("\n");
writeFileSync(join(here, "tokens.css"), css);

// ---- android ----
const camel = (k) => k.replace(/-(.)/g, (_, c) => c.toUpperCase());
const kt = [
  "// GENERATED from design/tokens.json — do not edit.",
  "package ink.warrant.design",
  "",
  "import androidx.compose.ui.graphics.Color",
  "",
  "object Tokens {",
  ...real(t.color).map(([k, v]) => `    val ${camel(k)} = Color(0xFF${v.slice(1).toUpperCase()})`),
  "}",
  "",
].join("\n");
writeFileSync(join(here, "Theme.kt"), kt);

console.log(`tokens.css and Theme.kt written — ${real(t.color).length} colours`);
