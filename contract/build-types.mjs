#!/usr/bin/env node
// contract/*.schema.json -> contract/types.ts. No dependencies.
// Handles exactly the subset we author in: object, array, enum, $ref, nullable.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const load = (d) => readdirSync(join(here, d)).filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(readFileSync(join(here, d, f), "utf8")));

const pascal = (s) => s.replace(/(^|-)(.)/g, (_, __, c) => c.toUpperCase());

const tsType = (p) => {
  if (p.$ref) return pascal(p.$ref);
  if (p.enum) return p.enum.map(v => JSON.stringify(v)).join(" | ");
  if (p.type === "array") {
    const el = tsType(p.items);
    // A union or an inline object used as an array element needs parentheses, or
    // `"a" | "b"[]` parses as `"a" | ("b"[])`. This bit once; it does not bite twice.
    return /[|{}]/.test(el) ? `(${el})[]` : `${el}[]`;
  }
  if (p.type === "object") {
    const inner = Object.entries(p.properties ?? {})
      .map(([k, v]) => `    ${k}${(p.required ?? []).includes(k) ? "" : "?"}: ${tsType(v)}${v.nullable ? " | null" : ""};`)
      .join("\n");
    return `{\n${inner}\n  }`;
  }
  return { string: "string", number: "number", integer: "number", boolean: "boolean" }[p.type] ?? "unknown";
};

const emit = (s) => {
  const name = s.title ?? pascal(s.$id);
  const req = s.required ?? [];
  const body = Object.entries(s.properties ?? {}).map(([k, p]) => {
    const doc = p.description ? `  /** ${p.description} */\n` : "";
    return `${doc}  ${k}${req.includes(k) ? "" : "?"}: ${tsType(p)}${p.nullable ? " | null" : ""};`;
  }).join("\n");
  const doc = s.description ? `/** ${s.description} */\n` : "";
  return `${doc}export interface ${name} {\n${body}\n}\n`;
};

const out = [
  "// GENERATED from contract/*.schema.json — do not edit.",
  "// Run: node contract/build-types.mjs",
  "",
  "// ---- entities ----",
  ...load("entities").map(emit),
  "// ---- agent contracts: what a model is forced to return ----",
  ...load("agents").map(emit),
].join("\n");

writeFileSync(join(here, "types.ts"), out);
console.log(`types.ts written — ${out.split("export interface").length - 1} interfaces`);
