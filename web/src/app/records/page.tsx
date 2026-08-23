import { AppShell } from "../shell/AppShell";
import { Records } from "./Records";

/**
 * Every job this browser has run, and the record each sealed one left behind.
 *
 * NOT gated. A stranger who ran a public procedure made a real record, and being unable to look
 * at their own evidence would contradict the whole claim the product makes — which is why this
 * page sits in the Work section of the menu next to Procedures, and not under the account rows.
 */
export default function RecordsPage() {
  return <AppShell tone="work"><Records /></AppShell>;
}
