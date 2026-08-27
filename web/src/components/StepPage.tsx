"use client";
import { useEffect, useState } from "react";
import { EvidenceChip, type ProvenanceClass } from "./EvidenceChip";
import type { PrimaryAction } from "@/data/step-action";

/**
 * One step, one screen, no scrolling.
 *
 * A port of android/…/ui/job/StepPage.kt, down to the three rules that hold it together. The
 * browser's job screen was a scrolling stack of cards with a 4:3 camera tile somewhere in the
 * middle of it, which meant the shutter's position depended on how long the step's explanation
 * was — and on a phone-sized viewport a wordy step put the one control that matters below the
 * fold.
 *
 * The whole page is a stack: the lens (or the workshop ground) fills it edge to edge, and
 * everything else is drawn over the top.
 *
 *  1. **It never scrolls.** Top chrome, a flexible middle, bottom chrome. Prose that will not
 *     fit is truncated and the full text moves behind the ⓘ — a step whose explanation pushed
 *     the shutter below the fold was the old layout's real failure.
 *  2. **The primary bar never moves.** Same place, same size, on every step and every field
 *     kind. Only the label changes — see `primaryActionFor`. A technician with dirty hands
 *     should never have to aim, and a button that moves is a button you have to look for.
 *  3. **Both exits stay on the surface.** Satisfy the step with the bar, or say why you cannot
 *     with the ⚠ beside it. There is no third way out and no skip.
 *
 * The redo pill is the one control that appears and disappears, and it is never two controls:
 * `onRedo` throws away the frame under review so the lens can be pointed at the same field
 * again, and `onRedoStep` — which takes its place once nothing on the step is outstanding —
 * empties the step so the whole of it can be done again. Without the second one a step the
 * fleet has just rejected is unreachable: every field is filled, so the page points at nothing
 * and the bar reads "Next step".
 */

/**
 * Something the technician needs to know that is not the step in front of them.
 *
 * Holds, errors and late verdicts all arrive as one of these. On the old page they were
 * full-width banners stacked above the work, which is what forced it to scroll — and a page
 * that scrolls is a page where the shutter is sometimes off-screen. So they collapse to a
 * single pill and expand on a tap. A blocking one expands itself.
 */
export interface Notice {
  headline: string;
  detail: string;
  blocking?: boolean;
  goToLabel?: string;
  onGoTo?: () => void;
  /**
   * Go to that step AND empty it, for the notice that is asking for the work to be done again.
   *
   * Beside `onGoTo` rather than instead of it, because they are different answers to a verdict
   * and only the person can pick. "Go to that step" is for an ask that ADDS — one more
   * photograph, alongside the four already taken. This one is for an ask that REJECTS, where
   * arriving at a step whose fields are all filled leaves the bar reading "Next step" and
   * nothing to tap.
   */
  onRedoStep?: () => void;
  onDismiss?: () => void;
}

/** One field of the current step, as the strip above the bar draws it. */
export interface FieldPip {
  key: string;
  label: string;
  filled: boolean;
  required: boolean;
}

