"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  StepCard, CaptureTile, ReasonCapture, SignatureInput, AgentTrace, HoldBanner,
  StatusPill, Rule, Wrap, EvidenceChip, type JobStatus,
} from "@/components";
import { getDataSource, scoped, surfaceCanRun, type JobEvent } from "@/data";
import type { Decision, FieldDef, Job, Procedure } from "@/generated/types";

type Exit = "capture" | "reason";

export function JobFlow({ jobId }: { jobId: string }) {
  const router = useRouter();
  const src = useMemo(() => getDataSource(), []);
  const [job, setJob] = useState<Job | null>(null);
  const [finalising, setFinalising] = useState(false);
  const [proc, setProc] = useState<Procedure | null>(null);
  const [cursor, setCursor] = useState(0);
  const [exit, setExit] = useState<Exit>("capture");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [added, setAdded] = useState<Record<string, FieldDef[]>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [furthest, setFurthest] = useState(0);
  const advanced = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      const j = await src.getJob(jobId);
      if (!alive) return;
      if (!j) { setMissing(true); return; }
      setJob(j);
      // A job stores its procedure id BARE, and a procedure is addressed
      // `{tenant}/{procedure}`. Handing the bare id straight over resolved to null against
      // Firestore and left the screen on "Opening…" forever, with the job loaded and
      // nothing to render it against.
      setProc(await src.getProcedure(scoped(j.tenant_id, j.procedure_id)));
    })();
    return () => { alive = false; };
  }, [src, jobId]);

  // Everything below arrives AFTER the person moved on. This is the whole point.
  useEffect(() => { setFurthest((f) => Math.max(f, cursor)); }, [cursor]);

  useEffect(() => {
    if (!job) return;
    return src.subscribe(job.id, (e: JobEvent) => {
      if (e.kind === "decision") setDecisions((d) => [...d, e.decision]);
      if (e.kind === "add_field")
        setAdded((a) => ({ ...a, [e.stepId]: [...(a[e.stepId] ?? []), e.field] }));
      if (e.kind === "step_status") setStatuses((s) => ({ ...s, [e.stepId]: e.status }));
      if (e.kind === "held") setHeld(e.reason);
      if (e.kind === "sealed") router.push(`/r/${encodeURIComponent(e.recordId)}`);
    });
  }, [src, job, router]);

  // Fixtures live in memory, so a hard reload has nothing to open. Say that plainly rather
  // than spinning — an honest empty state is an invitation to act, not a mood.
  if (missing) {
    return (
      <Wrap>
        <div className="stack stack--lg">
          <HoldBanner kind="fixture" title="This job is not in memory">
            Jobs live in the fixture layer until Firestore is connected, so reloading loses them.
            Nothing was persisted, and nothing is pretending otherwise.
          </HoldBanner>
          <a className="w-btn" href="/">Start a task</a>
        </div>
      </Wrap>
    );
  }
  if (!job || !proc) return <Wrap><p className="lede">Opening…</p></Wrap>;

  // A procedure demanding a class this surface cannot reach is refused BEFORE it starts.
  // Never downgraded, never substituted. This screen is the argument, not an error.
  if (!surfaceCanRun(proc, job.tier as "open" | "attested" | "instrumented")) {
    return (
      <Wrap>
        <div className="stack stack--lg">
          <HoldBanner title="This surface cannot run this procedure">
            {proc.title} requires a measured value from a paired instrument. A browser has no
            pairing and no device attestation, and its sensors are supplied by the person being
            checked — so it cannot produce one. Nothing here will be downgraded to let it through.
          </HoldBanner>
          <div className="stack">
            <p className="w-step__num">What it needs</p>
            <div className="w-ceiling__rows">
              <div className="w-ceiling__row">
                <EvidenceChip cls="measured" out />
                <span className="w-ceiling__reason">requires a paired instrument — the app, and a tool</span>
              </div>
            </div>
            <div className="w-step__exits">
              <a className="w-btn" href="/about">See what the app adds</a>
              <a className="w-btn w-btn--ghost" href="/">Pick something a browser can prove</a>
            </div>
          </div>
        </div>
      </Wrap>
    );
  }

  const step = proc.steps[cursor];
  const extra = added[step.id] ?? [];
  const fields: FieldDef[] = [...step.fields, ...extra];
  const done = statuses[step.id] === "performed";

  // Capture never waits, so you WILL walk away from a step before its verdict lands — and
  // sometimes the verdict grows a field that was not there when you passed through. Those
  // steps stay open and the job cannot seal until they are resolved. This is the mechanism
  // the README already promises: fixable from wherever you are, including three steps later.
  // Only steps you have already walked past, or that grew a field while you were away.
  // Listing steps you simply have not reached yet would be noise dressed as an alert.
  const outstanding = proc.steps
    .map((s, i) => ({ step: s, i, status: statuses[s.id] ?? "pending" }))
    .filter((x) =>
      x.status === "pending" &&
      x.i !== cursor &&
      (x.i < furthest || (added[x.step.id]?.length ?? 0) > 0)
    );

  // Field.kind is the discriminator, so the UI dispatches on it. A signature is not a
  // photograph and must never be collected as one.
  function controlFor(f: FieldDef) {
    if (f.kind === "signature" || f.kind === "text") {
      return (
        <SignatureInput
          prompt={f.prompt}
          signed={signatures[f.key] ?? null}
          onSign={(name) => {
            setSignatures((s) => ({ ...s, [f.key]: name }));
            onCapture(f.key, `signature:${name}`, "upload");
          }}
        />
      );
    }
    return (
      <CaptureTile
        hint={f.prompt}
        provenance={f.source === "instrument" ? "measured" : f.source === "human" ? "asserted" : "inferred"}
        onCapture={(_blob, url) => onCapture(f.key, url)}
      />
    );
  }

  async function onCapture(fieldKey: string, mediaRef: string, mode: "live" | "upload" = "live") {
    // Resolves immediately. Nobody stands in a workshop watching a spinner.
    await src.capture({
      jobId: job!.id, stepId: step.id, fieldKey,
      kind: "photo", mediaRef, surface: "browser", mode,
    });
    const key = `${step.id}:${fieldKey}`;
    if (!advanced.current.has(key)) {
      advanced.current.add(key);
      const from = cursor;
      setTimeout(() => {
        // Do not walk past a step that has grown a field in the meantime — the ask is right
        // here, and jumping away from it is how a person loses it.
        setAdded((a) => {
          const grew = (a[proc!.steps[from].id]?.length ?? 0) > 0;
          if (!grew) setCursor((c) => (c === from ? Math.min(c + 1, proc!.steps.length - 1) : c));
          return a;
        });
      }, 900);
    }
  }

  async function onReason(r: { kind: "voice" | "text"; transcript: string }) {
    setBusy(true);
    await src.declareBlocked({
      jobId: job!.id, stepId: step.id,
      reasonKind: r.kind, transcript: r.transcript, by: "you",
    });
    setBusy(false);
    setExit("capture");
    setTimeout(() => setCursor((c) => Math.min(c + 1, proc!.steps.length - 1)), 900);
  }

  return (
    <Wrap>
      <div className="stack stack--lg">
        {held && (
          <HoldBanner title="Machine held">
            {held}. It will not be released until the record holds up.
          </HoldBanner>
        )}

        <StepCard
          step={step}
          total={proc.steps.length}
          guidance={fields[0]?.guidance}
          exits={
            exit === "capture" ? (
              <>
                <button className="w-btn w-btn--ghost w-btn--block" onClick={() => setExit("reason")}>
                  I can&rsquo;t do this
                </button>
                {done && cursor < proc.steps.length - 1 && (
                  <button className="w-btn w-btn--block" onClick={() => setCursor(cursor + 1)}>
                    Next step
                  </button>
                )}
              </>
            ) : (
              <button className="w-btn w-btn--ghost w-btn--block" onClick={() => setExit("capture")}>
                Back to capturing
              </button>
            )
          }
        >
          {exit === "capture" ? (
            <div className="stack">
              {fields.map((f) => (
                <div className="stack" key={f.key}>
                  {extra.includes(f) && (
                    <p className="w-step__num" style={{ color: "var(--inferred-lift)" }}>
                      Added just now — the Inspector asked for this
                    </p>
                  )}
                  {controlFor(f)}
                </div>
              ))}
            </div>
          ) : (
            <ReasonCapture onSubmit={onReason} busy={busy} />
          )}
        </StepCard>

        {outstanding.length > 0 && (
          <div className="stack">
            <HoldBanner kind="waiting" title={`${outstanding.length} step${outstanding.length > 1 ? "s" : ""} still waiting`}>
              This job cannot seal until every step passes. Nothing here is lost — go back and
              finish it whenever you like.
            </HoldBanner>
            <div className="stack">
              {outstanding.map((o) => (
                <button
                  key={o.step.id}
                  className="w-btn w-btn--ghost w-btn--block"
                  onClick={() => { setCursor(o.i); setExit("capture"); }}
                >
                  Step {o.step.index} — {o.step.title}
                  {(added[o.step.id]?.length ?? 0) > 0 ? " · needs another capture" : ""}
                </button>
              ))}
            </div>
          </div>
        )}

        <Rule />

        {job.status === "draft" && (
          <div className="stack">
            <div className="w-trace__head">
              <span className="w-trace__agent">Not started</span>
              <StatusPill status="draft" />
            </div>
            <p className="w-trace__why">
              Captured and saved. No agent has looked at it, nothing is sealed, and the machine
              is not released — a workshop with no signal works exactly the same. Finalising is
              what hands it to the fleet.
            </p>
            <button
              className="w-btn"
              disabled={finalising}
              onClick={async () => {
                setFinalising(true);
                try {
                  await src.finalize(job.id, job.technician_id ?? "unknown");
                  setJob(await src.getJob(jobId));
                } finally {
                  setFinalising(false);
                }
              }}
            >
              {finalising ? "Finalising…" : "Finalise — hand this to the fleet"}
            </button>
          </div>
        )}

        <div className="stack">
          <div className="w-trace__head">
            <span className="w-trace__agent">Verification</span>
            <StatusPill status={job.status as JobStatus} />
          </div>
          <p className="w-trace__why">
            Capture never waits. These land behind you, and you can keep going.
          </p>
          <AgentTrace decisions={decisions} />
        </div>
      </div>
    </Wrap>
  );
}
