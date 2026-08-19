import type { ReactNode } from "react";

/** The two worlds: the workshop where work happens, the paper record that survives it. */
export function Ground({
  tone = "work", children, className = "",
}: { tone?: "work" | "paper"; children: ReactNode; className?: string }) {
  return <div className={`w-ground w-ground--${tone} ${className}`}>{children}</div>;
}

export function Wrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`w-wrap ${className}`}>{children}</div>;
}
