import type { ReactNode } from "react";

/**
 * Two uses, one shape.
 *
 * `held` — the machine is not released. This is the only thing here that protects a person
 * who does not know this system exists, so it is not a toast and it cannot be dismissed.
 *
 * `waiting` — a step is still outstanding. Not a failure, and not dismissable noise.
 *
 * `fixture` — the surface is serving fabricated data because a live service is unavailable.
 * A demo must never show an error screen; it must also never present fabricated data as
 * real, which is the exact failure this product exists to prevent. So it says so.
 */
export function HoldBanner({
  kind = "held", title, children,
}: { kind?: "held" | "waiting" | "fixture"; title: string; children?: ReactNode }) {
  return (
    <div className={`w-hold${kind !== "held" ? ` w-hold--${kind}` : ""}`} role="status">
      <p className="w-hold__head">{title}</p>
      {children && <p className="w-hold__why">{children}</p>}
    </div>
  );
}
