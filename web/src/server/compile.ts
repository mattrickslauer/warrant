import "server-only";

// The other half of the interview.
//
// `/api/scoper/turn` runs the conversation; this is what happens when the Scoper finally says
// `compile`. The draft becomes a document under the tenant and then a FROZEN version, because
// a job pins the version it started under and there has to be something to pin. See
// specs/2026-08-20-firestore-design.md §5.
//
// ## The draft arrives through a browser, so none of it is believed on sight
//
// The Scoper's contract is strict and the agent is careful, but what reaches this file came
// back through a client, and a client is not the agent. Two things are therefore
// re-established here rather than trusted:
//
//   * **`minimum_tier` is derived, never accepted.** procedure.schema.json says "Derived from
//     the fields" and it is load-bearing: `surfaceCanRun` refuses a procedure whose tier the
//     surface cannot reach. A tier that arrived understated would let a browser — whose sensors
//     are supplied by the person being checked — run a procedure that needs a paired
//     instrument. So it is computed from the fields and any disagreement is overwritten without
//     comment, because there is no version of this where the client's number is the better one.
//
//   * **A bound nobody stated is refused.** "Inventing a tolerance is the one thing you must
//     never do" is the Scoper's instruction (contract/agents/scoper-turn.schema.json). Here it
//     stops being an instruction and becomes a rule. A field judged `within` with no bound and
//     no unit cannot be applied to anything that comes back, so every capture would file as a
//     pass because nothing contradicted it — a tick box with the box already ticked, which is
//     the exact thing this product exists to abolish.
//
// A refusal is returned with its reasons and the interview stays open. That is the correct
// outcome: the shop is still sitting there and can answer the question that was missed.

import { adminDb } from "@/auth/admin";
import { publishProcedure } from "@/server/procedures";
import type { FieldDef, Procedure, Step } from "@/generated/types";
import type { TenantRef } from "@/auth/tenant";

/** The draft could not be made into something a job can be judged against. Carries why. */
export class NotCompilable extends Error {
  readonly faults: string[];
  constructor(faults: string[]) {
    super(faults.join(" "));
    this.name = "NotCompilable";
    this.faults = faults;
  }
}

const KINDS = ["measurement", "photo", "video", "scan", "choice", "text", "signature", "location"];
const SOURCES = ["instrument", "camera", "human"];
const RULES = ["within", "matches", "must_show", "consistent_with", "per_spec", "signed_by"];

/** The draft as the Scoper hands it over — ids and ordering are this file's job, not its. */
export interface DraftField {
  key?: string;
  kind?: string;
  prompt?: string;
  source?: string;
  required_at_strictness?: number;
  choices?: string[];
  acceptance_rule?: string;
  acceptance_min?: number | null;
  acceptance_max?: number | null;
  acceptance_unit?: string | null;
  acceptance_target?: string | null;
  acceptance_description?: string | null;
  guidance?: string;
}

export interface DraftStep {
  title?: string;
  explanation?: string;
  condition?: string | null;
  max_add_fields?: number;
  fields?: DraftField[];
}

export interface Draft {
  key?: string;
  title?: string;
  strictness?: number;
  minimum_tier?: string;
  disqualifiers?: string[];
  releases?: string[];
  steps?: DraftStep[];
}

/**
 * What a surface must be able to reach before this procedure may run.
 *
 * Only `instrument` yields the measured class, so one instrument field puts the whole
 * procedure out of a browser's reach. A scan or a location is a claim about WHERE or WHICH,
 * and a claim about place that the person being checked could have made from their sofa is
 * not evidence of place — so those need an attested surface even though no instrument pairs.
 */
export function tierFor(steps: DraftStep[]): "open" | "attested" | "instrumented" {
  const fields = steps.flatMap((s) => s.fields ?? []);
  if (fields.some((f) => f.source === "instrument")) return "instrumented";
  if (fields.some((f) => f.kind === "scan" || f.kind === "location")) return "attested";
  return "open";
}

