"use client";
import { EvidenceChip } from "./EvidenceChip";

/**
 * Who the record attributes this to — STATED, never collected.
 *
 * THIS USED TO BE A CONTROL, AND THE CONTROL WAS THE PRODUCT'S OWN ANTITHESIS.
 *
 * A `signature` field put a box on the screen and asked the person to put their name to a
 * claim nothing checks: "confirm the knife is stored safely", and the button says Sign it.
 * That is a tick in a box. It is the precise practice Warrant exists to replace, reproduced
 * inside Warrant, and it proved exactly nothing — a person who would tick the box on paper
 * ticks it here, and the record ends up carrying an assertion dressed as a step that passed.
 *
 * Shortening the ceremony to one tap did not fix it. A tap that means "I assert this" is still
 * the tick; it is only faster to perform.
 *
 * What makes it redundant as well as wrong: THE ATTRIBUTION ALREADY EXISTS. The person is
 * signed in. `finalized_by` on the job is their authenticated act of saying the work is done,
 * `reason_by` is theirs on anything they could not do, and every capture is written under
 * their uid — firestore.rules refuses those fields unless they equal `request.auth.uid`, so
 * they are the one thing about the caller that cannot be forged. Asking for a name on top of
 * that collected a second copy of something already known, and gated the job on getting it.
 *
 * So nothing is asked. The field is satisfied from the session, the record says who it is
 * attributed to and that nothing about it was verified, and the CEILING on the record — see
 * `CeilingCard` — is what states the resulting gap honestly. An assertion is never promoted
 * to `measured` or `inferred`; the Seal computes provenance from readings and attestations
 * and this can never reach either. That is the honest handling of a claim no machine can
 * check: record it as a claim, attribute it to whoever was standing there, and say plainly on
 * the record that it was not proved.
 */
export function Attribution({ prompt, who }: { prompt: string; who: string | null }) {
  return (
    <div className="w-sign w-sign--done">
      <EvidenceChip cls="asserted" />
      <p className="w-sign__label">{prompt}</p>
      {who ? <p className="w-sign__name">{who}</p> : null}
      <p className="w-sign__note">
        {who
          ? "Attributed to you because you are signed in — nothing was asked and nothing was " +
            "checked. The record says so, and the ceiling on it says what that leaves unproved."
          : "This session has no name on it, so the record carries the claim without one. " +
            "Nothing here was verified."}
      </p>
    </div>
  );
}
