import { AppShell } from "../../shell/AppShell";
import { JobFlow } from "./JobFlow";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  // A scoped id is `tenant/doc`, and it travels as ONE path segment with the slash
  // percent-encoded — Next leaves `%2F` alone inside a dynamic segment rather than splitting
  // the route on it. Undo that here, because `splitScoped()` looks for a literal slash and
  // returns "no such job" for an id that still carries `%2F`.
  const { id } = await params;
  return <AppShell tone="work"><JobFlow jobId={decodeURIComponent(id)} /></AppShell>;
}
