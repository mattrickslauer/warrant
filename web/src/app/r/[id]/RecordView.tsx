"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Ground, Wrap, Rule, CeilingCard, AgentTrace, EvidenceChip, HoldBanner, Timeline,
} from "@/components";
import { getDataSource } from "@/data";
import type { Procedure, SealedRecord } from "@/generated/types";

export function RecordView({ id }: { id: string }) {
  const src = useMemo(() => getDataSource(), []);
  const [rec, setRec] = useState<SealedRecord | null>(null);
  const [proc, setProc] = useState<Procedure | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await src.getRecord(id);
      if (!alive) return;
      setRec(r);
      // A record names steps by id; a person reading it needs the title the technician saw.
      if (r) {
        const job = await src.getJob(r.job_id);
        if (job && alive) setProc(await src.getProcedure(job.procedure_id));
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [src, id]);

  const titleOf = (stepId: string) =>
    proc?.steps.find((s) => s.id === stepId)?.title ?? stepId;
  const indexOf = (stepId: string) =>
    proc?.steps.find((s) => s.id === stepId)?.index;

  if (loading) return <Wrap><p className="lede">Opening the record…</p></Wrap>;

  if (!rec) {
    return (
      <Wrap>
        <div className="stack stack--lg">
          <HoldBanner kind="fixture" title="This record is not in memory">
            Records live in the fixture layer for now, so a reload loses them. Nothing is
            persisted until Firestore is connected — and this banner exists because a demo
            must never present fabricated data as though it were real.
          </HoldBanner>
          <a className="w-btn" href="/">Start a task</a>
        </div>
      </Wrap>
    );
  }

  return (
    <Wrap>
      <div className="stack stack--lg">
        <div className="stack">
          <p className="eyebrow">Sealed record</p>
          <h1 className="hero">{rec.machine_released ? "Sealed" : "Sealed, and held"}</h1>
          <p className="w-timeline__when">{rec.id} · sealed {rec.sealed_at.slice(0, 19).replace("T", " ")} UTC</p>
        </div>

        {!rec.machine_released && (
          <HoldBanner title="Not released">
            A step was explained rather than performed, so this record is deficient and the
            machine stays held. That sentence is the point — a paper checklist cannot produce it.
          </HoldBanner>
        )}

        <CeilingCard
          ceiling={rec}
          cta={<a className="w-btn" href="/about">What the app adds</a>}
        />

        {rec.deficiencies.length > 0 && (
          <div className="stack">
            <p className="eyebrow">What was not done, and why</p>
            {rec.deficiencies.map((d) => (
              <div className="stack" key={d.step_id}>
                <div className="w-ceiling__row">
                  <EvidenceChip cls="asserted" />
                  <span className="w-ceiling__reason">{d.status}</span>
                </div>
                {/* Their words, in a sans face, because a person said this. */}
                <p className="w-timeline__when">Step {indexOf(d.step_id) ?? "?"} — {titleOf(d.step_id)}</p>
                <p className="w-step__why">&ldquo;{d.reason}&rdquo;</p>
              </div>
            ))}
          </div>
        )}

        <Rule />

        <div className="stack">
          <p className="eyebrow">Steps</p>
          <Timeline
            entries={rec.steps.map((s) => ({
              id: s.id,
              when: `Step ${indexOf(s.step_id) ?? "?"} — ${titleOf(s.step_id)}`,
              what:
                s.status === "performed"
                  ? "Performed, evidence captured"
                  : `${s.status} — ${s.reason_transcript ?? "no reason recorded"}`,
              done: s.status === "performed",
            }))}
          />
        </div>

        <Rule />

        <div className="stack">
          <p className="eyebrow">Who decided what</p>
          <AgentTrace decisions={rec.decisions} />
        </div>
      </div>
    </Wrap>
  );
}
