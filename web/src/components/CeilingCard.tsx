import type { SealedRecord } from "@/generated/types";
import { EvidenceChip, type ProvenanceClass } from "./EvidenceChip";

const TIER_LABEL: Record<string, string> = {
  open: "Open — any browser",
  attested: "Attested — the Warrant app",
  instrumented: "Instrumented — the app and a paired instrument",
};

const NEXT_TIER: Record<string, string | null> = {
  open: "Install the app to attest your captures to a device.",
  attested: "Pair an instrument to record a measured value.",
  instrumented: null,
};

/**
 * The signature. What this record could prove, what it could not, and why — stated on the
 * record itself rather than implied by its absence.
 *
 * The struck-through row is the call to action, and it is honest: not "upgrade for more
 * features", but this is the strongest evidence your surface can make, and here is what the
 * next one can.
 */
export function CeilingCard({
  ceiling, cta,
}: {
  ceiling: Pick<SealedRecord, "ceiling_tier" | "ceiling_reachable" | "ceiling_unreachable">;
  cta?: React.ReactNode;
}) {
  const next = NEXT_TIER[ceiling.ceiling_tier];
  return (
    <div className="w-ceiling">
      <div>
        <p className="w-ceiling__head">Verification ceiling</p>
        <p className="w-ceiling__tier">{TIER_LABEL[ceiling.ceiling_tier] ?? ceiling.ceiling_tier}</p>
      </div>

      <div className="w-ceiling__rows">
        {ceiling.ceiling_reachable.map((c) => (
          <div className="w-ceiling__row" key={c}>
            <EvidenceChip cls={c as ProvenanceClass} />
            <span className="w-ceiling__reason">on this record</span>
          </div>
        ))}
        {ceiling.ceiling_unreachable.map((u) => (
          <div className="w-ceiling__row" key={u.class}>
            <EvidenceChip cls={u.class as ProvenanceClass} out />
            <span className="w-ceiling__reason">{u.reason}</span>
          </div>
        ))}
      </div>

      {(next || cta) && (
        <div className="w-ceiling__cta">
          {next && <span className="w-ceiling__reason">{next}</span>}
          {cta}
        </div>
      )}
    </div>
  );
}
