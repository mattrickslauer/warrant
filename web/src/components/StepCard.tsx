import type { ReactNode } from "react";
import type { Step } from "@/generated/types";

/**
 * One card. Three things shown, two exits offered, no third way out.
 *
 * The guidance block is the acceptance rule in plain language — the SAME rule the Inspector
 * applies after the capture, shown to the person before it. Every round-trip it prevents is
 * a model call the Ledger does not spend.
 */
export function StepCard({
  step, total, guidance, children, exits,
}: {
  step: Pick<Step, "index" | "title" | "explanation">;
  total: number;
  guidance?: string | null;
  children?: ReactNode;
  exits?: ReactNode;
}) {
  return (
    <section className="w-step">
      <p className="w-step__num">Step {step.index} of {total}</p>
      <h2 className="w-step__title">{step.title}</h2>
      <p className="w-step__why">{step.explanation}</p>
      {guidance && (
        <p className="w-step__guide">
          <b>What good looks like</b>
          {guidance}
        </p>
      )}
      {children}
      {exits && <div className="w-step__exits">{exits}</div>}
    </section>
  );
}
