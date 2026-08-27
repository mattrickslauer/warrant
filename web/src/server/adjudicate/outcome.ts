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
   * The field's acceptance rule and whatever that rule needs to be settled from data:
   * `target` for `matches`, and the band and its unit for `within`.
   *
   * The Inspector is NOT shown this target — `inspector.py` withholds it deliberately — so
   * the comparison has to happen here. That is not tidiness; it is the only thing that works.
   *
   * The band is a different case and a worse one. The Inspector IS shown it, rendered into
   * the prompt as "accepts 6 to 9 Nm", and until now that was the ONLY place it was ever
   * read — so whether a measured value satisfied the procedure was settled by a model's
   * opinion of a number a tool had already answered exactly. See the `within` block below.
   */
  acceptance?: {
    rule?: string | null;
    target?: string | null;
    min?: number | null;
    max?: number | null;
    unit?: string | null;
  };
  /**
   * What a paired instrument reported for this field, if anything did.
   *
   * `source` distinguishes a number that came off a tool from one a person typed; both are
   * compared against the band, because a typed value outside the procedure's limits is not
   * made acceptable by having been typed. What the provenance affects is the CLASS the seal
   * stamps on it, which is `seal.ts`'s job and not this one's.
   */
  reading?: { value: number; unit?: string | null; source?: "instrument" | "human" } | null;
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
 * The rules this file settles from data rather than from the Inspector's word.
 *
 * `within` is arithmetic against a band a tool answered. `matches` is a string comparison
 * against a target the Inspector is deliberately blinded to. Everything else — `must_show`,
 * `per_spec`, `consistent_with`, `signed_by` — is a judgement about the world, which is
 * exactly the kind of thing a model is FOR, and which leaves nothing behind the model if it
 * is wrong. That distinction is what `lastOpinionFloor` below turns on.
 */
const CODE_VERIFIABLE = new Set(["within", "matches"]);

/**
 * The bar a PASS must clear when the system has nothing left to ask for.
 *
 * The regulated floor, whatever the procedure's own strictness. A step whose ADD FIELD budget
 * is spent has already been judged insufficient twice; there is no third request available and
 * no arithmetic behind the verdict, so the last opinion standing has to be the system's most
 * confident or a person looks at it. A genuine recovery clears this and is unaffected.
 */
const LAST_OPINION_FLOOR = THRESHOLD[3];

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
  | { kind: "hold"; why: string }
  /**
   * This capture already reached a verdict, and nothing was re-run.
   *
   * Never returned by `decideOutcome` — it is not an outcome of weighing evidence. `adjudicate()`
   * returns it when the capture is already marked adjudicated, so a replayed request is a cheap
   * no-op instead of four more model calls. It carries the prior decision ids, so an honest
   * retry after a dropped response still gets the answer.
   */
  | { kind: "already_decided" };

/**
 * An effect that came from weighing evidence.
 *
 * Everything `decideOutcome` can return. `already_decided` is deliberately outside it: it is
 * `adjudicate()` declining to re-run, not a conclusion about a capture, and the code that
 * APPLIES an effect to a step must never be handed one.
 */
export type DecidedEffect = Exclude<Effect, { kind: "already_decided" }>;

export function decideOutcome(input: OutcomeInput): DecidedEffect {
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

  // Read once, up here, because both the last-opinion floor and the two deterministic
  // comparisons below turn on which rule this field is judged under.
  const rule = input.acceptance?.rule;
  const target = input.acceptance?.target;

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

  // THE LAST OPINION AVAILABLE.
  //
  // `ADD_FIELD` on a spent budget already escalates, a few lines up. `PASS` on one did not,
  // and on a rule code cannot check that is the more dangerous of the two: the step has been
  // judged insufficient twice, there is no third request left, and nothing sits behind the
  // verdict but the model. `within` and `matches` are exempt because they were settled above
  // by arithmetic and by a string comparison, neither of which cares about the budget.
  if (!CODE_VERIFIABLE.has(String(rule ?? "")) && addFieldsUsed >= maxAddFields
      && confidence < LAST_OPINION_FLOOR) {
    return {
      kind: "escalate",
      question:
        `This step has already asked for more evidence ${maxAddFields} times and has nothing ` +
        `further it can ask for. The Inspector now passes it at ${confidence.toFixed(2)}, ` +
        `below the ${LAST_OPINION_FLOOR.toFixed(2)} required of a last opinion with no ` +
        "measurement behind it. A person has to look at the evidence.",
    };
  }

  // `within` IS ARITHMETIC, AND IT WAS NEVER PERFORMED.
  //
  // The band lived in the contract and was rendered into the Inspector's prompt, and nothing
  // in the system ever compared a number to it. A torque of 40 Nm against `within(6, 9)`
  // reached the record because a model said the photograph looked right — on the one rule
  // whose entire purpose is that a tool already answered the question exactly.
  //
  // "An inferred value may never overwrite a measured one" is the product's claim. This is
  // the four lines that make it true.
  if (rule === "within") {
    const { min, max, unit } = input.acceptance ?? {};
    const lo = typeof min === "number" && !Number.isNaN(min) ? min : null;
    const hi = typeof max === "number" && !Number.isNaN(max) ? max : null;

    // A measurement with no limits is not a measurement. Same argument as a `matches` rule
    // with nothing to match against, and the same conservative answer.
    if (lo === null && hi === null) {
      return {
        kind: "hold",
        why: "this field's rule is `within` but the procedure names no band to fall inside, " +
             "so there is no limit the reading could be checked against",
      };
    }

    const reading = input.reading;
    if (!reading || typeof reading.value !== "number" || Number.isNaN(reading.value)) {
      return {
        kind: "hold",
        why: "this field's rule is `within` and no usable reading reached the decision, so " +
             "there is nothing to compare against the band",
      };
    }

    // TWO NUMBERS IN DIFFERENT UNITS ARE NOT COMPARABLE, and converting one here would be
    // inventing a measurement rather than reading one. Held, so a person sees the mismatch.
    const want = (unit ?? "").trim().toLowerCase();
    const got = (reading.unit ?? "").trim().toLowerCase();
    if (want && got && want !== got) {
      return {
        kind: "hold",
        why: `the reading and the band are in different units — the tool reported ` +
             `${reading.unit} and the procedure requires ${unit} — so the two are not ` +
             "comparable, and nothing here will guess a conversion",
      };
    }

    if ((lo !== null && reading.value < lo) || (hi !== null && reading.value > hi)) {
      const band = lo !== null && hi !== null ? `${lo} to ${hi}` : lo !== null ? `at least ${lo}` : `at most ${hi}`;
      return {
        kind: "escalate",
        question:
          `The instrument read ${reading.value}${unit ? ` ${unit}` : ""}, and the procedure ` +
          `requires ${band}${unit ? ` ${unit}` : ""}. A tool answered this, so it is not a ` +
          "question of how the evidence looks — either the work is out of specification or " +
          "the tool is, and both need a person.",
      };
    }
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
