// The Evidence table, produced by the running system.
//
//   cd web && node scripts/evidence.mjs            # print it
//   cd web && node scripts/evidence.mjs --write    # replace the table in ../README.md
//
// The README says every number in that table is produced by the running system and checkable
// against the public log. That is a promise about provenance, and a promise about provenance
// cannot be kept by typing numbers into a table by hand — so this reads them, and it is the
// only thing that writes them.
//
// It needs Application Default Credentials and it only ever READS. Nothing here writes to
// Firestore.
//
// A ZERO IS A RESULT AND IS PRINTED AS ONE. A row that says 0 instrument readings is the
// system saying no tool has ever been paired against this project, which is worth knowing and
// is the opposite of a row left saying `_pending_`.

import { readFileSync, writeFileSync } from "node:fs";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = process.env.GCP_PROJECT || "warrent-505918";
if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT });
}
const db = getFirestore();

const all = async (group) => (await db.collectionGroup(group).get()).docs.map((d) => ({
  __path: d.ref.path, ...d.data(),
}));

const [procedures, jobs, outcomes, decisions, readings, tasks, records] = await Promise.all(
  ["procedures", "jobs", "step_outcomes", "decisions", "readings", "tasks", "records"].map(all),
);

// --- what the fleet actually did ---------------------------------------------------------
//
// A decision that never reached the engine is NOT a verdict, and counting it as one would
// inflate every row below it. It is reported separately, as its own line, because a fleet
// that could not be called is a fact about the system worth stating rather than hiding.
const reached = decisions.filter((d) => d.verdict !== "engine_unreachable");
const unreachable = decisions.length - reached.length;
const verdict = (v) => reached.filter((d) => d.verdict === v).length;

const sealed = jobs.filter((j) => j.status === "sealed");
const held = jobs.filter((j) => j.status === "held").length
  + records.filter((r) => (r.deficiencies ?? []).length > 0).length;

const spend = decisions.reduce((sum, d) => sum + Number(d.cost_usd || 0), 0);

// WHEN it could not be reached, not just how often.
//
// A bare total here is true and misleading in the direction that matters most: almost all of
// these landed inside a single bad day, and a reader shown one number cannot tell a resolved
// incident from the system's present state. So the row carries the window and the last day it
// happened, which is the difference between "this is broken" and "this broke, on the 25th".
const unreachableDays = {};
for (const d of decisions) {
  if (d.verdict !== "engine_unreachable") continue;
  const day = String(d.at || "").slice(0, 10);
  unreachableDays[day] = (unreachableDays[day] || 0) + 1;
}
const worst = Object.entries(unreachableDays).sort((a, b) => b[1] - a[1])[0];
const lastDay = Object.keys(unreachableDays).sort().pop();
const today = new Date().toISOString().slice(0, 10);
const unreachableLine = unreachable === 0
  ? "0"
  : `${unreachable} — ${worst[1]} of them on ${worst[0]}` +
    `${lastDay === today ? "" : `, none since ${lastDay}`}`;

// Cost per job by strictness. Attributed through the job the decision belongs to, because a
// decision carries no strictness of its own — the job it was made under does.
const jobById = new Map(jobs.map((j) => [String(j.id), j]));
const perStrictness = new Map();
for (const d of decisions) {
  const j = jobById.get(String(d.job_id).split("/").pop());
  const s = j?.strictness ?? 1;
  const cur = perStrictness.get(s) ?? { cost: 0, jobs: new Set() };
  cur.cost += Number(d.cost_usd || 0);
  cur.jobs.add(String(d.job_id));
  perStrictness.set(s, cur);
}
const NAME = { 0: "log", 1: "standard", 2: "assured", 3: "regulated" };
const costByStrictness = [...perStrictness.entries()].sort((a, b) => a[0] - b[0])
  .map(([s, v]) => `${NAME[s] ?? s} $${(v.cost / Math.max(v.jobs.size, 1)).toFixed(4)}`)
  .join(" · ") || "no decisions yet";

// Days the system ran without anybody driving it. The span the fleet has been deciding over,
// which is the only definition of this that a reader can check against the log.
const times = decisions.map((d) => Date.parse(d.at)).filter((t) => !Number.isNaN(t)).sort();
const days = times.length > 1
  ? ((times[times.length - 1] - times[0]) / 86_400_000).toFixed(1)
  : "0";

// PROCEDURES ARE COUNTED BY KEY, NOT BY DOCUMENT.
//
// Every new visitor tenant gets the public catalogue seeded into it, so the raw document count
// is the catalogue multiplied by however many strangers have opened the product — 98 documents
// standing for 5 procedures. Reporting that as "procedures published" would be the tick in the
// box: a true number that means nothing it appears to mean. The key is stable across versions
// and across tenants, so distinct keys is what a reader thinks this row is counting.
const published = procedures.filter((p) => (p.status ?? "published") === "published");
const distinctKeys = new Set(published.map((p) => p.key)).size;
const authored = published.filter((p) => p.origin === "scoper").length;

const rows = [
  ["Procedures published", `${distinctKeys} distinct (${published.length} documents — the catalogue is seeded into every tenant)`],
  ["of those, authored by talking to the Scoper", authored],
  ["Jobs performed", sealed.length],
  ["Steps verified", outcomes.filter((o) => o.status === "performed").length],
  ["Steps that asked for more evidence", verdict("ADD_FIELD")],
  ["Steps refused", verdict("ESCALATE") + verdict("DISSENT")],
  ["**Instrument readings captured**", readings.length],
  ["**Machines held out of service**", held],
  ["Purchase orders drafted", tasks.filter((t) => t.kind === "approve_order").length],
  ["Days run unattended", days],
  ["Cost per job, by strictness", costByStrictness],
  ["**Total spend**", `$${spend.toFixed(4)}`],
  ["Agent decisions on the record", reached.length],
  ["Decisions that could not reach the fleet", unreachableLine],
];

const table = [
  "| | |", "|---|---|",
  ...rows.map(([k, v]) => `| ${k} | ${v} |`),
  "",
  `_Read from \`${PROJECT}\` by \`web/scripts/evidence.mjs\` at ${new Date().toISOString()}._`,
].join("\n");

if (process.argv.includes("--write")) {
  const path = new URL("../../README.md", import.meta.url).pathname;
  const src = readFileSync(path, "utf8");
  const START = "<!-- EVIDENCE:START -->";
  const END = "<!-- EVIDENCE:END -->";
  if (!src.includes(START)) {
    console.error(`README.md has no ${START} marker — add it around the Evidence table.`);
    process.exit(1);
  }
  const before = src.slice(0, src.indexOf(START) + START.length);
  const after = src.slice(src.indexOf(END));
  writeFileSync(path, `${before}\n${table}\n${after}`);
  console.error("README.md Evidence table updated.");
} else {
  console.log(table);
}
