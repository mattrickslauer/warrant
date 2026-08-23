import { AppShell } from "../../shell/AppShell";
import { YourProcedures } from "./YourProcedures";

/**
 * The procedures this tenant has authored.
 *
 * Gated, and for the same reason `/author` is: a procedure governs every job ever run against
 * it, so it belongs to a tenant, and there is no tenant without an identity. The page itself
 * degrades honestly rather than blocking — a visitor sees the empty state and the invitation,
 * because a screen that refuses to render is worse at explaining itself than one that renders
 * and says what is missing.
 */
export default function YourProceduresPage() {
  return <AppShell tone="work"><YourProcedures /></AppShell>;
}
