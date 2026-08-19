"use client";
import { useState } from "react";
import { EvidenceChip } from "./EvidenceChip";

/**
 * The asserted class, and the only honest way to collect it.
 *
 * Nothing here is checked. A person types their name and says a thing is so, and the record
 * carries it as their claim, attributed to them — not as something the system verified.
 * Saying that out loud on the control itself is the point.
 */
export function SignatureInput({
  prompt, onSign, signed,
}: { prompt: string; onSign: (name: string) => void; signed?: string | null }) {
  const [name, setName] = useState("");

  if (signed) {
    return (
      <div className="w-sign w-sign--done">
        <EvidenceChip cls="asserted" />
        {/* Sans, italic: a person said this. Mono would imply a machine produced it. */}
        <p className="w-sign__name">{signed}</p>
        <p className="w-sign__note">Recorded as your claim. Nothing was checked.</p>
      </div>
    );
  }

  return (
    <div className="w-sign">
      <label className="w-sign__label" htmlFor="sign">{prompt}</label>
      <input
        id="sign"
        className="w-sign__field"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        autoComplete="name"
      />
      <p className="w-sign__note">
        This goes on the record as an assertion, attributed to you. Nothing here is verified —
        that is what makes it honest.
      </p>
      <button className="w-btn w-btn--block" disabled={!name.trim()} onClick={() => onSign(name.trim())}>
        Sign it
      </button>
    </div>
  );
}
