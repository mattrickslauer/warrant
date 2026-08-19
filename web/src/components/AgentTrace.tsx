import type { Decision } from "@/generated/types";
import { AgentStamp, type AgentName } from "./AgentStamp";

/**
 * Which agent decided what, and on what basis. Every row carries the stamp of the agent
 * that made it and the version of that agent, because a record you cannot attribute is a
 * tick in a box with extra steps.
 */
export function AgentTrace({ decisions }: { decisions: Decision[] }) {
  if (decisions.length === 0) {
    return <p className="w-trace__why">No decisions yet. Verification runs behind the capture.</p>;
  }
  return (
    <div className="w-trace">
      {decisions.map((d) => (
        <div className="w-trace__row" key={d.id}>
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
