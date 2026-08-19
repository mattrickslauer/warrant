// Inspection stamps, not mascots. In QA and aviation an inspector carries a personal stamp
// that goes onto the record; every row of a sealed record shows the mark of the agent that
// stamped it. One line weight, monochrome, hand-authored — not generated.
import type { ReactElement, SVGProps } from "react";

export type AgentName =
  | "scoper" | "foreman" | "inspector" | "skeptic" | "auditor" | "instructor" | "wright";

const MARKS: Record<AgentName, ReactElement> = {
  // an interview bracket — the question that keeps being asked
  scoper: <path d="M15 6c-3 0-3 4-3 6s0-6-3-6M15 18c-3 0-3-4-3-6s0 6-3 6" />,
  // a branch — one job delegating
  foreman: <path d="M12 18V13m0 0 4-5m-4 5-4-5" />,
  // a lens
  inspector: <><circle cx="11" cy="11" r="3.4" /><path d="m13.6 13.6 3 3" /></>,
  // a struck lens — the same instrument, doubting
  skeptic: <><circle cx="11" cy="11" r="3.4" /><path d="m13.6 13.6 3 3M7.5 15.5 16 7" /></>,
  // a tally — counting across weeks
  auditor: <path d="M9 8v8M11.5 8v8M14 8v8M7.5 15l8-6" />,
  // a speech mark — spoken, then acted on
  instructor: <path d="M9.5 14c-1.4 0-2.2-1-2.2-2.2S8.1 9.5 9.4 9.5c1.6 0 2.4 1.2 2.1 2.8-.3 1.5-1.3 2.4-2.6 2.9M16 14c-1.4 0-2.2-1-2.2-2.2s.8-2.3 2.1-2.3c1.6 0 2.4 1.2 2.1 2.8-.3 1.5-1.3 2.4-2.6 2.9" />,
  // a pin — a driver fixed to an unfamiliar device
  wright: <path d="M12 18V12m0 0 2.5-2.5a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0L9 9m3 3L9.5 9.5" />,
};

export interface AgentStampProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  agent: AgentName;
  size?: number;
}

export function AgentStamp({ agent, size = 26, ...rest }: AgentStampProps) {
  return (
    <svg
      className="w-stamp" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={1.25}
      strokeLinecap="round" strokeLinejoin="round"
      role="img" aria-label={`${agent} stamp`} {...rest}
    >
      <circle cx="12" cy="12" r="11" opacity={0.45} />
      {MARKS[agent]}
    </svg>
  );
}
