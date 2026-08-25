import "server-only";

// The Gemma screen's policy, in ordinary code.
//
// `agents/warrant/screen.py` states the same floor and the same actionable set, and the remote
// returns its own `acts_on` alongside the answer. This file exists anyway, and re-checks it,
// for the reason `outcome.ts` exists: a capture must never be short-circuited on the strength
// of a boolean the caller did not verify. The remote's `acts_on` is advice; this decides.
//
// WHAT THE SCREEN CAN AND CANNOT CAUSE. There is no answer in `EvidenceScreen` that means
// "satisfied" — the enum is UNUSABLE or NEEDS_JUDGEMENT and nothing else. So the strongest
// possible screen result is a technician being asked for another photograph, and the cheap
// model cannot advance a step, seal a record or release a machine even if it is completely
// wrong. That asymmetry is the entire argument for putting a small model on this path, and it
// is a property of the schema rather than of a prompt.
//
// The synthesised verdict below goes through `decideOutcome` unchanged, which is the second
// half of the same argument: the screen does not get its own gate, its own budget or its own
// escalation path. It borrows the Inspector's. So a screen that fires on a step whose ADD
// FIELD budget is spent escalates to a person exactly as the Inspector would have, and nothing
// about the ADD FIELD circuit breaker has to know the screen exists.

import type { OutcomeInput } from "./outcome";

/**
 * How sure an UNUSABLE has to be before it is acted on.
 *
 * Mirrors `SCREEN_FLOOR` in `agents/warrant/screen.py`. High, and deliberately NOT a function
 * of strictness: this is a claim about the frame, not about the procedure, and a photograph
 * too dark to read is too dark whether the job is a log or a regulated one. Below the floor
 * the capture goes to the judge, which is what would have happened with no screen at all.
 */
export const SCREEN_FLOOR = 0.85;

/**
 * The defects the screen may act on. Mirrors `ACTIONABLE` in `screen.py`.
 *
 * Every one of them is a property of the IMAGE. None of them is a claim about the work, and
 * that boundary is the one worth policing: a screen answering `pads_worn_out` or
 * `part_number_mismatch` would be the cheap model refusing a job it was never shown the rule
 * for. Those findings belong to the Inspector, which is given the acceptance rule, the
 * strictness and the reading — none of which the screen ever sees.
 */
export const ACTIONABLE_DEFECTS = new Set([
  "nothing_in_frame",
  "too_dark",
  "too_blurred",
  "subject_absent",
  "subject_obstructed",
  "photograph_of_a_screen",
]);

export interface ScreenReply {
  output: Record<string, any>;
  valid: boolean;
  actsOn?: boolean;
}

/**
 * Whether this screen answer may stop the capture before the judge is asked.
 *
 * Each clause is a way for the answer itself to be unusable. A screen that fails any of them
 * is not disobeyed — it is simply not acted on, and the capture goes to Flash, which is the
 * no-screen behaviour. There is no path here that makes the outcome worse than not screening.
 */
export function actsOnScreen(reply: ScreenReply, floor: number = SCREEN_FLOOR): boolean {
  // An answer that failed its own contract is never acted on, whatever it says. Same rule as
  // `decideOutcome` applies to the Inspector, and for the same reason.
  if (!reply.valid) return false;
  const out = reply.output ?? {};
  if (out.screen !== "UNUSABLE") return false;
  if (typeof out.defect !== "string" || !ACTIONABLE_DEFECTS.has(out.defect)) return false;
  if (typeof out.retake_prompt !== "string" || !out.retake_prompt.trim()) return false;
  // `typeof true === "boolean"`, so a bool cannot slip through as 1.0 here the way it can in
  // Python. NaN can, and would compare false against any floor — but say so explicitly rather
  // than relying on that.
  if (typeof out.confidence !== "number" || Number.isNaN(out.confidence)) return false;
  return out.confidence >= floor;
}

/**
 * The screen's answer, in the shape `decideOutcome` already knows how to gate.
 *
 * Deliberately an ADD_FIELD and never anything else. ADD_FIELD is the one Inspector verdict
 * that asks for more evidence without asserting anything about the machine, which is exactly
 * the authority the screen has — and `decideOutcome` handles it without ever consulting the
 * Skeptic, so no capture is advanced on an unanswered belonging question by this path.
 *
 * `confidence` is carried across honestly. It is the screen's confidence in the DEFECT, which
 * is not the same quantity as the Inspector's confidence that the acceptance rule is
 * satisfied — but `decideOutcome` reads confidence only on a PASS, and this is never a PASS.
 */
export function inspectorVerdictFromScreen(
  reply: ScreenReply,
  field: { key: string; kind: string },
  addFieldsUsed: number,
): OutcomeInput["inspector"] {
  const out = reply.output ?? {};
  return {
    output: {
      verdict: "ADD_FIELD",
      confidence: out.confidence,
      rationale: out.rationale || `Screened as ${out.defect} before the judge was asked.`,
      // A new key, as the contract requires, and unique per attempt so a second screen on the
      // same field cannot collide with the first. `addFieldsUsed` is already the count of
      // requests spent on this step, so it numbers them in the order they were asked.
      add_field_key: `${field.key}__retake_${addFieldsUsed + 1}`,
      // A retake of a photograph is a photograph. Changing the kind here would let the screen
      // alter the shape of the form, which is the Inspector's to do and not its.
      add_field_kind: field.kind,
      add_field_prompt: out.retake_prompt,
      escalation_question: null,
      observed: null,
    },
    valid: true,
    schemaErrors: [],
  };
}

/**
 * What the ledger and the record should say about a screened capture.
 *
 * Named rather than inlined because the saving is the product argument and it has to be
 * countable: a decision row carrying `gemma-3-4b` is a Flash call that never had to happen,
 * and the operator view totals exactly these.
 */
export function screenSaving(reply: ScreenReply): { screened: true; defect: string } | null {
  return actsOnScreen(reply)
    ? { screened: true, defect: String(reply.output.defect) }
    : null;
}
