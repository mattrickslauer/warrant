import { JobFlow } from "./JobFlow";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  // A scoped id is `tenant/doc`, and it travels as ONE path segment with the slash
  // percent-encoded — Next leaves `%2F` alone inside a dynamic segment rather than splitting
  // the route on it. Undo that here, because `splitScoped()` looks for a literal slash and
  // returns "no such job" for an id that still carries `%2F`.
  const { id } = await params;
  // No shell around it. The step page is one screen that does not scroll and owns the whole
  // viewport — the ✕ in its own top-left is the way out, exactly as on the phone. JobFlow
  // puts the shell back for the states that are documents rather than steps: a job that is
  // not in memory, a procedure this surface refuses, and the handover.
  return <JobFlow jobId={decodeURIComponent(id)} />;
}
