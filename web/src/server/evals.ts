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

/** Grouped for display, in the order the agents appear in a job's life. */
const ORDER = ["scoper", "inspector", "skeptic", "instructor", "foreman"];

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
