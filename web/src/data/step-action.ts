// What the one big button at the bottom of a step means right now.
//
// The Kotlin twin is android/…/ui/job/StepAction.kt, and the two are the same rule written
// twice — the same arrangement as attention.ts and Attention.kt next door, and for the same
// reason. The step page has exactly one primary target and it never moves, so the only thing
// left to decide is what it SAYS and what it DOES. That decision lives here, in plain
// TypeScript with no React in it, because it is the only part of the layout that can be wrong
// in a way a screenshot would not show: a bar reading "Next step" on a step that is not
// finished, or "Capture" pointed at a measurement field, is a lie told by a button.
//
// This file exists because the browser had no version of it at all. The phone computed the
// bar; the browser drew a shutter inside a 4:3 tile and a "Next step" button under it, and
// those two controls could not express most of the states the phone already had — a field
// nobody can answer, a measurement with no instrument attached, a frame under review. So the
// surfaces disagreed about what a step was asking for, which is precisely the drift the twin
// files exist to prevent.

import type { FieldDef } from "@/generated/types";

/** Whether this field is required at the job's strictness. The contract's own rule. */
export function requiredAt(f: FieldDef, strictness: number): boolean {
  return strictness >= f.required_at_strictness;
}

export type ActionKind =
  /** Open the shutter on the field the lens is pointed at. */
  | "capture"
  /** Take the instrument's latest value onto the form. Never typed. */
  | "take_reading"
  /** No instrument attached, so the only honest next move is to go and attach one. */
  | "pair"
  /** Commit what the person typed. */
  | "record"
  /** Commit a name. */
  | "sign"
  /**
   * The procedure asked for something this screen can never produce, so the only honest move
   * is exit two.
   *
   * Not a skip. It opens the same ⚠ sheet the bottom bar already offers and the technician
   * states, in their words, what the procedure asked them for and why it could not be given.
   * The difference from tapping the ⚠ themselves is that the BAR says it — because a grey bar
   * over a question with no answers is indistinguishable from a broken app, and the person
   * standing there stops rather than reaching for a control they have no reason to think is
   * relevant.
   */
  | "declare"
  /** Every required field is filled. Move on. */
  | "advance"
  /** Same, on the last step. */
  | "finish";

export interface PrimaryAction {
  label: string;
  kind: ActionKind;
  enabled: boolean;
  /**
   * The device is doing the thing the last tap asked for, and has not finished.
   *
   * Separate from `!enabled`, which this also implies, because the two mean different things
   * to the person looking at the button. "Waiting for the tool" is disabled and idle: nothing
   * is happening, and nothing will until the tool reports. A capture being written is disabled
   * and WORKING. Rendered identically — a grey bar — the second one reads as a hung app, which
   * is exactly the complaint this exists to answer. See `working`.
   */
  busy: boolean;
}

/** Whether this field is satisfied through the lens rather than through a keyboard. */
export function usesCamera(f: FieldDef): boolean {
  return f.kind === "photo" || f.kind === "video" || f.source === "camera";
}

/**
 * Whether this field is satisfied by typing.
 *
 * Stated as its own rule for the same reason the measurement branch of `primaryActionFor` is:
 * the keyboard is a claim about what kind of answer a field takes, and the two kinds that must
 * never see one are easy to reach by accident. A measurement typed by hand is a lie about
 * provenance. A CHOICE typed by hand is subtler and was live on the phone: the step page had
 * no branch for it, so a field carrying three fixed answers fell through to the generic text
 * box — a blank line reading "Type the value" under "How do the brakes perform?". The options
 * were there in `FieldDef.choices` the whole time; nothing drew them.
 *
 * So this answers a keyboard question with a keyboard rule, and everything else — scan on a
 * human source, location — keeps the free text box it always had.
 */
export function usesKeyboard(f: FieldDef): boolean {
  return !usesCamera(f) && f.kind !== "measurement" && f.kind !== "choice";
}

