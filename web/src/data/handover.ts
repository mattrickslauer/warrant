// Where a job actually stands the moment the technician taps Finish.
//
// The Kotlin twin is android/…/ui/job/Handover.kt. Finish is not the same event as the seal,
// and pretending otherwise is the bug this file exists to prevent. The technician's last
// capture ends THEIR work; the record seals later, once every step has an outcome and the
// fleet has said so. Between those two moments the screen has to say something true, and there
// are only three true things it can say.
//
// Like step-action.ts, this is plain TypeScript with no React in it, because it is the part of
// the handover that can be wrong in a way a screenshot would not show: a page reading "Sealed"
// over a job with a step still owed is a lie told by a heading.

export type HandoverState =
  /** A step still has a required field empty. The job cannot seal, and saying so is the point. */
  | "outstanding"
  /** Everything is captured. The fleet has not finished, so there is no record id yet. */
  | "waiting"
  /** The record exists and has an id. This is the only state that may offer to open it. */
  | "sealed";

export function handoverStateFor(
  outstanding: number,
  sealedRecordId: string | null,
): HandoverState {
  // Outstanding wins even when a record id has somehow arrived: what the person in front of
  // the machine can still do outranks what the backend has already decided.
  if (outstanding > 0) return "outstanding";
  if (sealedRecordId !== null) return "sealed";
  return "waiting";
}

/**
 * The heading, and the sentence under it. Never "Done" — nothing here is done by itself.
 *
 * `explained` is how many steps ended with a stated reason instead of with evidence, and it
 * only changes the WAITING sentence — which used to read "Everything this procedure asked for
 * is captured" whatever had happened. On a job where a step could not be performed that was
 * false, and falsely reassuring in the one direction that matters: the technician walks away
 * believing the job will seal clean when it is going to seal deficient. The count is said
 * plainly instead, and the seal is still the fleet's to decide.
 */
export function handoverHeadline(
  state: HandoverState,
  outstanding: number,
  explained = 0,
): { headline: string; detail: string } {
  if (state === "outstanding") {
    return {
      headline: "Not finished yet",
      detail:
        `${outstanding} step${outstanding === 1 ? "" : "s"} still ` +
        `${outstanding === 1 ? "has" : "have"} something required and empty. This job cannot ` +
        "seal until every step has an outcome. Nothing you captured is lost — go back and " +
        "finish it whenever you like.",
    };
  }
  if (state === "waiting") {
    return {
      headline: "Handed to the fleet",
      detail:
        explained > 0
          ? `Nothing is left for you to do. ${explained} step${explained === 1 ? "" : "s"} ` +
            "ended with a stated reason rather than with evidence, and the fleet rules on " +
            `${explained === 1 ? "it" : "those"} — the record may well seal deficient. ` +
            "Verification runs behind you. You can leave; it will not stop."
          : "Everything this procedure asked for is captured. Verification runs behind you, " +
            "and the record seals when the last step has a verdict. You can leave; it will " +
            "not stop.",
    };
  }
  return {
    headline: "Sealed",
    detail:
      "The record is written and cannot be changed. It carries what went right and what did " +
      "not, and it names every agent that touched it.",
  };
}
