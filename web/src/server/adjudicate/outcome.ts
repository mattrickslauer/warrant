// What the system DOES about what an agent said.
//
// The verdict is an input. This function is the decision. That distinction is the same one
// the Seal already embodies, and it is why a model being wrong here is survivable: every way
// a verdict can arrive malformed, over budget, contradicted or missing resolves to a defined
// outcome, and the conservative outcome is always that the step does not advance.
//
// Pure on purpose. It is the one piece of this spine worth exhaustive tests, and a function
// that reached Firestore could not have them.

export interface OutcomeInput {
  inspector: { output: Record<string, any>; valid: boolean; schemaErrors: string[] };
  /**
   * What became of the second question. Three states, and the third is not a convenience.
   *
   *  * **a reply** — the Skeptic was asked and answered.
   *  * **`null`** — it could not be asked. Absence is never agreement, so this HOLDS.
   *  * **`"not_applicable"`** — there is no scene for this evidence to belong to, so
   *    belonging is not a question that can be put. See the note where it is consumed.
   *
   * `null` and `"not_applicable"` are opposite conclusions and were once the same value,
   * which is how a typed answer came to be held for failing a question about photographs.
   */
  skeptic: { output: Record<string, any>; valid: boolean } | null | "not_applicable";
  addFieldsUsed: number;
  maxAddFields: number;
  /** The job's strictness, which sets the confidence a PASS has to clear. Defaults to 1. */
  strictness?: number;
  /**
   * The field's acceptance rule and, for `matches`, the value the evidence must carry.
   *
   * The Inspector is NOT shown this target — `inspector.py` withholds it deliberately — so
   * the comparison has to happen here. That is not tidiness; it is the only thing that works.
   */
  acceptance?: { rule?: string | null; target?: string | null };
  /**
   * The literal answer, when the evidence IS one — a choice tapped, a note typed, a name
   * signed. Null for a photograph.
   *
   * A `matches` rule is settled by comparing what the evidence says against what the
   * procedure requires, and for a photograph the only way to learn the first half is to have
   * a model read it — which is why `observed` exists and why the Inspector is blinded to the
   * target while producing it. An answer has no such gap. The string is already here, exactly
   * as it was submitted, and asking a model to type it back introduces a chance of error into
   * a comparison that had none.
   *
   * So the code reads it directly. This is the same principle `observed` serves, arriving at
   * the opposite implementation because the evidence is a different kind of thing: the model
   * reads, the code decides — and where there is nothing to read, the code simply decides.
   */
  answer?: string | null;
}

/**
 * The confidence a PASS must clear, by strictness. Mirrors `THRESHOLD` in
 * `agents/warrant/inspector.py`, which renders these same numbers into the prompt.
 *
 * The contract says it in prose — "Below the strictness threshold you must not return PASS" —
 * and until now nothing read `confidence` at all, so an Inspector that ignored that sentence
 * advanced a regulated step on a coin flip. Telling a model a rule and never checking it is
 * the exact shape of mistake this file exists to prevent everywhere else: the verdict is an
 * INPUT, and the threshold is ours to enforce, not the agent's to honour.
 */
export const THRESHOLD: Record<number, number> = { 0: 0.5, 1: 0.6, 2: 0.75, 3: 0.9 };

export function thresholdFor(strictness: number | undefined): number {
  return THRESHOLD[strictness ?? 1] ?? 0.6;
}

/**
 * Compare a transcription against what the procedure requires.
 *
 * Case and punctuation are ignored, because a label reading `X004-X2NVXZ` and a spec written
 * `x004x2nvxz` are the same part and refusing that would train everyone to ignore the check.
 * A `?` is NEVER a match: the Inspector is told to write one where a character is illegible,
 * and treating an admitted gap as a wildcard would undo the reason it is asked for.
 */