export function StepPage({
  stepIndex, stepCount, title, prompt, guidance, evidence, notices,
  primary, onPrimary, onExit, onBrief, onBlocked, onTrace, onBack,
  onRedo, onRedoStep, pips = [], activePipKey, onPip,
  backdrop, center,
}: {
  stepIndex: number;
  stepCount: number;
  title: string;
  prompt?: string | null;
  guidance?: string | null;
  evidence: ProvenanceClass;
  notices: Notice[];
  primary: PrimaryAction;
  onPrimary: () => void;
  onExit: () => void;
  onBrief: () => void;
  onBlocked: () => void;
  onTrace: () => void;
  onBack?: (() => void) | null;
  onRedo?: (() => void) | null;
  onRedoStep?: (() => void) | null;
  pips?: FieldPip[];
  activePipKey?: string | null;
  onPip?: (key: string) => void;
  backdrop?: React.ReactNode;
  center?: React.ReactNode;
}) {
  return (
    // A ground in its own right, because this page renders outside `AppShell`: the surface
    // roles (--action, --on-action, the provenance hues) are defined per ground, and a
    // component that asks for --action off a ground gets nothing back.
    <div className="w-ground w-ground--work w-steppage">
      <div className="w-steppage__backdrop">{backdrop}</div>

      {/* Scrims. The chrome is white-on-whatever-the-lens-sees, and without these a step
          number lands on a chrome bumper and disappears. Cheap, and the difference between
          legible and not. */}
      <div className="w-steppage__scrim w-steppage__scrim--top" aria-hidden />
      <div className="w-steppage__scrim w-steppage__scrim--bottom" aria-hidden />

      <div className="w-steppage__chrome">
        <div className="w-steppage__top">
          <div className="w-steppage__toprow">
            <OverlayIcon label="Leave this job" onClick={onExit}>
              <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" fill="none" />
              </svg>
            </OverlayIcon>

            <StepTicks stepIndex={stepIndex} stepCount={stepCount} />

            <span className="w-steppage__evidence"><EvidenceChip cls={evidence} /></span>

            <OverlayIcon label="Why this step exists" onClick={onBrief}>
              <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
                <path d="M12 11v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="7.6" r="1.15" fill="currentColor" />
              </svg>
            </OverlayIcon>
          </div>

          {notices.map((n) => <NoticePill key={n.headline} notice={n} />)}

          {/* The instruction. Capped, on purpose: whatever does not fit lives behind the ⓘ,
              and the page keeps its promise not to scroll. */}
          <div className="w-steppage__brief">
            <p className="w-steppage__title">{title}</p>
            {/* The ask itself, and it is the largest thing on the screen. On a camera step
                this is the only sentence that matters: what you are being asked for, printed
                where the lens is pointed. */}
            {prompt && <p className="w-steppage__prompt">{prompt}</p>}
            {guidance && <p className="w-steppage__guidance">{guidance}</p>}
          </div>
        </div>

        {/* Everything the field itself needs. Takes what is left over and never pushes the
            bar off the bottom. */}
        <div className="w-steppage__center">{center}</div>

        <div className="w-steppage__bottom">
          {/* What the fleet decided, and the sealed id, live one tap away rather than on the
              page. */}
          <button type="button" className="w-steppage__trace" onClick={onTrace}>
            <svg viewBox="0 0 24 24" aria-hidden width="15" height="15">
              <path d="m7 14 5-5 5 5" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            What the fleet decided
          </button>

          {pips.length > 1 && (
            <div className="w-pips">
              {pips.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={
                    "w-pips__pip" +
                    (p.filled ? " w-pips__pip--filled" : "") +
                    (p.key === activePipKey ? " w-pips__pip--active" : "")
                  }
                  onClick={() => onPip?.(p.key)}
                  aria-current={p.key === activePipKey}
                >
                  <span className="w-pips__dot" aria-hidden />
                  <span className="w-pips__label">{p.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Exactly one of these, ever. They answer different questions and stacking them
              would put two destructive controls in a row above a bar the thumb has learned the
              position of: "throw this frame away" while a frame is under review, and "do this
              whole step again" once the step has gone quiet and the bar has become the way out
              of it. */}
          {onRedo ? (
            <RedoPill label="Redo this capture" onClick={onRedo} />
          ) : onRedoStep ? (
            <RedoPill label="Redo this step" onClick={onRedoStep} />
          ) : null}

          <div className="w-steppage__bar">
            {onBack ? (
              <OverlayIcon label="Previous step" onClick={onBack}>
                <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
                  <path d="M19 12H5m0 0 6-6m-6 6 6 6" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </OverlayIcon>
            ) : (
              <span className="w-steppage__spacer" aria-hidden />
            )}

            <PrimaryBar action={primary} onClick={onPrimary} />

            {/* Exit two. Never buried, never styled as a failure — it is the same size and the
                same distance from the thumb as the way forward. */}
            <OverlayIcon label="Can't do this step" onClick={onBlocked} tone="inferred">
              <svg viewBox="0 0 24 24" aria-hidden width="20" height="20">
                <path d="M12 4.5 21 19.5H3L12 4.5Z" stroke="currentColor" strokeWidth="1.8"
                  strokeLinejoin="round" fill="none" />
                <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="16.7" r="1.05" fill="currentColor" />
              </svg>
            </OverlayIcon>
          </div>
        </div>
      </div>
    </div>
  );
}

/** How far through, drawn as the steps themselves rather than a percentage. */
function StepTicks({ stepIndex, stepCount }: { stepIndex: number; stepCount: number }) {
  return (
    <div className="w-ticks">
      <span className="w-ticks__count">Step {stepIndex + 1} of {stepCount}</span>
      <span className="w-ticks__marks" aria-hidden>
        {/* Capped, so a twenty-step procedure does not push the chip off the row. */}
        {Array.from({ length: Math.min(stepCount, 8) }, (_, i) => (
          <i
            key={i}
            className={
              i === stepIndex ? "w-ticks__mark w-ticks__mark--here"
                : i < stepIndex ? "w-ticks__mark w-ticks__mark--done"
                  : "w-ticks__mark"
            }
          />
        ))}
      </span>
    </div>
  );
}

/**
 * A hold, an error or a late verdict, collapsed to one line.
 *
 * A blocking notice starts open, because the whole point of blocking is that it cannot be
 * scrolled past — and on this page there is nothing to scroll.
 */
function NoticePill({ notice }: { notice: Notice }) {
  const [open, setOpen] = useState(Boolean(notice.blocking));
  // Re-collapses when the notice under it changes identity, so a new ask does not inherit the
  // open state of the one it replaced.
  useEffect(() => { setOpen(Boolean(notice.blocking)); }, [notice.headline, notice.blocking]);

  return (
    <div className={`w-notice${notice.blocking ? " w-notice--blocking" : ""}`}>
      <button
        type="button"
        className="w-notice__head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="w-notice__dot" aria-hidden />
        <span className="w-notice__headline">{notice.headline}</span>
        {!open && <span className="w-notice__more">Tap</span>}
      </button>
      {open && (
        <div className="w-notice__body">
          <p className="w-notice__detail">{notice.detail}</p>
          {(notice.onGoTo || notice.onRedoStep || notice.onDismiss) && (
            <div className="w-notice__acts">
              {notice.onGoTo && (
                <button type="button" className="w-notice__act" onClick={notice.onGoTo}>
                  {notice.goToLabel ?? "Go there"}
                </button>
              )}
              {notice.onRedoStep && (
                <button type="button" className="w-notice__act" onClick={notice.onRedoStep}>
                  Redo that step
                </button>
              )}
              {notice.onDismiss && (
                <button
                  type="button"
                  className="w-notice__act w-notice__act--quiet"
                  onClick={notice.onDismiss}
                >
                  Later
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Throw work away and look again. One shape, two scopes — see the caller's ternary.
 *
 * Neither rewrites anything: the record already holding an earlier frame is untouched, because
 * a capture that happened is a thing that happened. What Redo does is put the lens back so a
 * better one can be taken beside it.
 *
 * Deliberately not the big bar. The bar's job is to move you forward; a control that destroys
 * work should be a separate, smaller, differently-shaped decision — while still landing on the
 * 44px target a gloved thumb can hit.
 */
function RedoPill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="w-redo" onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden width="17" height="17">
        <path d="M20 11a8 8 0 1 0-2.3 5.7" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" fill="none" />
        <path d="M20 5v6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round" fill="none" />
      </svg>
      {label}
    </button>
  );
}

/**
 * The one big target.
 *
 * Tall and fully rounded, flush against both side buttons. A capture reads white — it is a
 * shutter and shutters are white — and everything else reads in the action colour, so "record
 * something" and "move on" are never the same shape of decision.
 */
function PrimaryBar({ action, onClick }: { action: PrimaryAction; onClick: () => void }) {
  const shutter = action.kind === "capture";
  return (
    <button
      type="button"
      className={
        "w-primary" +
        (shutter ? " w-primary--shutter" : "") +
        (action.busy ? " w-primary--busy" : "")
      }
      onClick={onClick}
      disabled={!action.enabled}
    >
      {/* Busy wins the slot the shutter ring would have had. The bar is where the thumb is
          already resting and where the eye already is, so it is the right place to say the
          browser is still working — and a turning ring where the shutter was is unambiguous
          about which tap is still being honoured. */}
      {action.busy ? (
        <span className="w-primary__ring" aria-hidden />
      ) : shutter ? (
        <span className="w-primary__shutter" aria-hidden />
      ) : null}
      <span className="w-primary__label">{action.label}</span>
    </button>
  );
}

/**
 * A round overlay button on the 48px tap target.
 *
 * Dark disc rather than a bare glyph: a white icon over a white workbench is invisible, and
 * this screen cannot know what the lens is pointed at.
 */
function OverlayIcon({
  label, onClick, children, tone,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "inferred";
}) {
  return (
    <button
      type="button"
      className={`w-overlayicon${tone ? ` w-overlayicon--${tone}` : ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
