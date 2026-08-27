"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EvidenceChip } from "./EvidenceChip";
import { AgentStamp, type AgentName } from "./AgentStamp";
import type { HandoverFrame } from "@/data/handover";
import type { DataSource } from "@/data";

/**
 * How many verdicts a frame draws before it starts counting instead.
 *
 * Three, because the interesting shape on a grown step is exactly three long — escalate, add a
 * field, then pass — and showing that sequence is most of why the verdicts are on the frame at
 * all. Everything beyond it is in the trace, and the frame says how much.
 */
const FRAME_VERDICTS = 3;

/**
 * The evidence, one page at a time, with what the fleet said about it.
 *
 * The handover was a headline, two lists of step names and a flat trace — a summary of the
 * work rather than the work. What somebody wants at the moment they stop is to look at what
 * they just recorded and decide whether it will do, and a verdict is only readable next to the
 * thing it was a verdict ABOUT. So the photographs are on this page, and the decisions ride on
 * the frame they belong to rather than in a list somewhere below it.
 *
 * A carousel rather than a stack because the frames are peers and there may be a dozen: a
 * stack makes the reader scroll past nine to compare the second with the eleventh, and on a
 * page whose other half is a live verification feed, scrolling is exactly what it should not
 * cost to look at the evidence. Flipping is native scroll-snap, so a thumb-drag on a phone and
 * the arrow keys on a desk are the same gesture to the same element — no drag maths, no
 * library, and it keeps working when JavaScript is busy.
 *
 * `onFramed` is what makes "the fleet decisions highlighted" mean anything beyond this
 * component: the page above it lights up the same decisions in the full trace as you flip, so
 * the carousel and the trace are two views of one thing rather than two lists.
 */
