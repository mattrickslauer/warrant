import "server-only";
import raw from "@/generated/evals.json";

/**
 * The eval run, as the page reads it.
 *
 * The shape is whatever `python3 -m evals run` wrote, frozen into `src/generated/evals.json`
 * by `scripts/sync-evals.mjs`. It is typed here rather than generated because the run
 * artifact is a report, not a contract — nothing downstream depends on its field names the
 * way the entity schemas are depended on, and a report that gains a field should not fail a
 * build.
 */

/** What happened to one scenario. Four outcomes, and the difference between them matters. */
export type Status = "pass" | "fail" | "invalid" | "error";

export interface Check {
  op: string;
  path: string;
  ok: boolean;
  detail: string;
}

export interface PromptPart {
  kind: "text" | "media";
  text?: string;
  label?: string;
  mime?: string;
  digest?: string;
}

export interface Prompt {
  instruction?: string;
  parts?: PromptPart[];
}

/** One turn of an interview: what the Scoper said, and what the shop said back. */
export interface Turn {
  turn: number;
  scoper: Record<string, unknown>;
  prompt?: Prompt;
  shop?: { said: string; used_facts?: string[]; knew_it?: boolean; cassette?: string };
  schema_errors?: string[];
  cassette?: string;
  model?: string;
  latency_ms?: number;
  usage?: Record<string, number>;
  cached?: boolean;
}

export interface Result {
  id: string;
  agent: string;
  title: string;
  why: string;
  path: string;
  kind?: "turn" | "interview";
  status: Status;
  error?: string;
  output?: Record<string, unknown>;
  checks?: Check[];
  schema_errors?: string[];
  prompt?: Prompt;
  expect?: Record<string, unknown> | null;
  model?: string;
  cassette?: string;
  cached?: boolean;
  latency_ms?: number;
  usage?: Record<string, number>;
  transcript?: Turn[];
  conversation?: Array<{ who: string; said: string }>;
  disclosed_numbers?: number[];
}

export interface Run {
  empty?: boolean;
  at?: string;
  mode?: string;
  model?: string;
  temperature?: number;
  results: Result[];
}

export const run = raw as unknown as Run;

/** What each agent is for. Shown beside its results so a reader knows what passed. */
export const AGENTS: Record<string, { title: string; decides: string }> = {
  scoper: { title: "Scoper", decides: "Interviews a shop until a procedure would run unambiguously, then compiles it." },
  inspector: { title: "Inspector", decides: "PASS, ADD FIELD or ESCALATE on one field's evidence." },
  skeptic: { title: "Skeptic", decides: "Whether this evidence belongs to this job, this machine, this moment." },
  instructor: { title: "Instructor", decides: "Turns “I can't do this one” into a structured blocker and a next action." },
  foreman: { title: "Foreman", decides: "Owns a job for its whole life and disposes of a step nobody could do." },
  auditor: { title: "Auditor", decides: "Reads weeks of finished jobs and finds the defects in the procedure itself." },
  wright: { title: "Wright", decides: "Meets an unfamiliar instrument and works out how it speaks \u2014 or refuses to guess." },
};

export const STATUS_LABEL: Record<Status, string> = {
  pass: "pass",
  fail: "fail",
  invalid: "off-contract",
  error: "not asked",
};

/**
 * What each outcome means, in the words the harness uses.
 *
 * `error` is the one worth spelling out on the page. An agent that was never properly asked —
 * a photograph missing from the corpus — returns nothing to judge, and scoring that as a
 * failure would be as dishonest as scoring it as a pass.
 */
export const STATUS_MEANING: Record<Status, string> = {
  pass: "The answer conformed to the contract and every assertion held.",
  fail: "The answer was well-formed and an assertion about what it decided did not hold.",
  invalid: "The answer broke its own schema or a conditional rule. Terminal — nothing further is judged.",
  error: "The agent was never properly asked, so there is nothing to score either way.",
};

export function slug(id: string): string[] {
  return id.split("/");
}

export function byId(id: string): Result | undefined {
  return run.results.find((r) => r.id === id);
}

export interface AgentGroup {
  agent: string;
  results: Result[];
  passed: number;
  scored: number;
}

/**
 * Grouped for display, in the order the agents appear in a job's life: the procedure is
 * written, evidence is judged, a blocker is escalated and disposed of, and only then does
 * anything sweep across weeks. Wright sits last because it is the one agent outside that
 * loop entirely — it runs when a new instrument shows up, not when a job does.
 *
 * An agent missing from this list sorts to the front, which is how Auditor and Wright first
 * appeared above the Scoper.
 */
const ORDER = ["scoper", "inspector", "skeptic", "instructor", "foreman", "auditor", "wright"];

export function grouped(): AgentGroup[] {
  const groups = new Map<string, Result[]>();
  for (const r of run.results) {
    if (!groups.has(r.agent)) groups.set(r.agent, []);
    groups.get(r.agent)!.push(r);
  }
  return [...groups.entries()]
    .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .map(([agent, results]) => ({
      agent,
      results: results.sort((a, b) => a.id.localeCompare(b.id)),
      // Scored deliberately excludes `error`. A suite that reports 24/48 when thirteen of
      // those were never asked is reporting a number nobody can act on.
      passed: results.filter((r) => r.status === "pass").length,
      scored: results.filter((r) => r.status !== "error").length,
    }));
}

/**
 * Why the never-asked ones were never asked.
 *
 * The page used to tell a reader this was "almost always a photograph the corpus is still
 * waiting on". On the run actually in front of it that was untrue by a wide margin — two
 * thirds were a missing CASSETTE, which is a re-run rather than a camera, and the two are
 * different asks of very different size. Computing the split here means the sentence on the
 * page is read off the run instead of remembered from an older one.
 */
export function notAsked(): { media: number; cassette: number; other: number } {
  const out = { media: 0, cassette: 0, other: 0 };
  for (const r of run.results) {
    if (r.status !== "error") continue;
    const e = r.error ?? "";
    if (e.startsWith("media:")) out.media += 1;
    else if (e.includes("no cassette")) out.cassette += 1;
    else out.other += 1;
  }
  return out;
}

/** That split as a sentence, so the page states the real reason and not a stale one. */
export function notAskedSentence(): string {
  const n = notAsked();
  const p: string[] = [];
  const be = (k: number) => (k === 1 ? "is" : "are");
  if (n.cassette) p.push(`${n.cassette} ${be(n.cassette)} waiting on a recorded cassette, which is a re-run rather than a camera`);
  if (n.media) p.push(`${n.media} ${be(n.media)} waiting on a photograph the corpus does not have yet`);
  if (n.other) p.push(`${n.other} ${be(n.other)} unasked for another reason`);
  return p.join("; ");
}

export function totals() {
  const t: Record<Status, number> = { pass: 0, fail: 0, invalid: 0, error: 0 };
  let tokens = 0;
  let ms = 0;
  for (const r of run.results) {
    t[r.status] = (t[r.status] ?? 0) + 1;
    tokens += r.usage?.totalTokenCount ?? 0;
    ms += r.latency_ms ?? 0;
  }
  return { ...t, tokens, ms, total: run.results.length };
}
