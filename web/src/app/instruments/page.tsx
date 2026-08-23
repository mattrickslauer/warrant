import { AppShell } from "../shell/AppShell";
import { Pair } from "./Pair";

// Pairing is a device conversation, so the whole screen is a client component. The shell around
// it is the same one every other surface gets — the point of building it was that no screen has
// to invent a bar and a menu of its own again.

export default function InstrumentsPage() {
  return <AppShell tone="work"><Pair /></AppShell>;
}
