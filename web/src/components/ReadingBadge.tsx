/**
 * The thesis rendered. A number that arrived from a paired instrument, carrying the tool
 * that produced it and the moment it did. Nothing else on any screen gets this treatment,
 * because nothing else earned it.
 */
export function ReadingBadge({
  value, unit, at, toolId,
}: { value: number; unit: string; at: string; toolId: string }) {
  const time = at.length > 11 ? at.slice(11, 19) : at;
  return (
    <span className="w-reading">
      <b>{value}{unit ? ` ${unit}` : ""}</b>
      <span>{time}</span>
      <span>tool #{toolId}</span>
    </span>
  );
}