/**
 * Everything wrong with this draft, in the shop's terms rather than the schema's.
 *
 * Returned as a list rather than thrown one at a time: somebody is standing at a screen at the
 * end of a fourteen-turn interview, and finding out about one fault per attempt is how you
 * lose them.
 */
export function faults(draft: Draft): string[] {
  const out: string[] = [];
  const key = (draft.key ?? "").trim();
  const title = (draft.title ?? "").trim();

  if (!key) out.push("The procedure has no key.");
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key))
    out.push(`"${key}" is not a usable key — lower case and hyphens only.`);
  if (!title) out.push("The procedure has no title.");
  if (!Number.isInteger(draft.strictness) || draft.strictness! < 0 || draft.strictness! > 3)
    out.push("Strictness must be 0, 1, 2 or 3.");

  const steps = draft.steps ?? [];
  if (steps.length === 0) out.push("A procedure with no steps cannot be performed.");

  steps.forEach((step, i) => {
    const where = `Step ${i + 1}`;
    if (!(step.title ?? "").trim()) out.push(`${where} has no title.`);
    // A step nobody can justify is a step to cut — the Scoper is told this outright, and a
    // step that arrives without its reason is a step the shop never actually explained.
    if (!(step.explanation ?? "").trim())
      out.push(`${where} does not say why it exists.`);
    if (!Number.isInteger(step.max_add_fields) || step.max_add_fields! < 0)
      out.push(`${where} has no cap on how many times the Inspector may ask for more.`);

    const fields = step.fields ?? [];
    if (fields.length === 0) out.push(`${where} captures nothing, so it proves nothing.`);

    fields.forEach((f) => {
      const name = `${where}, "${f.key ?? "unnamed field"}"`;
      if (!(f.key ?? "").trim()) out.push(`${where} has a field with no key.`);
      if (!KINDS.includes(f.kind ?? "")) out.push(`${name} has no usable kind.`);
      if (!SOURCES.includes(f.source ?? "")) out.push(`${name} does not say where it comes from.`);
      if (!(f.prompt ?? "").trim()) out.push(`${name} does not tell the technician what to do.`);
      if (!(f.guidance ?? "").trim())
        out.push(`${name} does not say what good looks like before the capture.`);
      if (!Number.isInteger(f.required_at_strictness))
        out.push(`${name} does not say at what strictness it is required.`);

      const rule = f.acceptance_rule ?? "";
      if (!RULES.includes(rule)) {
        out.push(`${name} has no acceptance rule, so nothing decides whether it passed.`);
        return;
      }

      // The refusals that matter. Each one is a way a field can look complete and decide
      // nothing — which is worse than an obviously missing field, because it files as a pass.
      const hasBound = typeof f.acceptance_min === "number" || typeof f.acceptance_max === "number";
      if (rule === "within" && !hasBound)
        out.push(`${name} is judged "within" but nobody stated a figure. Ask the shop for the bound, or judge it another way.`);
      if (rule === "within" && !(f.acceptance_unit ?? "").trim())
        out.push(`${name} is judged "within" but the bound has no unit. A number without a unit is not a measurement.`);
      if ((rule === "matches" || rule === "consistent_with") && !(f.acceptance_target ?? "").trim())
        out.push(`${name} is judged "${rule}" but does not say what it resolves against.`);
      if (rule === "per_spec" && !(f.acceptance_target ?? "").trim())
        out.push(`${name} is judged "per_spec" but does not say where the figure is printed.`);

      // `signed_by` and `must_show` are deliberately NOT checked for a target or a description.
      //
      // Both were refused here at first, and running 64 drafts the Scoper had actually compiled
      // showed the refusals were wrong rather than the agent. field-def.schema.json makes both
      // fields nullable, and inspector.py:41-48 puts `guidance` in front of the model on every
      // judgement under the heading "what good looks like" — which the contract defines as "the
      // same rule the Inspector applies after it". So a must_show field carrying its rule in
      // guidance is complete, and a signature resolves against the authenticated member who
      // signed it. Refusing those would have blocked correct output at the moment a shop was
      // watching. Guidance is already required above, which is what makes this safe.

      // A choice offering only the answer that means the job went well cannot record a
      // failure. The contract says this; it is checkable here, so it is checked here.
      if (f.kind === "choice" && (f.choices ?? []).length < 2)
        out.push(`${name} offers fewer than two answers, so it cannot record the job going wrong.`);
    });
  });

  return out;
}

