"use client";
import { useState } from "react";
import { EvidenceChip } from "./EvidenceChip";

/**
 * An answer with no object behind it: typed, or picked from what the procedure offers.
 *
 * Both live here rather than in two components because they are the same capture — kind
 * `text`, the answer in `media_ref`, nothing in Cloud Storage — and the library is
 * deliberately small. What differs is only where the value comes from, which is the one
 * thing this draws.
 *
 * IT IS NOT THE SIGNATURE CONTROL, and that separation is the whole reason this file exists.
 * A `text` field used to be handed to `SignatureInput`, so "What did you set them to?"
 * appeared under a box labelled "Your name" with a button reading "Sign it". Android hit the
 * mirror image of this and wrote it down in `StepAction.usesKeyboard`: a choice field with no
 * branch fell through to a blank line, "the technician typed their name into it, which was
 * then judged against 'Responsive and quiet' and escalated". A control is a claim about what
 * kind of answer a field takes, and these are three different claims.
 *
 * An empty `choices` array is a procedure defect, not a blank menu. Saying so and pointing at
 * the way out beats drawing nothing — that combination is what wedged a job on the phone.
 */
export function AnswerInput({
  prompt, choices, onAnswer, answered,
}: {
  prompt: string;
  /** The stated options, for a `choice` field. Undefined for free text. */
  choices?: string[];
  onAnswer: (value: string) => void;
  answered?: string | null;
}) {
  const [value, setValue] = useState("");

  if (answered) {
    return (
      <div className="w-sign w-sign--done">
        <EvidenceChip cls="asserted" />
        <p className="w-sign__name">{answered}</p>
        <p className="w-sign__note">Recorded as your answer. Nothing was checked.</p>
      </div>
    );
  }

  if (choices) {
    if (choices.length === 0) {
      return (
        <div className="w-sign">
          <p className="w-sign__label">{prompt}</p>
          <p className="w-sign__note">
            This step accepts one of a fixed set of answers and the procedure lists none. Say
            so with “Nobody could do this” below and carry on — the reason goes on the record
            and the fleet rules on it.
          </p>
        </div>
      );
    }
    return (
      <div className="w-sign">
        <p className="w-sign__label">{prompt}</p>
        {choices.map((c) => (
          <button key={c} className="w-btn w-btn--block" onClick={() => onAnswer(c)}>
            {c}
          </button>
        ))}
        <p className="w-sign__note">
          Your answer, attributed to you. Nothing here is measured.
        </p>
      </div>
    );
  }

  return (
    <div className="w-sign">
      <label className="w-sign__label" htmlFor="answer">{prompt}</label>
      <input
        id="answer"
        className="w-sign__field"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type the answer"
      />
      <p className="w-sign__note">
        Your answer, attributed to you. Nothing here is measured — a typed number is a claim
        about a reading, never a reading.
      </p>
      <button
        className="w-btn w-btn--block"
        disabled={!value.trim()}
        onClick={() => onAnswer(value.trim())}
      >
        Record it
      </button>
    </div>
  );
}
