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
// over a job with a step still owed is a lie told by a heading — and, since the carousel below
// was added, a photograph shown under the wrong verdict.

import type { Decision, Field, Job, Procedure, StepOutcome } from "@/generated/types";
import { openItems, type OpenItem } from "./attention";

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


// ------------------------------------------------------------------ what the carousel holds

/**
 * One page of the handover's evidence carousel.
 *
 * The handover used to be a headline, two lists of step names and a flat trace — which is a
 * summary of the work rather than the work. What a person actually wants at the moment they
 * stop is to look at what they just recorded and decide whether it will do, and that means the
 * photographs have to be ON this page rather than one navigation away in a record that does
 * not exist yet.
 *
 * A frame is per CAPTURE, not per step, because a step can hold more than one — the Inspector
 * appends a field and the step then carries two photographs that were judged separately. A
 * step that produced nothing still gets exactly one frame, carrying its reason: a job where
 * step three was explained rather than performed must not look, on the last screen anybody
 * reads, like a job where step three does not exist.
 */
export interface HandoverFrame {
  /** Stable across re-reads, so a carousel does not jump when a verdict lands. */
  id: string;
  /**
   * The job these bytes belong to, scoped, carried on the frame rather than passed beside it.
   *
   * The same reasoning as `StepEvidence` on the phone, which reads it off the outcome: a
   * renderer that takes the job id as a separate argument can be handed one job's id and
   * another job's frames, and the failure — a photograph from the wrong run — looks exactly
   * like a correct page.
   */
  jobId: string;
  stepId: string;
  stepIndex: number;
  stepTitle: string;
  status: StepOutcome["status"];
  /** Null on the placeholder frame a step with no evidence gets. */
  fieldKey: string | null;
  /**
   * What to fetch the bytes with, or null when there is nothing to fetch.
   *
   * This is the FIELD's `media_ref`, which holds a capture id — not a path. The two are
   * different things wearing the same name, and handing the first to storage as if it were the
   * second is the bug `EvidenceThumb` carries a paragraph about.
   */
  captureId: string | null;
  kind: Field["kind"] | null;
  /** A value field's answer, for the fields that have no object behind them. */
  value: string | null;
  /** Stamped by the Seal, absent until then. Never guessed here. */
  provenance: Field["provenance_class"] | null;
  /** What the technician said, when the step was explained rather than performed. */
  reason: string | null;
  /**
   * What the fleet said about THIS step, oldest first.
   *
   * Scoped to the step rather than the field, because that is the finest grain a `Decision`
   * actually carries — `step_id` and nothing below it. Pretending otherwise by matching on
   * rationale text would put a verdict about one photograph under another one.
   */
  decisions: Decision[];
  /** What is still waiting on a person, on this step. */
  issues: OpenItem[];
}

/**
 * Every page of the carousel, in the order the work happened.
 *
 * Job-level decisions — the ones with no `step_id`, which is how the Foreman's disposition
 * arrives — belong to no frame and are deliberately left out. They are still on the page,
 * under the full trace; what they are not is attached to a photograph they were not about.
 */
export function handoverFrames(
  job: Job,
  procedure: Procedure,
  decisions: Decision[],
): HandoverFrame[] {
  const waiting = openItems(job);
  const outcomes = new Map((job.steps ?? []).map((o) => [o.step_id, o]));

  return procedure.steps.flatMap((step): HandoverFrame[] => {
    const outcome = outcomes.get(step.id);
    const status = outcome?.status ?? "pending";
    const here = decisions.filter((d) => d.step_id === step.id);
    const issues = waiting.filter((i) => i.stepId === step.id);
    const reason = outcome?.reason_transcript?.trim() || null;

    const base = {
      jobId: job.id,
      stepId: step.id,
      stepIndex: step.index,
      stepTitle: step.title,
      status,
      reason,
      decisions: here,
      issues,
    };

    const filled = (outcome?.fields ?? []).filter(
      (f) => f.media_ref || f.value_text || f.value_choice || f.value_number != null,
    );

    // The placeholder. A step nobody answered is a page of the carousel like any other, and
    // the reason it was not answered is the most useful line on it.
    if (filled.length === 0) {
      return [{
        ...base,
        id: `${step.id}:-`,
        fieldKey: null,
        captureId: null,
        kind: null,
        value: null,
        provenance: null,
      }];
    }

    return filled.map((f) => ({
      ...base,
      id: `${step.id}:${f.key}`,
      fieldKey: f.key,
      // Only the kinds with an object behind them. A signature's `media_ref` would be a name.
      captureId: f.kind === "photo" || f.kind === "video" || f.kind === "scan"
        ? f.media_ref ?? null
        : null,
      kind: f.kind,
      // No trailing-zero strip: JavaScript already prints 4.0 as "4". The Kotlin twin needs
      // one because Double.toString does not.
      value: f.value_text ?? f.value_choice
        ?? (f.value_number != null
          ? [String(f.value_number), f.unit].filter(Boolean).join(" ")
          : null),
      provenance: f.provenance_class ?? null,
    }));
  });
}

/**
 * How far the fleet has got, for the line that has to keep moving while somebody watches it.
 *
 * `ruled` counts steps that have reached an outcome, NOT steps that passed — a deferred step
 * has been ruled on, and a progress line that only counted passes would stall for ever on a
 * job that is going to seal deficient. Optional steps are excluded from the total for the same
 * reason they cannot hold the seal open.
 */
export function verificationProgress(
  job: Job,
  procedure: Procedure,
): { ruled: number; total: number; settled: boolean } {
  const outcomes = new Map((job.steps ?? []).map((o) => [o.step_id, o]));
  const counted = procedure.steps.filter(
    (s) => (s.required_at_strictness ?? 0) <= job.strictness,
  );
  const ruled = counted.filter(
    (s) => (outcomes.get(s.id)?.status ?? "pending") !== "pending",
  ).length;
  return { ruled, total: counted.length, settled: ruled >= counted.length };
}
