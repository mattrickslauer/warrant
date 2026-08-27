"use client";

/**
 * What the fleet is doing, right now, on a page nobody is touching.
 *
 * The handover used to be a snapshot. It said "verification runs behind you" and then sat
 * perfectly still — which looks identical whether the fleet is working, has finished, or
 * cannot be reached, and only the first of those is a state where waiting is the right thing
 * to do. So this counts the steps that have reached an OUTCOME (see `verificationProgress`,
 * which deliberately does not count passes) and keeps moving while they arrive.
 *
 * Three visible states, and they are different shapes rather than three colours of the same
 * shape: still running is a bar with a travelling sheen, sealed is a settled bar, and a
 * request this browser is waiting on is named in words underneath. A person who glances at
 * this must be able to tell "nothing has happened yet" from "nothing more will happen".
 *
 * `aria-live` is polite and the text is a sentence, because the whole point is that this
 * changes without anybody acting — a reader who cannot see the bar is exactly the reader who
 * would otherwise never learn the record sealed.
 */
export function LiveProgress({
  ruled, total, sealed, spending,
}: {
  ruled: number;
  total: number;
  sealed: boolean;
  /** What this browser is waiting on, in plain language. Null when it is idle. */
  spending: string | null;
}) {
  const done = total > 0 && ruled >= total;
  const pct = total > 0 ? Math.round((ruled / total) * 100) : 0;
  const state = sealed ? "sealed" : done ? "settled" : "running";

  return (
    <div className={`w-live w-live--${state}`}>
      <div
        className="w-live__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={ruled}
        aria-label="Steps the fleet has ruled on"
      >
        <span className="w-live__fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="w-live__say" role="status" aria-live="polite">
        {sealed
          ? `Sealed. All ${total} step${total === 1 ? "" : "s"} ruled on, and the record is written.`
          : done
            ? `Every step has an outcome. The record seals once the fleet signs off — this page will say so.`
            : `Verification running — ${ruled} of ${total} step${total === 1 ? "" : "s"} ruled on so far.`}
      </p>
      {/* Named work, not a spinner. "Handing this to the fleet…" and "Saving this capture…"
          are different seconds and the person is entitled to know which one they are in. */}
      {spending && (
        <p className="w-live__spending" role="status" aria-live="polite">
          <span className="w-live__spinner" aria-hidden />
          {spending}
        </p>
      )}
    </div>
  );
}
