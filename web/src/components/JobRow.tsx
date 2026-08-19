"use client";
import { StatusPill, type JobStatus } from "./StatusPill";

export function JobRow({
  title, asset, status, when, procedure, onOpen,
}: {
  title: string;
  asset?: string | null;
  status: JobStatus;
  when: string;
  procedure: string;
  onOpen?: () => void;
}) {
  return (
    <div className="w-jobrow" role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen?.(); }}>
      <span className="w-jobrow__title">{title}</span>
      <StatusPill status={status} />
      <span className="w-jobrow__meta">
        <span>{procedure}</span>
        {asset && <span>{asset}</span>}
        <span>{when}</span>
      </span>
    </div>
  );
}