export function transcriptionMatches(observed: string, target: string): boolean {
  const normalise = (v: string) => v.toUpperCase().replace(/[^A-Z0-9?]/g, "");
  const a = normalise(observed);
  const b = normalise(target);
  if (!a || !b) return false;
  if (a.includes("?")) return false;
  return a === b;
}

export type Effect =
  | { kind: "accept_field" }
  | { kind: "add_field"; key: string; fieldKind: string; prompt: string }
  | { kind: "escalate"; question: string }
  | { kind: "hold"; why: string };

export function decideOutcome(input: OutcomeInput): Effect {
  const { inspector, skeptic, addFieldsUsed, maxAddFields, strictness } = input;

  // A malformed answer is a finding, not an exception — and it advances nothing. runtime.py
  // hands validation failures back rather than raising for exactly this reason.
  if (!inspector.valid) {
    return {
      kind: "hold",
      why: `the Inspector's answer did not satisfy its contract: ${
        inspector.schemaErrors.join("; ") || "unspecified"}`,
    };
  }

  const verdict = inspector.output.verdict;

  if (verdict === "ESCALATE") {
    const question = inspector.output.escalation_question;
    if (typeof question !== "string" || !question.trim()) {
      return { kind: "hold", why: "the Inspector escalated without naming the question" };
    }
    return { kind: "escalate", question };
  }

  if (verdict === "ADD_FIELD") {
    // Enforced here rather than trusted to the agent. The contract already tells the
    // Inspector to escalate when the budget is spent; an agent that ignored that could
    // otherwise ask a technician for one more photograph indefinitely.
    if (addFieldsUsed >= maxAddFields) {
      const last = inspector.output.add_field_prompt;
      return {
        kind: "escalate",
        question:
          `The evidence is still insufficient after ${maxAddFields} further requests.` +
          (last ? ` The last ask was: ${last}` : ""),
      };
    }
    const key = inspector.output.add_field_key;
    const fieldKind = inspector.output.add_field_kind;
    const prompt = inspector.output.add_field_prompt;
    if (!key || !fieldKind || !prompt) {
      return { kind: "hold", why: "ADD_FIELD arrived without the field it wants" };
    }
    return { kind: "add_field", key, fieldKind, prompt };
  }

  if (verdict !== "PASS") {
    return { kind: "hold", why: `unrecognised verdict ${JSON.stringify(verdict)}` };
  }

  // A PASS below the strictness threshold is not a pass.
  //
  // Escalation rather than a hold, and the distinction matters: a hold waits for nobody, and
  // an Inspector that passed a regulated step at 0.4 has produced a specific question a person
  // can answer by looking at the same photograph. The numbers are put in the question because
  // "the model was unsure" is not something a technician can act on and "0.40 against 0.90 on
  // a regulated procedure" is.
  const floor = thresholdFor(strictness);
  const confidence = inspector.output.confidence;
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    return { kind: "hold", why: "the Inspector passed without a usable confidence" };
  }
  if (confidence < floor) {
    return {
      kind: "escalate",
      question:
        `The Inspector passed this at ${confidence.toFixed(2)} confidence, below the ` +
        `${floor.toFixed(2)} a strictness-${strictness ?? 1} procedure requires. ` +
        `A person has to look at the evidence.`,
    };
  }

  // A `matches` rule is decided HERE, from what the Inspector transcribed, and never by the
  // Inspector itself.
  //
  // It is not shown the expected value at all (see inspector.py). Shown it, the agent quoted
  // the target back verbatim off a label too washed out to read — and instructing it not to
  // did not help, because a string in the context is indistinguishable from a string on the
  // box. Blinded, on that same photograph, it answered "extremely faint and unreadable" and
  // asked for another; on a clear one it transcribed correctly. So the model reads, and this
  // decides.
  const rule = input.acceptance?.rule;
  const target = input.acceptance?.target;
  // A `matches` rule with nothing to match against is a PROCEDURE DEFECT, and it used to pass.
  // `rule === "matches" && target` skipped the whole comparison when the target was empty or
  // absent, so the field advanced on the Inspector's confidence alone — on the one rule whose
  // entire design is that the Inspector is blinded and the comparison happens here. The step
  // holds instead, which is the conservative direction and names the defect to whoever reads it.
  if (rule === "matches" && !target) {
    return {
      kind: "hold",
      why: "this field's rule is `matches` but the procedure names no value to match against, " +
           "so there is nothing the transcription could be checked against",
    };
  }
  if (rule === "matches" && target) {
    // The answer itself where there is one, and the transcription only where reading was
    // required. Without the first branch every CHOICE field judged `matches` held: the
    // Inspector is told to "put in `observed` exactly what you can read in the image,
    // character by character", there is no image behind a tapped answer, and a model asked
    // to transcribe nothing returns nothing — so the field failed for want of a transcription
    // of a string the server was holding all along.
    const answer = typeof input.answer === "string" && input.answer.trim()
      ? input.answer
      : null;
    const observed = answer ?? inspector.output.observed;
    if (typeof observed !== "string" || !observed.trim()) {
      return {
        kind: "hold",
        why: "the Inspector passed a `matches` rule without transcribing what it read, so " +
             "there is nothing to compare against the procedure",
      };
    }
    if (!transcriptionMatches(observed, target)) {
      return {
        kind: "escalate",
        question:
          `What the evidence reads — ${observed} — is not what the procedure requires: ` +
          `${target}. Either the wrong part was fitted or the label was misread; both need ` +
          `a person.`,
      };
    }
  }

  // A PASS is the only verdict the Skeptic can overturn, and the only one where its silence
  // matters. The Inspector judged whether the evidence is good enough; the Skeptic judged
  // whether it is evidence of THIS machine, on THIS job, at THIS moment. A step advanced on
  // an unanswered second question is exactly the tick in the box this product abolishes.
  // The one case where silence is not a failure.
  //
  // The Skeptic asks whether a frame is of THIS machine, on THIS job, at THIS moment, and it
  // answers from image content, from capture metadata and from perceptual distance to earlier
  // photographs. A technician tapping "Responsive and quiet" produces none of those. There is
  // no scene, so there is nothing for the evidence to fail to belong to — and the agent is
  // instructed that if it cannot establish identity it must dissent, which made dissent the
  // only honest answer to a question nobody should have asked.
  //
  // That is not hypothetical. Every choice, text and signature answer in the product reached
  // the Skeptic with an empty media list, came back "you cannot establish identity from an
  // absence", and escalated a step the technician had answered correctly. `cases.ts` already
  // makes exactly this argument about a job that names no asset, where an empty shell "would
  // read as an asset it was handed and could not identify". The same reasoning, applied to
  // the media it was never given.
  //
  // What still guards a typed answer: Model Armor screens it before any model sees it, the
  // Inspector judges it, and a `matches` rule is compared in code above. Belonging is the one
  // question of the four that has no meaning here.
  if (skeptic === "not_applicable") {
    return { kind: "accept_field" };
  }
  if (skeptic === null) {
    return { kind: "hold", why: "the Skeptic could not be asked, so belonging is unestablished" };
  }
  if (!skeptic.valid) {
    return { kind: "hold", why: "the Skeptic's answer did not satisfy its contract" };
  }

  if (skeptic.output.belongs !== true) {
    // The contract: "Dissent is a deterministic escalation trigger: the step does not pass
    // and a named person is raised the same day." So this is an escalation, not a hold —
    // a hold waits for nobody, and a contested photograph needs a person, not a timeout.
    const kind = skeptic.output.mismatch_kind || "unstated";
    const prior = skeptic.output.prior_capture_ref;
    const because = skeptic.output.rationale ? ` ${skeptic.output.rationale}` : "";
    return {
      kind: "escalate",
      question:
        `The Skeptic dissented on ${kind}: this evidence may not belong to this job.${because}` +
        (prior ? ` It resembles the earlier capture ${prior}.` : ""),
    };
  }

  return { kind: "accept_field" };
}
