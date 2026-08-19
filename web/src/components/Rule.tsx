export function Rule({ strong = false }: { strong?: boolean }) {
  return <hr className={`w-rule${strong ? " w-rule--strong" : ""}`} />;
}