/**
 * Why nobody could answer this field on any surface, in the shop's words — or null if they can.
 *
 * The distinction this draws is not "hard" versus "easy". A measurement with no instrument in
 * the room is not in here: pairing a tool is a real move a real person can go and make, and
 * the bar says so. What is in here is a field the PROCEDURE has made unperformable, where no
 * amount of effort, tooling or goodwill produces a value — the question has no answers.
 *
 * A procedure is allowed to be wrong. It is NOT allowed to trap the person performing it, and
 * those are separate promises: this names the fault so the bar can offer exit two, and the
 * fault itself is then on the record for the fleet to rule on.
 *
 * The final branch is the one that has no known case, and that is why it is there. Every kind
 * the page can draw is listed above it, so a kind added to the contract without a branch on
 * the step page arrives here as a stated fault instead of as a dead button.
 */
export function unanswerable(f: FieldDef): string | null {
  if (usesCamera(f)) return null;
  if (f.kind === "measurement") return null;
  if (f.kind === "signature") return null;
  if (f.kind === "choice") {
    return (f.choices?.length ?? 0) === 0
      ? "This step accepts one of a fixed set of answers and the procedure lists none."
      : null;
  }
  if (usesKeyboard(f)) return null;
  return `Nothing on this screen can produce a "${f.kind}" answer.`;
}

/**
 * Whether this field is still holding the step open.
 *
 * Required and empty, in the ordinary case. The exception is the whole point of this function
 * existing separately from `requiredAt`: a field the procedure made `unanswerable` stops
 * holding the step once the technician has stated why — `reasoned`.
 *
 * That is not the same as marking it satisfied, and the difference is the product. Nothing is
 * filled, nothing is accepted, and no capture is invented. What changes is who the step is
 * waiting on: before the reason it was waiting on a person who could never produce one, and
 * after it, on the fleet, which will read the reason and rule. The client cannot write
 * `performed`, `waived` or `impossible` — firestore.rules refuses all three — so releasing the
 * hands here cannot release the seal, which is exactly the property that makes it safe.
 */
export function holdsStep(
  f: FieldDef,
  strictness: number,
  reasoned: boolean,
  filled: boolean,
): boolean {
  if (!requiredAt(f, strictness)) return false;
  if (filled) return false;
  return !(reasoned && unanswerable(f) !== null);
}

/**
 * The field the page is currently pointed at.
 *
 * Normally the first required field that is still empty — the technician is walked forward and
 * never has to choose. `selected` overrides it, which is how the field strip lets somebody go
 * back and retake something already filled. Null means nothing is outstanding, and the bar
 * becomes the way out of the step.
 *
 * `reasoned` is whether exit two has already been taken on this step. It is passed in rather
 * than inferred because it is the one thing that can retire an unanswerable field: without it
 * the page points at the same impossible question forever, and a technician who has already
 * said why they cannot answer it is asked again on every return to the step.
 */
export function activeFieldFor(
  fields: FieldDef[],
  strictness: number,
  selected: string | null,
  reasoned: boolean,
  isFilled: (key: string) => boolean,
): FieldDef | null {
  if (selected) {
    const picked = fields.find((f) => f.key === selected);
    if (picked) return picked;
  }
  return fields.find((f) => holdsStep(f, strictness, reasoned, isFilled(f.key))) ?? null;
}

/**
 * The camera field whose frame is currently filling the screen, if any.
 *
 * A step can hold more than one lens field, and the backdrop can only draw one of them. While
 * something is still outstanding that is the active field — the picture you have just taken
 * and are deciding about. Once nothing is outstanding the step's own last frame stays up
 * behind "Next step", so you can still see what you recorded.
 *
 * It is also the answer to "what would Redo throw away". Redo is scoped to exactly this field
 * on exactly this step: the frame on screen goes, the lens comes back, and every other field
 * and every other step is left alone.
 */
