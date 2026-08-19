export type ProvenanceClass = "measured" | "specified" | "inferred" | "asserted";

const LABEL: Record<ProvenanceClass, string> = {
  measured: "measured",
  specified: "specified",
  inferred: "inferred",
  asserted: "asserted",
};

/**
 * The label is always rendered. Colour never carries the meaning on its own — the classes
 * are the product, and a reader who cannot distinguish teal from amber still gets them.
 */
export function EvidenceChip({
  cls, out = false,
}: { cls: ProvenanceClass; out?: boolean }) {
  return (
    <span className={`w-chip w-chip--${cls}${out ? " w-chip--out" : ""}`}>
      {LABEL[cls]}
    </span>
  );
}
