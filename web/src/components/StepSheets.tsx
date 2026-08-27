"use client";
import { useEffect, useRef } from "react";
import { AgentTrace } from "./AgentTrace";
import { HoldBanner } from "./HoldBanner";
import { ReasonCapture } from "./ReasonCapture";
import type { Decision, Step } from "@/generated/types";

/**
 * Everything the step page cannot hold.
 *
 * A port of android/…/ui/job/JobSheets.kt. The page is one screen and does not scroll, which
 * is a promise about where the shutter is. The cost of that promise is that prose, the second
 * exit's keyboard and the fleet's reasoning have to live somewhere else — so they live here,
 * in sheets, each exactly one tap from the surface. Sheets may scroll; the page underneath
 * never does.
 */

function Sheet({
  title, onDismiss, children,
}: {
  title: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // `showModal` rather than an `open` attribute: it is what gives Escape, the focus trap and
  // an inert page underneath for free. Re-implementing those over a plain div is how a sheet
  // ends up leaving the keyboard focus on a shutter the person can no longer see.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    return () => { if (d.open) d.close(); };
  }, []);

  return (
    <dialog
      ref={ref}
      className="w-ground w-ground--work w-sheet"
      aria-label={title}
      onClose={onDismiss}
      // The backdrop is part of the dialog element, so a click lands on the dialog itself
      // rather than on any child. Anything inside stops here and does not dismiss.
      onClick={(e) => { if (e.target === ref.current) onDismiss(); }}
    >
      <div className="w-sheet__body">
        <div className="w-sheet__grab" aria-hidden />
        <div className="w-sheet__head">
          <p className="eyebrow">{title}</p>
          <button type="button" className="w-sheet__close" onClick={onDismiss} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden width="18" height="18">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
        <div className="w-sheet__scroll">{children}</div>
      </div>
    </dialog>
  );
}

/**
 * The ⓘ. Why this step exists, and what good looks like, at full length.
 *
 * Three things are said here: the INSTRUCTION (what to do), the EXPLANATION (why the step
 * exists and what goes wrong without it) and the GUIDANCE (what good looks like). The guidance
 * is the acceptance rule in plain language — the SAME rule the Inspector applies after the
 * capture, shown to the person before it. Every round trip it prevents is a model call the
 * Ledger does not spend, and a technician who does not have to guess.
 *
 * It lives behind the ⓘ rather than on the step page because prose is what used to make that
 * page scroll, and a page that scrolls is a page where the shutter is sometimes off-screen.
 */
export function StepBriefSheet({
  step, total, guidance, onDismiss,
}: {
  step: Step;
  total: number;
  guidance?: string | null;
  onDismiss: () => void;
}) {
  return (
    <Sheet title={`Step ${step.index} of ${total}`} onDismiss={onDismiss}>
      <div className="stack stack--lg">
        <h2 className="w-sheet__title">{step.title}</h2>
        {/* The Scoper's words to a human. Prose, not data. */}
        <p className="w-sheet__prose">{step.explanation}</p>
        {guidance && (
          <div className="w-sheet__guidance">
            <p className="eyebrow">What good looks like</p>
            <p>{guidance}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The ⚠. Exit two, with room for a keyboard and a microphone.
 *
 * Moving it into a sheet is not the same as burying it: the button that opens it is on the
 * bottom bar, the same size as the way forward and the same distance from the thumb. What
 * would have buried it is a menu.
 */
export function BlockedSheet({
  busy, onSubmit, onDismiss,
}: {
  busy?: boolean;
  onSubmit: (r: { kind: "voice" | "text"; transcript: string }) => void;
  onDismiss: () => void;
}) {
  return (
    <Sheet title="Can't do this step?" onDismiss={onDismiss}>
      <ReasonCapture busy={busy} onSubmit={(r) => { onSubmit(r); onDismiss(); }} />
    </Sheet>
  );
}

/** The pull-up. What the fleet decided, whether the data is real, and the seal if there is one. */
export function TraceSheet({
  decisions, sealedRecordId, fabricated, onDismiss,
}: {
  decisions: Decision[];
  sealedRecordId?: string | null;
  fabricated?: boolean;
  onDismiss: () => void;
}) {
  return (
    <Sheet title="What the fleet decided" onDismiss={onDismiss}>
      <div className="stack stack--lg">
        {fabricated && (
          // The build MUST say when it is serving fabricated data. A demo that looks like
          // production is how a judge gets misled, and we would rather be believed.
          <HoldBanner kind="waiting" title="Fixture data">
            This build runs the scripted demo timeline, not a live backend. Verdicts and costs
            below are fabricated.
          </HoldBanner>
        )}
        {decisions.length === 0 ? (
          <p className="w-trace__why">
            Nothing yet. Verification runs behind you — decisions land here as they arrive, and
            you can carry on in the meantime.
          </p>
        ) : (
          <AgentTrace decisions={decisions} />
        )}
        {sealedRecordId && (
          <div className="stack">
            <p className="eyebrow">Sealed</p>
            <p className="w-sheet__seal">{sealedRecordId}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