export function EvidenceCarousel({
  frames, src, at, onFramed, onRedo,
}: {
  frames: HandoverFrame[];
  src: DataSource;
  /** Index of the frame in view. Owned above, so the page can jump the carousel to a step. */
  at: number;
  onFramed: (index: number) => void;
  /**
   * Do this step again. Null once the job has sealed, and that is not a styling decision: a
   * sealed record is what SURVIVES the workshop, and offering to redo a step of it would be
   * offering to change the one artifact whose whole value is that it cannot be changed.
   */
  onRedo: ((stepId: string) => void) | null;
}) {
  const rail = useRef<HTMLDivElement>(null);
  /** Suppresses the scroll listener while the rail is being moved programmatically. */
  const seeking = useRef(false);

  const go = useCallback((i: number) => {
    const el = rail.current;
    if (!el) return;
    const next = Math.max(0, Math.min(i, frames.length - 1));
    seeking.current = true;
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    onFramed(next);
    // Long enough for a smooth scroll to settle. Without it the listener below reads the
    // intermediate positions of our own animation and fights the jump it was asked to make.
    window.setTimeout(() => { seeking.current = false; }, 420);
  }, [frames.length, onFramed]);

  // Follow a drag. The rail is the source of truth for what is on screen — deriving the index
  // from scrollLeft rather than tracking gestures means a flick, a trackpad, a shift-wheel and
  // the buttons below all agree without any of them knowing about each other.
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const onScroll = () => {
      if (seeking.current || !el.clientWidth) return;
      const i = Math.round(el.scrollLeft / el.clientWidth);
      if (i !== at) onFramed(Math.max(0, Math.min(i, frames.length - 1)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [at, frames.length, onFramed]);

  // Jump when the page moves the cursor — tapping an issue elsewhere brings its frame here.
  useEffect(() => {
    const el = rail.current;
    if (!el || !el.clientWidth) return;
    if (Math.round(el.scrollLeft / el.clientWidth) === at) return;
    seeking.current = true;
    el.scrollTo({ left: at * el.clientWidth, behavior: "smooth" });
    window.setTimeout(() => { seeking.current = false; }, 420);
  }, [at]);

  if (frames.length === 0) {
    return (
      <p className="w-trace__why">
        Nothing was captured on this job. There is no evidence to show, and saying so is more
        use than an empty frame.
      </p>
    );
  }

  const here = frames[Math.max(0, Math.min(at, frames.length - 1))];

  return (
    <div className="w-carousel">
      <div
        className="w-carousel__rail"
        ref={rail}
        tabIndex={0}
        role="group"
        aria-label={`Evidence, ${frames.length} item${frames.length === 1 ? "" : "s"}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); go(at + 1); }
          if (e.key === "ArrowLeft") { e.preventDefault(); go(at - 1); }
        }}
      >
        {frames.map((f, i) => (
          <FramePage key={f.id} frame={f} src={src} active={i === at} total={frames.length} index={i} />
        ))}
      </div>

      <div className="w-carousel__bar">
        <button
          type="button"
          className="w-carousel__arrow"
          onClick={() => go(at - 1)}
          disabled={at === 0}
          aria-label="Previous capture"
        >
          <svg viewBox="0 0 24 24" aria-hidden width="18" height="18">
            <path d="M15 5 8 12l7 7" stroke="currentColor" strokeWidth="2" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="w-carousel__dots">
          {frames.map((f, i) => (
            <button
              key={f.id}
              type="button"
              className={
                "w-carousel__dot" +
                (i === at ? " w-carousel__dot--on" : "") +
                (f.issues.length > 0 ? " w-carousel__dot--issue" : "")
              }
              onClick={() => go(i)}
              aria-label={`Step ${f.stepIndex}, ${f.stepTitle}${f.issues.length ? " — needs attention" : ""}`}
              aria-current={i === at}
            />
          ))}
        </div>

        <button
          type="button"
          className="w-carousel__arrow"
          onClick={() => go(at + 1)}
          disabled={at >= frames.length - 1}
          aria-label="Next capture"
        >
          <svg viewBox="0 0 24 24" aria-hidden width="18" height="18">
            <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Under the evidence rather than over it, because the question this answers is asked by
          looking: you read what the step produced, decide it will not do, and the way to do it
          again is where your eye already is. */}
      {onRedo && (
        <button
          type="button"
          className="w-btn w-btn--ghost w-btn--block"
          onClick={() => onRedo(here.stepId)}
        >
          Redo step {here.stepIndex} — {here.stepTitle}
        </button>
      )}
    </div>
  );
}

/** One page: the capture, what it is, and what the fleet made of it. */
function FramePage({
  frame, src, active, index, total,
}: {
  frame: HandoverFrame;
  src: DataSource;
  active: boolean;
  index: number;
  total: number;
}) {
  return (
    <figure className="w-frame" aria-hidden={!active} aria-label={`${index + 1} of ${total}`}>
      <div className="w-frame__head">
        <span className="w-timeline__when">Step {frame.stepIndex}</span>
        <span className="w-frame__title">{frame.stepTitle}</span>
        <StatusMark status={frame.status} />
      </div>

      <Shot frame={frame} src={src} />

      <figcaption className="w-frame__body">
        <div className="w-frame__meta">
          {frame.fieldKey && <span className="w-frame__key">{frame.fieldKey}</span>}
          {/* Stamped by the Seal, absent until then. A field with no chip has not been
              classified yet — which is a different thing from being classified as nothing. */}
          {frame.provenance && <EvidenceChip cls={frame.provenance} />}
        </div>

        {/* In their words, and attributed. This is an assertion and the page says so. */}
        {frame.reason && (
          <p className="w-frame__reason">
            &ldquo;{frame.reason}&rdquo; — stated, not performed. The fleet decides what it
            costs the seal.
          </p>
        )}

        {/* THE HIGHLIGHT. What the fleet said about this step, on the thing it said it about.
            A verdict in a list twenty rows below a photograph is a verdict nobody connects to
            it. */}
        {frame.decisions.length > 0 ? (
          <div className="w-frame__verdicts">
            {/* The most recent, not all of them, and the count of the rest is stated below.
                A step the fleet has ruled on nine times over as many sweeps would otherwise
                make one page of the carousel thousands of pixels tall — which breaks the one
                promise the carousel makes, that every frame is the same shape. */}
            {frame.decisions.length > FRAME_VERDICTS && (
              <p className="w-frame__earlier">
                {frame.decisions.length - FRAME_VERDICTS} earlier verdict
                {frame.decisions.length - FRAME_VERDICTS === 1 ? "" : "s"} on this step, in the
                trace below.
              </p>
            )}
            {frame.decisions.slice(-FRAME_VERDICTS).map((d) => (
              <div className="w-frame__verdict" key={d.id}>
                <AgentStamp agent={d.agent as AgentName} />
                <div>
                  <div className="w-trace__head">
                    <span className="w-trace__agent">{d.agent}</span>
                    <span className="w-trace__verdict">{d.verdict}</span>
                  </div>
                  <p className="w-trace__why">{d.rationale}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="w-frame__pending">
            <span className="w-frame__pulse" aria-hidden />
            No verdict on this one yet. Verification runs behind you.
          </p>
        )}

        {/* Anything still waiting on a person, on this step. Named here as well as in the
            notices above, because this is the page where somebody is actually looking at the
            evidence the ask is about. */}
        {frame.issues.map((issue, n) => (
          <p className="w-frame__issue" key={`${issue.kind}:${n}`}>
            <b>
              {issue.kind === "question" ? "The fleet asked you something"
                : issue.kind === "hold" ? "Stuck, and waiting on a person"
                  : "One more thing needed"}
            </b>{" "}
            {issue.ask}
          </p>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * The bytes, fetched through the seam.
 *
 * Three states and they are deliberately distinguishable: still fetching, here, and never
 * there. A capture that resolves to nothing renders as a stated gap, never as a broken image —
 * "the image could not be fetched" and "there was never an image" are different claims about a
 * job, and a torn-image icon makes them look identical.
 */
function Shot({ frame, src }: { frame: HandoverFrame; src: DataSource }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "gone">("idle");

  useEffect(() => {
    if (!frame.captureId || !frame.kind) { setState("idle"); return; }
    let alive = true;
    setState("loading");
    void (async () => {
      const found = await src
        .mediaUrl(frame.jobId, frame.captureId!, frame.kind!)
        .catch(() => null);
      if (!alive) return;
      setUrl(found);
      setState(found ? "ready" : "gone");
    })();
    return () => { alive = false; };
  }, [src, frame.jobId, frame.captureId, frame.kind]);

  if (!frame.captureId) {
    return (
      <div className="w-frame__shot w-frame__shot--empty">
        {frame.value
          ? <p className="w-frame__value">{frame.value}</p>
          : <p className="w-frame__gap">No evidence captured on this step.</p>}
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="w-frame__shot w-frame__shot--empty">
        <span className="w-frame__spinner" aria-hidden />
        <p className="w-frame__gap">Fetching the capture…</p>
      </div>
    );
  }

  if (state === "gone" || !url) {
    return (
      <div className="w-frame__shot w-frame__shot--empty">
        <p className="w-frame__gap">Evidence stored, not reachable from here.</p>
      </div>
    );
  }

  return frame.kind === "video"
    ? <video className="w-frame__shot" src={url} controls playsInline />
    // eslint-disable-next-line @next/next/no-img-element
    : <img className="w-frame__shot" src={url} alt={`Step ${frame.stepIndex}: ${frame.stepTitle}`} />;
}

/** Where one step stands, in one word. The frame-level twin of `StatusPill`. */
function StatusMark({ status }: { status: HandoverFrame["status"] }) {
  return <span className={`w-frame__status w-frame__status--${status}`}>{status}</span>;
}
