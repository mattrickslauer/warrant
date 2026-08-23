"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EvidenceChip } from "@/components";
import { getDataSource } from "@/data";
import { useSession } from "@/auth/session-context";
import { currentTenantId } from "@/auth/current-tenant";

/** A tenant of one, created in the browser. No account, no wall — the only gate is optional. */
function warrantUid(): string {
  if (typeof window === "undefined") return "anon";
  const k = "warrant_uid";
  let v = window.localStorage.getItem(k);
  if (!v) {
    v = crypto.randomUUID();
    window.localStorage.setItem(k, v);
  }
  return v;
}

export interface TaskOption {
  procedureId: string;
  name: string;
  note: string;
  classes: Array<"measured" | "specified" | "inferred" | "asserted">;
  unreachable?: Array<"measured" | "specified">;
  available: boolean;
}

export function TaskLauncher({ tasks }: { tasks: TaskOption[] }) {
  const router = useRouter();
  const { session } = useSession();
  const [busy, setBusy] = useState<string | null>(null);

  async function start(t: TaskOption) {
    if (!t.available) return;
    setBusy(t.procedureId);
    const src = getDataSource();
    // The account row is created on the first meaningful write, never on page load.
    const job = await src.startJob({
      procedureId: t.procedureId,
      tenantId: currentTenantId(session),
      tier: "open",
    });
    void warrantUid();
    router.push(`/job/${job.id}`);
  }

  return (
    <div className="tasks">
      {tasks.map((t) => (
        <button
          key={t.procedureId}
          className="task"
          disabled={!t.available || busy !== null}
          onClick={() => start(t)}
        >
          <span className="task__name">{t.name}</span>
          <span className="task__note">
            {busy === t.procedureId ? "opening…" : t.note}
          </span>
          <span className="task__classes">
            {t.classes.map((c) => <EvidenceChip key={c} cls={c} />)}
            {t.unreachable?.map((c) => <EvidenceChip key={c} cls={c} out />)}
          </span>
        </button>
      ))}
    </div>
  );
}