/** Ids and ordering, assigned here so that two compiles of the same interview agree. */
function toSteps(draft: Draft): Step[] {
  return (draft.steps ?? []).map((s, i) => ({
    id: `s${i + 1}`,
    index: i + 1,
    title: (s.title ?? "").trim(),
    condition: s.condition ?? null,
    explanation: (s.explanation ?? "").trim(),
    max_add_fields: s.max_add_fields ?? 2,
    fields: (s.fields ?? []).map((f) => ({
      key: (f.key ?? "").trim(),
      kind: f.kind,
      prompt: (f.prompt ?? "").trim(),
      source: f.source,
      required_at_strictness: f.required_at_strictness,
      choices: f.choices ?? [],
      acceptance_rule: f.acceptance_rule,
      acceptance_min: f.acceptance_min ?? null,
      acceptance_max: f.acceptance_max ?? null,
      acceptance_unit: f.acceptance_unit ?? null,
      acceptance_target: f.acceptance_target ?? null,
      acceptance_description: f.acceptance_description ?? null,
      guidance: (f.guidance ?? "").trim(),
    })) as FieldDef[],
  })) as Step[];
}

/** `front-brake-service` -> `proc_front_brake_service`. Readable in the console, which matters. */
const idForKey = (key: string) => `proc_${key.replace(/-/g, "_")}`;

/**
 * Compile, store, and freeze v1 — or the next version, if this shop has authored this job
 * before.
 *
 * Re-interviewing a job you already have is the ordinary case, not an error: the shop changed
 * how they do it, or the first pass missed a figure. Keying off `key` rather than minting a new
 * procedure means the second interview becomes v2 of the same thing, so the records made under
 * v1 still name the version that actually ran.
 */
export async function compileProcedure(
  tenant: TenantRef, byUid: string, draft: Draft,
): Promise<{ procedureId: string; version: number; tier: string }> {
  const problems = faults(draft);
  if (problems.length) throw new NotCompilable(problems);

  const db = adminDb();
  const key = draft.key!.trim();
  const procedures = db.collection("tenants").doc(tenant.id).collection("procedures");

  // The id is derived from the key, so re-authoring the same job lands on the same document
  // and `publishProcedure` increments rather than forking a second procedure with the same
  // name — which is how a shop ends up running two subtly different brake services.
  const existing = await procedures.where("key", "==", key).limit(1).get();
  const procedureId = existing.empty ? idForKey(key) : existing.docs[0].id;

  const steps = toSteps(draft);
  const tier = tierFor(draft.steps ?? []);
  const now = new Date().toISOString();

  const doc: Partial<Procedure> = {
    schema_version: 1,
    id: procedureId,
    tenant_id: tenant.id,
    key,
    title: draft.title!.trim(),
    strictness: draft.strictness!,
    minimum_tier: tier,
    disqualifiers: draft.disqualifiers ?? [],
    releases: draft.releases ?? [],
    steps,
    status: "drafting",
    origin: "scoper",
    updated_at: now,
    ...(existing.empty ? { created_at: now, version: 0, current_version: 0 } : {}),
  };

  await procedures.doc(procedureId).set(doc, { merge: true });

  // Publishing is a separate, audited act with a standing check on it, and it stays that way
  // here. Compiling writes a draft nobody can run; this is the line the procedure crosses.
  const { version } = await publishProcedure(tenant.id, procedureId, byUid);
  return { procedureId, version, tier };
}