export function framedFieldFor(
  fields: FieldDef[],
  active: FieldDef | null,
  hasFrame: (key: string) => boolean,
): FieldDef | null {
  if (active) return usesCamera(active) && hasFrame(active.key) ? active : null;
  return fields.find((f) => usesCamera(f) && hasFrame(f.key)) ?? null;
}

/**
 * The label and behaviour of the primary bar.
 *
 * `fieldFilled` is not redundant with a null `field`: a filled field can still be the active
 * one when the technician has deliberately gone back to redo it, and the bar has to offer the
 * retake rather than pretend there is nothing to do.
 */
export function primaryActionFor(opts: {
  field: FieldDef | null;
  fieldFilled: boolean;
  lastStep: boolean;
  instrumentConnected: boolean;
  instrumentHasReading: boolean;
  inputReady: boolean;
}): PrimaryAction {
  const { field, fieldFilled, lastStep, instrumentConnected, instrumentHasReading, inputReady } =
    opts;

  if (!field) {
    return lastStep
      ? { label: "Finish", kind: "finish", enabled: true, busy: false }
      : { label: "Next step", kind: "advance", enabled: true, busy: false };
  }

  // Before anything else, including the lens.
  //
  // A field nobody can answer must never reach the branches below, because every one of them
  // ends in a control that does nothing: a keyboard for a question with no answers, a "Record"
  // that stays grey however long you look at it. The bar names the fault and opens the way out
  // instead. See `unanswerable`.
  if (unanswerable(field) !== null) {
    return { label: "This can't be answered", kind: "declare", enabled: true, busy: false };
  }

  if (usesCamera(field)) {
    return {
      label: fieldFilled ? "Retake" : "Capture",
      kind: "capture",
      enabled: true,
      busy: false,
    };
  }

  // The measurement branch is the one that matters. There is no path through here that reaches
  // a keyboard, at any strictness, in any state — including the state where no instrument is
  // attached. "Cannot be satisfied" is a real outcome; a typed number wearing the measured chip
  // is not.
  if (field.kind === "measurement") {
    if (!instrumentConnected) {
      return { label: "Pair an instrument", kind: "pair", enabled: true, busy: false };
    }
    if (!instrumentHasReading) {
      return { label: "Waiting for the tool", kind: "take_reading", enabled: false, busy: false };
    }
    return {
      label: fieldFilled ? "Take it again" : "Take this reading",
      kind: "take_reading",
      enabled: true,
      busy: false,
    };
  }

  // NOT A "Sign" BUTTON, and not gated on anybody typing a name. A signature is satisfied from
  // the signed-in account the moment the step is shown — see `Attribution`, and the effect in
  // JobFlow that writes it — so this branch is only reached in the instant before that write
  // lands, or if nothing is signed in at all. Demanding a keystroke there would put the tick
  // back in the box; moving on is the honest bar.
  if (field.kind === "signature") {
    return lastStep
      ? { label: "Finish", kind: "finish", enabled: true, busy: false }
      : { label: "Next step", kind: "advance", enabled: true, busy: false };
  }

  return {
    label: fieldFilled ? "Change it" : "Record",
    kind: "record",
    enabled: inputReady,
    busy: false,
  };
}

/**
 * The bar while the browser is finishing what the last tap started.
 *
 * `what` is the work, named in plain language — "Saving this capture…", not "Loading…". Null
 * means nothing is in flight and the bar is left exactly as `primaryActionFor` computed it.
 *
 * Here rather than in the component for the same reason everything else in this file is: the
 * label on the one big button is a claim about what the browser is doing, and a claim that
 * outlives the work — a bar still reading "Saving…" over a finished capture — is a lie a
 * screenshot would not catch. The disable is not belt-and-braces either: the shutter fires on
 * the camera handle, which is still wired up while the frame is being written, so a second tap
 * during that second would take a second photograph into a slot that already has one under
 * review.
 */
export function working(action: PrimaryAction, what: string | null): PrimaryAction {
  return what === null ? action : { ...action, label: what, enabled: false, busy: true };
}
