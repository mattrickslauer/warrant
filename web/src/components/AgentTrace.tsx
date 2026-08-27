"use client";
import { useState } from "react";
import type { Decision } from "@/generated/types";
import { AgentStamp, type AgentName } from "./AgentStamp";

/**
 * Which agent decided what, and on what basis. Every row carries the stamp of the agent
 * that made it and the version of that agent, because a record you cannot attribute is a
 * tick in a box with extra steps.
 *
 * `highlight` is a set of decision ids to lift out of the list. The handover's carousel passes
 * the verdicts on whatever capture is in view, so flipping a frame lights the rows about it —
 * which is what makes the two halves of that page one thing rather than a picture and an
 * unrelated log. Nothing is hidden when it is set: a trace that dropped the rows you were not
 * looking at would be a trace you cannot check.
 *
 * `max` bounds what is DRAWN, never what exists, and the difference is stated on the page. A
 * job left open across a few sweeps accumulates a verdict per firing per undecided capture —
 * a live run of the smile task reached the high dozens in under a minute, all of them the same
 * sentence about a green test pattern — and a page that renders every one is a page nobody can
 * read to the end. So the most recent are shown, the count that is not shown is named, and one
 * tap draws the lot. A silent truncation would be the worse failure of the two: a trace that
 * quietly stops is indistinguishable from a fleet that quietly stopped.
 */
export function AgentTrace({
  decisions, highlight, max,
}: {
  decisions: Decision[];
  highlight?: ReadonlySet<string>;
  max?: number;
}) {
  const [all, setAll] = useState(false);
  if (decisions.length === 0) {
    return <p className="w-trace__why">No decisions yet. Verification runs behind the capture.</p>;
  }
  // Newest last, which is the order they arrived and the order the page already reads in — so
  // "the most recent" is the TAIL, not the head.
  const hidden = max && !all ? Math.max(0, decisions.length - max) : 0;
  const shown = hidden > 0 ? decisions.slice(-max!) : decisions;

  return (
    <div className="w-trace">
      {hidden > 0 && (
        <button type="button" className="w-trace__more" onClick={() => setAll(true)}>
          {hidden} earlier decision{hidden === 1 ? "" : "s"} not shown — show everything
        </button>
      )}
      {shown.map((d) => (
        <div
          className={`w-trace__row${highlight?.has(d.id) ? " w-trace__row--lit" : ""}`}
          key={d.id}
        >
          <AgentStamp agent={d.agent as AgentName} />
          <div>
            <div className="w-trace__head">
              <span className="w-trace__agent">{d.agent}</span>
              <span className="w-trace__verdict">{d.verdict}</span>
              <span className="w-trace__meta">
                {d.model ?? "no model — deterministic"}
                {d.cost_usd ? ` · $${d.cost_usd.toFixed(5)}` : ""}
              </span>
            </div>
            <p className="w-trace__why">{d.rationale}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
