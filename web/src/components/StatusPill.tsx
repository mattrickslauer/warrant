export type JobStatus = "draft" | "open" | "waiting" | "held" | "sealed";

const LABEL: Record<JobStatus, string> = {
  // A draft is performed against the local cache and is invisible to every agent. It is not
  // "unsaved" — it is saved and not yet started, which is a different and honest thing.
  draft: "draft — no agent has seen this",
  open: "open",
  waiting: "waiting on evidence",
  held: "held",
  sealed: "sealed",
};

export function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span className={`w-pill w-pill--${status}`}>
      <i aria-hidden />
      {LABEL[status]}
    </span>
  );
}
