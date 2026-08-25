import "server-only";

// What a draft has to say before it may govern anything.
//
// Lifted out of compile.ts so that `publishProcedure` can apply it without importing the
// compiler that imports it back. That cycle is not a style complaint: publishing is the moment
// a procedure starts being the thing jobs are judged against, so the check belongs on the
// publish path — and until this file existed the check lived only on the Scoper's path, which
// meant a procedure authored by hand in the editor could be frozen with an empty step title,
// a `within` rule with no bound, and nothing to stop it. The interview was validated; the form
// was not; both freeze the same kind of document.
//
// Pure functions over a plain object. No database, no session, no `Procedure` import — a
// compiled procedure and a half-typed draft are both just shapes with steps and fields, and
// this file has to be able to judge either.

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
  required_at_strictness?: number;
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

    // 0-3 are the strictness levels; 4 is the level nothing can reach, which is how a step
    // says it is optional. Anything else is a number somebody typed that no reader can act on.
    const stepRequiredAt = step.required_at_strictness ?? 0;
    if (!Number.isInteger(stepRequiredAt) || stepRequiredAt < 0 || stepRequiredAt > 4)
      out.push(`${where} says it is required at strictness ${stepRequiredAt}, which is not a level.`);

    const fields = step.fields ?? [];
    if (fields.length === 0) out.push(`${where} captures nothing, so it proves nothing.`);

    // The refusal that keeps "optional" from becoming a tick box.
    //
    // A step that is REQUIRED at this procedure's strictness but whose every field is optional
    // at it is a step that must be performed and asks for no evidence. It is not merely
    // useless: `applyEffect` marks such a step performed on the first capture, so a shop could
    // make a seven-field inspection seal on one photograph by marking the other six optional
    // and never notice they had done it. Either the step needs one piece of evidence that is
    // actually required, or the step itself is the optional thing — and saying which is a
    // decision for the person authoring it, not a default for this file to pick.
    const strictness = draft.strictness ?? 0;
    const stepBinds = stepRequiredAt <= strictness;
    const anyFieldBinds = fields.some((f) => (f.required_at_strictness ?? 0) <= strictness);
    if (fields.length > 0 && stepBinds && !anyFieldBinds)
      out.push(
        `${where} must be performed but every one of its captures is optional, so it would pass on the first thing anybody sends. Require one of them, or mark the step itself optional.`,
      );

    fields.forEach((f) => {
      const name = `${where}, "${f.key ?? "unnamed field"}"`;
      if (!(f.key ?? "").trim()) out.push(`${where} has a field with no key.`);
      if (!KINDS.includes(f.kind ?? "")) out.push(`${name} has no usable kind.`);
      if (!SOURCES.includes(f.source ?? "")) out.push(`${name} does not say where it comes from.`);
      if (!(f.prompt ?? "").trim()) out.push(`${name} does not tell the technician what to do.`);
      if (!(f.guidance ?? "").trim())
        out.push(`${name} does not say what good looks like before the capture.`);
      if (!Number.isInteger(f.required_at_strictness)
        || f.required_at_strictness! < 0 || f.required_at_strictness! > 4)
        out.push(`${name} does not say at what strictness it is required. 0 to 3, or 4 for never.`);

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

      // A band belongs on a field that can produce a number.
      //
      // `within` is the only rule that compares a reading to a figure, and the only kind that
      // yields a reading is `measurement` — which is also the only kind the app refuses to let
      // anybody type. Put the band on a photo and the two halves come apart: the technician is
      // sent to the camera, the band is never applied to anything, and the fleet is left
      // reading a torque setting off a photograph of a wrench. That is not a hypothetical —
      // `proc_segway_xyber_brake_pad_replacement` v3 shipped `caliper_torque` as a photo
      // judged `within` 7.5 Nm, and no run of it has ever been able to satisfy the step.
      if (rule === "within" && f.kind !== "measurement")
        out.push(`${name} is judged "within" a numeric band but is a "${f.kind ?? "?"}" field, and nothing can read a number off one. Make it a measurement taken from an instrument, or judge it another way.`);

      // The mirror of the bound-nobody-stated fault above. That one files everything as a
      // pass; these file everything as a failure, which is just as useless and much harder to
      // argue with when the technician is standing there having done the work correctly.
      const lo = f.acceptance_min;
      const hi = f.acceptance_max;
      if (rule === "within" && typeof lo === "number" && typeof hi === "number") {
        if (lo > hi)
          out.push(`${name} accepts ${lo} to ${hi}, which is backwards — no reading is above the floor and below the ceiling.`);
        else if (lo === hi)
          out.push(`${name} accepts exactly ${lo} and nothing else. A real tool almost never lands on a figure to the decimal, so this is a box that cannot be ticked. Ask the shop what tolerance they work to.`);
      }
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
