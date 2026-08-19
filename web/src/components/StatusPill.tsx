export type JobStatus = "open" | "waiting" | "held" | "sealed";

const LABEL: Record<JobStatus, string> = {
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
