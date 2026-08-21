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
  /** Null when the Skeptic could not be asked. Absence is never agreement. */
  skeptic: { output: Record<string, any>; valid: boolean } | null;
  addFieldsUsed: number;
  maxAddFields: number;
}

export type Effect =
  | { kind: "accept_field" }
  | { kind: "add_field"; key: string; fieldKind: string; prompt: string }
  | { kind: "escalate"; question: string }
  | { kind: "hold"; why: string };

export function decideOutcome(input: OutcomeInput): Effect {
  const { inspector, skeptic, addFieldsUsed, maxAddFields } = input;

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

  // A PASS is the only verdict the Skeptic can overturn, and the only one where its silence
  // matters. The Inspector judged whether the evidence is good enough; the Skeptic judged
  // whether it is evidence of THIS machine, on THIS job, at THIS moment. A step advanced on
  // an unanswered second question is exactly the tick in the box this product abolishes.
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
