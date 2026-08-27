"use client";
import { Attribution, AnswerInput, ReasonCapture } from "@/components";

/**
 * The specimens that cannot be drawn from a server component.
 *
 * `library/page.tsx` is a server component, and three primitives take a handler — a function
 * prop does not cross that boundary. They were simply missing from the gallery as a result,
 * which quietly broke the one promise this page makes: that a screen needing something not on
 * it comes back here first. A surface author reading the library had no way to discover
 * `AnswerInput` or `Attribution` at all, and those two are the replacement for a control that
 * was deliberately deleted — exactly the case where guessing produces the old mistake again.
 *
 * The handlers are no-ops. This is a gallery: nothing here is wired to a job.
 */

export function AttributionSpecimen() {
  return (
    <div className="stack">
      <Attribution prompt="Confirm the knife is stored safely" who="Ada Okafor" />
      <Attribution prompt="Confirm the knife is stored safely" who={null} />
    </div>
  );
}

export function AnswerInputSpecimen() {
  return (
    <div className="stack">
      {/* Free text — the answer only the person standing there can give. */}
      <AnswerInput prompt="What did you set them to?" onAnswer={() => {}} />
      {/* The same capture, but the procedure stated the options. */}
      <AnswerInput
        prompt="How did the lever feel?"
        choices={["Firm", "Spongy", "No resistance"]}
        onAnswer={() => {}}
      />
      {/* Answered. Recorded as asserted, and the note says nothing was checked. */}
      <AnswerInput prompt="What did you set them to?" onAnswer={() => {}} answered="26 Nm" />
    </div>
  );
}

export function ReasonCaptureSpecimen() {
  return <ReasonCapture onSubmit={() => {}} />;
}
