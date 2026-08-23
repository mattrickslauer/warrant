import { AppShell } from "../shell/AppShell";
import { SignInGate } from "@/auth/SignInGate";
import { Interview } from "./Interview";

// Where a shop that has never used Warrant gets a procedure.
//
// Paper ground rather than work ground on purpose: this is the desk, not the workshop. The job
// surface is the one that has to survive gloves and daylight; this one has to survive somebody
// thinking.
//
// Gated, and it is the only authoring surface that is. A procedure governs every job that is
// ever run against it, so it has to belong to a tenant — and there is no tenant without an
// identity. Running a procedure, by contrast, needs no account at all, which is the asymmetry
// the gate exists to state out loud rather than imply.

export default function AuthorPage() {
  return (
    <AppShell tone="paper">
      <SignInGate purpose="author"><Interview /></SignInGate>
    </AppShell>
  );
}
