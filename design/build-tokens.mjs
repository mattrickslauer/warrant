#!/usr/bin/env node
// One token source, two stacks. Reads tokens.json, writes tokens.css here and
// Tokens.kt straight into the Android source tree.
// No dependencies on purpose — `node design/build-tokens.mjs` and that is all.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));

// Keys starting with _ are notes for humans, not tokens.
const real = (o) => Object.entries(o ?? {}).filter(([k]) => !k.startsWith("_"));
const banner = "/* GENERATED from design/tokens.json — do not edit. */";

// ---- web ----
// Every group flattens to one custom property namespace. Elevation and motion join colour
// and size here because a Material surface is not described by colour alone — a card at rest
// is its fill AND its level-1 shadow, and splitting those across two files is how they drift.
const css = [
  banner,
  ":root{",
  ...real(t.color).map(([k, v]) => `  --${k}: ${v};`),
  ...real(t.font).map(([k, v]) => `  --${k}: ${v};`),
  ...real(t.size).map(([k, v]) => `  --${k}: ${v};`),
  ...real(t.elevation).map(([k, v]) => `  --${k}: ${v};`),
  ...real(t.motion).map(([k, v]) => `  --${k}: ${v};`),
  "}",
  "",
].join("\n");
writeFileSync(join(here, "tokens.css"), css);

// ---- android ----
const camel = (k) => k.replace(/-(.)/g, (_, c) => c.toUpperCase());
// Only the shape scale crosses to Compose. `maxw` is a web page width and `gap` is a grid
// hairline; neither means anything to a phone, so neither is emitted.
const shape = real(t.size).filter(([k]) => k === "radius" || k.startsWith("r-"));
const kt = [
  "// GENERATED from design/tokens.json — do not edit.",
  "package ink.warrant.design",
  "",
  "import androidx.compose.ui.graphics.Color",
  "import androidx.compose.ui.unit.dp",
  "",
  "object Tokens {",
  ...real(t.color).map(([k, v]) => `    val ${camel(k)} = Color(0xFF${v.slice(1).toUpperCase()})`),
  "",
  "    /** Material 3 shape scale, shared verbatim with the web stylesheet. */",
  "    object Shape {",
  ...shape.map(([k, v]) => `        val ${camel(k)} = ${parseInt(v, 10)}.dp`),
  "    }",
  "}",
  "",
].join("\n");
// The Android consumer is the app source tree, not this directory — one file, one home.
writeFileSync(join(here, "..", "android", "app", "src", "main", "java", "ink", "warrant", "design", "Tokens.kt"), kt);

console.log(
  `tokens.css and Tokens.kt written — ${real(t.color).length} colours, ${shape.length} radii`,
);
