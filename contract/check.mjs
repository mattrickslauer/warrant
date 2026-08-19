#!/usr/bin/env node
// Contract test. No dependencies.
//   1. every schema parses
//   2. every $ref in entities/ resolves to a real $id
//   3. every schema in agents/ stays inside the Vertex responseSchema subset
// The third is the one that matters: it is discovered on day 6 otherwise.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const load = (d) => readdirSync(join(here, d)).filter(f => f.endsWith(".json"))
  .map(f => ({ file: `${d}/${f}`, schema: JSON.parse(readFileSync(join(here, d, f), "utf8")) }));

const errors = [];
const entities = load("entities");
const agents = load("agents");

// --- 2. refs resolve ---
const ids = new Set(entities.map(e => e.schema.$id));
const walkRefs = (node, file) => {
  if (!node || typeof node !== "object") return;
  if (typeof node.$ref === "string" && !ids.has(node.$ref))
    errors.push(`${file}: $ref "${node.$ref}" resolves to nothing`);
  for (const v of Object.values(node)) walkRefs(v, file);
};
entities.forEach(({ file, schema }) => walkRefs(schema, file));

// --- 3. the Vertex subset ---
const BANNED = ["$ref", "oneOf", "anyOf", "allOf", "not", "additionalProperties",
                "patternProperties", "if", "then", "else", "const", "$defs", "definitions"];
const OK_TYPES = ["string", "number", "integer", "boolean", "array", "object"];

const walkVertex = (node, file, path = "") => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n, i) => walkVertex(n, file, `${path}[${i}]`));
  for (const key of BANNED)
    if (key in node) errors.push(`${file}${path}: "${key}" is not supported by Vertex responseSchema`);
  if ("type" in node && !OK_TYPES.includes(node.type))
    errors.push(`${file}${path}: type "${node.type}" is not a Vertex type`);
  if (Array.isArray(node.type))
    errors.push(`${file}${path}: type arrays are not supported — use "nullable": true`);
  if ("enum" in node && node.type !== "string")
    errors.push(`${file}${path}: enum is only supported on strings`);
  if (node.type === "object" && !node.properties)
    errors.push(`${file}${path}: object with no properties`);
  for (const [k, v] of Object.entries(node.properties ?? {})) walkVertex(v, file, `${path}.${k}`);
  if (node.items) walkVertex(node.items, file, `${path}[]`);
};
agents.forEach(({ file, schema }) => {
  walkVertex(schema, file);
  // every required key must actually exist
  for (const r of schema.required ?? [])
    if (!(r in (schema.properties ?? {})))
      errors.push(`${file}: required "${r}" is not a property`);
  // descriptions are prompt surface — a missing one is a silently worse agent
  for (const [k, v] of Object.entries(schema.properties ?? {}))
    if (!v.description && !v.enum) errors.push(`${file}: property "${k}" has no description`);
});

if (errors.length) {
  console.error(`\n${errors.length} contract error(s):\n`);
  errors.forEach(e => console.error("  " + e));
  process.exit(1);
}
console.log(`ok — ${entities.length} entities, ${agents.length} agent contracts, all refs resolve, all agent schemas Vertex-safe`);
