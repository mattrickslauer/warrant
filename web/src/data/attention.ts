// What is waiting on a person, derived rather than flagged.
//
// The Kotlin twin is android/…/data/Attention.kt, and the two are the same rule written
// twice. That is deliberate and it is why this is a pure function over the contract rather
// than a field on the job: the fleet raises questions ASYNCHRONOUSLY — an Inspector runs long
// after the technician moved on — so "there is something for you" cannot be a boolean somebody
// remembers to set. It is a property of the step outcomes, and a surface that decided for
// itself what counted as outstanding would drift from the one that decided what counted as
// sealed. See seal.ts, which draws the same line.
//
// This file exists because the browser had no version of it at all. The phone read
// `added_fields`, `escalation_question` and `hold_reason` off the step outcomes and drew each
// one; the browser read none of them, so an agent asking for one more photograph, or asking a
// person a question, reached the app and stopped there. What the web job screen showed instead
// was a list built from step STATUS alone, which cannot tell you what is being asked.

import type { Job, FieldDef, StepOutcome } from "@/generated/types";

/** What kind of thing is waiting, which decides what a person can do about it. */
export type AttentionKind =
  /** An agent asked a person a question it could not answer from the evidence. */
  | "question"
  /**
   * An agent DID answer and the answer could not be acted on — a malformed verdict, an
   * unreachable fleet. Distinct from `question` because nobody asked anything: what is needed
   * is a person deciding, not a person explaining.
   */
  | "hold"
  /**
   * The form grew. An agent appended a field because the declared evidence was insufficient,
   * and that field is still empty.
   */
  | "evidence";

/**
 * One thing waiting on a person.
 *
 * Carries the answer as well as the ask, because a question with its answer deleted is
 * unreadable to whoever checks this later — and that reader is the only one who matters.
 */
export interface OpenItem {
  stepId: string;
  kind: AttentionKind;
  /** What is being asked, in the words it was asked in. */
  ask: string;
  /** The field an agent appended, for `evidence`. Null for the other two. */
  field: FieldDef | null;
  /** What somebody already said, if anybody has. */
  answer: string | null;
  answeredBy: string | null;
  /** Nobody has said anything yet. */
  outstanding: boolean;
}

/**
 * A step is only ever waiting on somebody while it is PENDING.
 *
 * Every other status is an outcome — performed, or one of the three that explain why not — and
 * an outcome is not a question. The same line `readyToSeal` draws, deliberately: if a step can
 * seal, nothing is owed on it, and two screens disagreeing about that is how a job ends up
 * nagging about a step it has already closed.
 */
const isOpen = (s: StepOutcome) => (s.status ?? "pending") === "pending";

/**
 * Everything waiting on a person in this job, in step order.
 *
 * An answered question stays in the list. It has not gone away — the fleet has still to rule on
 * what was said — and dropping it the moment somebody typed would make the screen claim a
 * settlement that has not happened.
 */
export function openItems(job: Job): OpenItem[] {
  return (job.steps ?? []).filter(isOpen).flatMap((step) => {
    const items: OpenItem[] = [];

    const question = step.escalation_question?.trim();
    if (question) {
      items.push({
        stepId: step.step_id,
        kind: "question",
        ask: question,
        field: null,
        answer: step.escalation_answer ?? null,
        answeredBy: step.escalation_answered_by ?? null,
        outstanding: !step.escalation_answer?.trim(),
      });
    }

    const hold = step.hold_reason?.trim();
    if (hold) {
      items.push({
        stepId: step.step_id, kind: "hold", ask: hold,
        field: null, answer: null, answeredBy: null, outstanding: true,
      });
    }

    // A field an agent added and nobody has filled. `accepted_fields` is the fleet's word for
    // "this one is done", and a filled field that has not been accepted yet is still in flight
    // rather than outstanding — so both count as satisfied here.
    const satisfied = new Set<string>([
      ...(step.accepted_fields ?? []),
      ...(step.fields ?? []).map((f) => f.key),
    ]);
    for (const field of step.added_fields ?? []) {
      if (satisfied.has(field.key)) continue;
      items.push({
        stepId: step.step_id, kind: "evidence", ask: field.prompt,
        field, answer: null, answeredBy: null, outstanding: true,
      });
    }

    return items;
  });
}

/** Whether anything in this job is waiting on a person. The badge on a list row. */
export const needsResponse = (job: Job): boolean => openItems(job).some((i) => i.outstanding);

/** How many things are waiting and nobody has spoken to. */
export const outstandingCount = (job: Job): number =>
  openItems(job).filter((i) => i.outstanding).length;

/**
 * Every field this step is being judged on: what the procedure declared, plus what an agent
 * appended since. The form GROWS, and a screen that renders only the declared half is a screen
 * that cannot show you what you are being asked for.
 */
export function fieldsForStep(
  step: { id: string; fields: FieldDef[] },
  outcome: StepOutcome | undefined,
): FieldDef[] {
  return [...step.fields, ...(outcome?.added_fields ?? [])];
}

/**
 * Where to land when a job is opened again.
 *
 * The first step that still owes something, and step one when nothing does. Walking somebody
 * back through four finished steps to reach the one that needs a photograph is how a resume
 * stops being used — and on the browser there was no resume at all: reopening a job put the
 * cursor on step one with every status forgotten, so a half-finished job looked untouched.
 *
 * A step is owed when it is pending and a person could still act on it. `deferred`, `waived`
 * and `impossible` are the three ways a step ends WITHOUT being performed, and every one of
 * them is written by the fleet — landing on one sends somebody back to a decision that has
 * already been made.
 */
export function firstOwed(job: Job, steps: Array<{ id: string }>): number {
  const status = new Map((job.steps ?? []).map((s) => [s.step_id, s.status ?? "pending"]));
  const i = steps.findIndex((s) => (status.get(s.id) ?? "pending") === "pending");
  return i < 0 ? 0 : i;
}
