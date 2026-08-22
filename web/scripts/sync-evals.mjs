#!/usr/bin/env node
// Freezes the latest eval run into the app.
//
// The run artifact is produced OUTSIDE web/ by `python3 -m evals run`, and is copied in
// here rather than read from disk at request time for one reason: /model-tests has to work
// on a deployed instance, where agents/ does not exist. A snapshot also means the page
// cannot silently change under a demo because someone re-ran the suite in another terminal.
//
// Re-run this after every eval run:  npm run gen   (or node scripts/sync-evals.mjs)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "web/src/generated");
const out = join(outDir, "evals.json");
const mediaOut = join(root, "web/public/evals");

const pointer = join(root, "agents/evals/runs/latest");
mkdirSync(outDir, { recursive: true });

if (!existsSync(pointer)) {
  // Not a build failure. A clone that has never run the suite still has to build, and the
  // page says plainly that there is no run rather than rendering a fabricated green.
  //
  // But absent is not the same as empty. The web container builds from a context with no
  // `agents/` in it (see infra/Dockerfile.web), while `web/src/generated/evals.json` was
  // already produced on the host and copied in. Overwriting it with a stub there would blank
  // /model-tests on exactly the deployed instance the page exists to be read on. So a
  // snapshot that is already present wins over a run this context cannot reach.
  if (existsSync(out)) {
    const n = JSON.parse(readFileSync(out, "utf8")).results?.length ?? 0;
    console.log(`no agents/ in this build context — kept the existing evals.json (${n} results)`);
    process.exit(0);
  }
  writeFileSync(out, JSON.stringify({ empty: true, results: [] }, null, 2));
  console.log("no eval run found — wrote an empty evals.json");
  process.exit(0);
}

const runDir = readFileSync(pointer, "utf8").trim();
const run = JSON.parse(readFileSync(join(runDir, "results.json"), "utf8"));

// Media is named in a prompt by its corpus path. Copy exactly the files this run referenced,
// so the page can show the photograph the agent was actually judging — a verdict on evidence
// is not reviewable without the evidence.
const wanted = new Set();
for (const r of run.results) {
  for (const p of r.prompt?.parts ?? []) if (p.kind === "media" && p.label) wanted.add(p.label);
  for (const t of r.transcript ?? []) {
    for (const p of t.prompt?.parts ?? []) if (p.kind === "media" && p.label) wanted.add(p.label);
  }
}
let copied = 0;
for (const ref of wanted) {
  const src = join(root, "agents/evals/media", ref);
  if (!existsSync(src)) continue;          // the scenario is already reported as an error
  const dst = join(mediaOut, ref);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  copied++;
}

// The scenario's assertions are what the run was judged against, and the run artifact records
// only the outcome. Reading `expect` back off disk lets the page show what was demanded
// alongside what happened, which is the difference between a green tick and evidence.
for (const r of run.results) {
  const path = join(root, "agents/evals", r.path);
  if (existsSync(path)) {
    try { r.expect = JSON.parse(readFileSync(path, "utf8")).expect ?? null; }
    catch { r.expect = null; }
  }
}

writeFileSync(out, JSON.stringify(run, null, 2));
const kb = Math.round(Buffer.byteLength(JSON.stringify(run)) / 1024);
console.log(
  `synced ${run.results.length} eval results (${kb} KB) and ${copied} media files ` +
  `from ${runDir.replace(root + "/", "")}`);
