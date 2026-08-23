import { AppShell } from "../shell/AppShell";
import { SignInGate } from "@/auth/SignInGate";
import { Account } from "./Account";

/**
 * Who you are signed in as, and — the part that actually matters — what tenant that puts you in.
 *
 * This is where the tenant explanation lives. It used to be duplicated on the authoring screen,
 * which meant two copies of the one rule that decides who can see what.
 */
export default function AccountPage() {
  return (
    <AppShell tone="work">
      <SignInGate purpose="account"><Account /></SignInGate>
    </AppShell>
  );
}
