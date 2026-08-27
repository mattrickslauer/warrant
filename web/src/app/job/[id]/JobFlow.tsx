"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AgentTrace, Attribution, EvidenceChip, HoldBanner, StatusPill,
  StepPage, type Notice, type FieldPip,
  CameraLayer, LampControl, LensControl, LiveMark, useCameraHandle, flip, type Lens,
  StepBriefSheet, BlockedSheet, TraceSheet,
  type JobStatus, type ProvenanceClass,
} from "@/components";
import { AppShell } from "../../shell/AppShell";
import { useSession } from "@/auth/session-context";
import {
  getDataSource, scoped, surfaceCanRun, openItems, firstOwed,
  type JobEvent, type OpenItem,
} from "@/data";
import {
  activeFieldFor, framedFieldFor, primaryActionFor, requiredAt, unanswerable,
  usesCamera, usesKeyboard, working,
} from "@/data/step-action";
import { handoverHeadline, handoverStateFor } from "@/data/handover";
import type { Decision, Field, FieldDef, Job, Procedure, StepOutcome } from "@/generated/types";

/**
 * Doing a procedure, in a browser, on the layout the phone has had since its first commit.
 *
 * This screen used to be a scrolling stack of cards — a step card with a 4:3 camera tile inside
 * it, then a waiting panel, then an every-step list, then the trace — which meant the shutter's
 * position depended on how long the step's explanation was, and there was no single control
 * that said what the step was actually asking for. The phone answered the same questions with
 * one non-scrolling page, one bar whose label is computed, and everything else one tap away in
 * a sheet. This is that page, ported: `StepPage` is the layout, `step-action.ts` is the rule
 * the bar reads, and both have Kotlin twins that must keep agreeing.
 *
 * What did NOT change is everything below the seam: the data source, the subscribe, the
 * append-only capture, the rule that a signature is satisfied from the session and never asked
 * for, and `attention.ts` deciding what an agent is waiting on. Those were already right.
 */

export function JobFlow({ jobId }: { jobId: string }) {
  const router = useRouter();
  const src = useMemo(() => getDataSource(), []);
  // Who the record attributes assertions to. Never typed — see the effect below.
  const { session } = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [proc, setProc] = useState<Procedure | null>(null);
  const [cursor, setCursor] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [added, setAdded] = useState<Record<string, FieldDef[]>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  /** A question an agent put to a person, per step. The step stays pending and carries it. */
  const [escalations, setEscalations] = useState<Record<string, string>>({});
  /** Why a step did not advance, per step. An agent answered and could not be acted on. */
  const [holds, setHolds] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  /**
   * What each field has been answered with, keyed `{stepId}:{fieldKey}`.
   *
   * The step id is not decoration. This was keyed by field key alone, and a procedure whose
   * step one and step four both ask `condition` showed step four already answered with step
   * one's words — and, worse, gave a redo nothing to clear, because there was no way to say
   * which step's answer was being thrown away.
   */
  const [answers, setAnswers] = useState<Record<string, string>>({});
  /** Steps where exit two has been taken. The one thing that retires an unanswerable field. */
  const [reasoned, setReasoned] = useState<Record<string, boolean>>({});
  const [furthest, setFurthest] = useState(0);
  const attributed = useRef<Set<string>>(new Set());

  // ------------------------------------------------------------------ the screen's own state

  /**
   * Frames taken in this tab, keyed by step and field.
   *
   * Held here rather than in the record because they are a property of the REVIEW — the
   * picture you are looking at before you decide about it — not of the job, which already has
   * the capture. Retake drops one; nothing is retracted from the record by doing so.
   */
  const [frames, setFrames] = useState<Record<string, string>>({});
  /** The technician's override of which field the page is pointed at. Cleared per step. */
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  /** Which lens each step is using, and whether its lamp is lit. The technician's choice. */
  const [lenses, setLenses] = useState<Record<string, Lens>>({});
  const [lamps, setLamps] = useState<Record<string, boolean>>({});
  const [brief, setBrief] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [trace, setTrace] = useState(false);
  const [busy, setBusy] = useState(false);
  /** What this browser is doing between a tap and the work landing. Null when idle. */
  const [work, setWork] = useState<string | null>(null);
  /** Finish has been tapped. The end of a job is its own screen, not a step. */
  const [handedOver, setHandedOver] = useState(false);
  const [sealedRecordId, setSealedRecordId] = useState<string | null>(null);
  /** Dismissed notices, so "Later" means something for the rest of this sitting. */
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const camera = useCameraHandle();

  useEffect(() => {
    let alive = true;
    (async () => {
      const j = await src.getJob(jobId);
      if (!alive) return;
      if (!j) { setMissing(true); return; }
      setJob(j);
      // A job stores its procedure id BARE, and a procedure is addressed
      // `{tenant}/{procedure}`. Handing the bare id straight over resolved to null against
      // Firestore and left the screen on "Opening…" forever.
      const p = await src.getProcedure(scoped(j.tenant_id, j.procedure_id));
      if (!alive) return;
      setProc(p);

      // EVERYTHING THE JOB ALREADY KNOWS, BEFORE THE FIRST EVENT ARRIVES.
      //
      // A job reopened in a new tab — or simply reloaded — used to present four finished steps
      // as untouched work. The phone has rebuilt itself from the job like this since
      // `JobViewModel.resume` was written; this is the browser doing the same.
      setStatuses(Object.fromEntries((j.steps ?? []).map((o) => [o.step_id, o.status])));
      setAdded(Object.fromEntries(
        (j.steps ?? [])
          .filter((o) => (o.added_fields?.length ?? 0) > 0)
          .map((o) => [o.step_id, o.added_fields ?? []]),
      ));
      setEscalations(Object.fromEntries(
        (j.steps ?? [])
          .filter((o) => o.escalation_question?.trim())
          .map((o) => [o.step_id, o.escalation_question as string]),
      ));
      setHolds(Object.fromEntries(
        (j.steps ?? [])
          .filter((o) => o.hold_reason?.trim())
          .map((o) => [o.step_id, o.hold_reason as string]),
      ));
      // A step somebody already explained must not be asked again on the next visit — that is
      // the whole point of `reasoned`, and reading it off the outcome is what makes it survive
      // a reload rather than living only for as long as the tab is open.
      setReasoned(Object.fromEntries(
        (j.steps ?? [])
          .filter((o) => o.reason_transcript?.trim())
          .map((o) => [o.step_id, true]),
      ));
      setAnswers(Object.fromEntries(
        (j.steps ?? []).flatMap((o) =>
          (o.fields ?? []).map((f) => [
            `${o.step_id}:${f.key}`,
            f.value_text ?? f.value_choice ?? (f.value_number != null ? String(f.value_number) : "captured"),
          ] as [string, string])),
      ));

      // Land on the first step that still owes something, never on step one. The same rule the
      // phone lands by, imported rather than rewritten — see data/attention.ts.
      if (p) {
        const at = firstOwed(j, p.steps);
        setCursor(at);
        setFurthest(at);
      }
    })();
    return () => { alive = false; };
  }, [src, jobId]);

  // Everything below arrives AFTER the person moved on. This is the whole point.
  useEffect(() => { setFurthest((f) => Math.max(f, cursor)); }, [cursor]);

  // Arriving on a step starts at its first outstanding field, with an empty keyboard.
  useEffect(() => { setSelected(null); setTyped(""); }, [cursor]);

  useEffect(() => {
    if (!job) return;
    return src.subscribe(job.id, (e: JobEvent) => {
      if (e.kind === "decision") setDecisions((d) => [...d, e.decision]);
      if (e.kind === "add_field") {
        // By key, because the seed above already holds whatever the job was carrying when it
        // opened and the listener replays it. Appending blind grew one ask into two.
        setAdded((a) => {
          const here = a[e.stepId] ?? [];
          if (here.some((f) => f.key === e.field.key)) return a;
          return { ...a, [e.stepId]: [...here, e.field] };
        });
      }
      if (e.kind === "escalated") setEscalations((q) => ({ ...q, [e.stepId]: e.question }));
      if (e.kind === "step_status") {
        setStatuses((s) => ({ ...s, [e.stepId]: e.status }));
        // A step that has since passed is not holding anything. Leaving the hold up would nag
        // about a step the fleet has already let through.
        if (e.status === "performed") setHolds(({ [e.stepId]: _gone, ...rest }) => rest);
      }
      if (e.kind === "capture_accepted") {
        setAnswers((a) =>
          a[`${e.stepId}:${e.fieldKey}`] ? a : { ...a, [`${e.stepId}:${e.fieldKey}`]: "captured" });
      }
      if (e.kind === "held") setHeld(e.reason);
      // NOT a redirect any more. Finish is not the same event as the seal, and a browser that
      // jumped to the record the instant one arrived took the decision away from a person who
      // might still have had a step to reopen. The handover page names the seal and offers to
      // open it — see `handoverStateFor`.
      if (e.kind === "sealed") setSealedRecordId(e.recordId);
    });
  }, [src, job, router]);

  // A SIGNATURE IS SATISFIED BY BEING SIGNED IN, AND IS NEVER ASKED FOR.
  //
  // The full argument is in `Attribution`. In short: a box asking a person to put their name to
  // a claim nothing checks is the tick in the box this product exists to replace, it proved
  // nothing when it was a typed name and it proved nothing when it was one tap, and the
  // attribution it collected already existed — the session's uid is on every write, and
  // firestore.rules refuses `reason_by`/`finalized_by` unless they equal `request.auth.uid`.
  useEffect(() => {
    if (!job || !proc) return;
    const s = proc.steps[cursor];
    if (!s) return;
    const here: FieldDef[] = [...s.fields, ...(added[s.id] ?? [])];
    const sigs = here.filter((f) => f.kind === "signature");
    if (sigs.length === 0) return;
    const who = session?.name ?? session?.email ?? session?.uid ?? null;

    void (async () => {
      for (const f of sigs) {
        const key = `${s.id}:${f.key}`;
        if (attributed.current.has(key)) continue;
        attributed.current.add(key);
        setAnswers((prev) => ({ ...prev, [key]: who ?? "unattributed" }));
        await src.capture({
          jobId: job.id, stepId: s.id, fieldKey: f.key,
          // `text` is the one capture kind with no object behind it, and `media_ref` carries
          // the claim itself. Never `photo` — that would have the fleet derive a .jpg path for
          // somebody's name and then fail to read it.
          kind: "text", mediaRef: who ?? "unattributed", blob: null,
          surface: "browser", mode: "upload",
        });
      }
    })();
  }, [src, job, proc, cursor, added, session]);

  // ------------------------------------------------------------------------- the empty states

  // Fixtures live in memory, so a hard reload has nothing to open. Say that plainly rather than
  // spinning — an honest empty state is an invitation to act, not a mood.
  if (missing) {
    return (
      <AppShell tone="work">
        <div className="stack stack--lg">
          <HoldBanner kind="fixture" title="This job is not in memory">
            Jobs live in the fixture layer until Firestore is connected, so reloading loses them.
            Nothing was persisted, and nothing is pretending otherwise.
          </HoldBanner>
          <a className="w-btn" href="/">Start a task</a>
        </div>
      </AppShell>
    );
  }
  if (!job || !proc) {
    return <AppShell tone="work"><p className="lede">Opening…</p></AppShell>;
  }

  // A procedure demanding a class this surface cannot reach is refused BEFORE it starts. Never
  // downgraded, never substituted. This screen is the argument, not an error.
  if (!surfaceCanRun(proc, job.tier as "open" | "attested" | "instrumented")) {
    return (
      <AppShell tone="work">
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
      </AppShell>
    );
  }

  // ---------------------------------------------------------------------- the step in front

  const step = proc.steps[cursor];
  const extra = added[step.id] ?? [];
  const fields: FieldDef[] = [...step.fields, ...extra];
  const strictness = job.strictness;
  const lastStep = cursor === proc.steps.length - 1;

  const isFilled = (stepId: string, key: string) => Boolean(answers[`${stepId}:${key}`]);
  const frameFor = (stepId: string, key: string) => frames[`${stepId}:${key}`] ?? null;

  const stepReasoned = Boolean(reasoned[step.id]);
  const active = activeFieldFor(fields, strictness, selected, stepReasoned, (k) =>
    isFilled(step.id, k));

  // The frame on the backdrop, and which field it belongs to. Two cases, one answer: the
  // picture under review while that field is still the one in front of you, or the step's last
  // frame resting behind "Next step" once nothing is outstanding.
  const framedField = framedFieldFor(fields, active, (k) => Boolean(frameFor(step.id, k)));
  const framedUrl = framedField ? frameFor(step.id, framedField.key) : null;
  // Under review only while the field is still open. A resting frame must not make a finished
  // step look busy.
  const reviewing = active ? framedUrl : null;

  // For a camera field "filled" means there is a frame under review right now — not that the
  // record has one. Retake clears the review and puts the lens back, and the bar has to follow
  // that rather than the record, which can never go back to empty.
  const activeFilled = !active ? false
    : usesCamera(active) ? reviewing !== null
      : isFilled(step.id, active.key);

  const action = working(
    primaryActionFor({
      field: active,
      fieldFilled: activeFilled,
      lastStep,
      // A browser has no pairing and no device attestation, so it can never hold an
      // instrument. Stated as a constant rather than wired to a session that does not exist:
      // the bar then offers "Pair an instrument", which is the honest move — it is the app
      // and a tool that can answer this, and saying so beats a dead control. A procedure that
      // REQUIRES a measurement never reaches here at all; `surfaceCanRun` refused it above.
      instrumentConnected: false,
      instrumentHasReading: false,
      inputReady: typed.trim().length > 0,
    }),
    work,
  );

  const lens: Lens = lenses[step.id] ?? "environment";
  const lamp = Boolean(lamps[step.id]);

  // What this job does not actually need.
  //
  // A procedure may declare a step or a capture optional — `required_at_strictness: 4`, the
  // level strictness cannot reach — and the seal honours it. Judged against the job's own
  // strictness, because a capture required at 3 is mandatory on a regulated job and optional
  // on a standard one.
  const optionalStep = (s: Procedure["steps"][number]) =>
    (s.required_at_strictness ?? 0) > strictness;

  // The job as this screen currently understands it: what the server last said, with every
  // event that has landed since folded on top. Assembled rather than kept as a second copy, so
  // `openItems` can be asked directly — the rule that decides what is waiting on a person is
  // IMPORTED from data/attention.ts and not rewritten here.
  const liveJob: Job = {
    ...job,
    steps: proc.steps.map((st) => {
      const base: StepOutcome = job.steps?.find((x) => x.step_id === st.id) ?? {
        id: st.id, job_id: job.id, step_id: st.id, status: "pending", fields: [],
      };
      const answeredHere = Object.keys(answers)
        .filter((k) => k.startsWith(`${st.id}:`))
        .map((k) => k.slice(st.id.length + 1));
      const here = [...st.fields, ...(added[st.id] ?? [])];
      return {
        ...base,
        status: (statuses[st.id] ?? base.status) as StepOutcome["status"],
        added_fields: added[st.id] ?? [],
        escalation_question: escalations[st.id] ?? null,
        hold_reason: holds[st.id] ?? null,
        fields: answeredHere.map((key) => ({
          id: `${st.id}:${key}`,
          step_id: st.id,
          key,
          kind: here.find((f) => f.key === key)?.kind ?? "text",
        })) as Field[],
      };
    }),
  };

  /** What an agent is asking a person for, right now, anywhere on this job. */
  const waiting: OpenItem[] = openItems(liveJob);

  // Only steps already walked past, or that grew a field while you were away. Listing steps
  // you simply have not reached yet would be noise dressed as an alert.
  const outstanding = proc.steps
    .map((s, i) => ({ step: s, i, status: statuses[s.id] ?? "pending" }))
    .filter((x) =>
      x.status === "pending" &&
      x.i !== cursor &&
      !optionalStep(x.step) &&
      (x.i < furthest || (added[x.step.id]?.length ?? 0) > 0));

  // -------------------------------------------------------------------------------- the moves

  /** Land on a step somebody pointed at, without touching what it has. */
  function goToStep(stepId: string) {
    const i = proc!.steps.findIndex((s) => s.id === stepId);
    if (i < 0) return;
    setCursor(i);
    setSelected(null);
  }

  /** Empty this step's frames from the review, wherever the redo was tapped from. */
  function dropFrames(stepId: string) {
    setFrames((f) => Object.fromEntries(
      Object.entries(f).filter(([k]) => !k.startsWith(`${stepId}:`))));
  }

  /**
   * Do this step again, and stand on it.
   *
   * It clears what this SCREEN remembers about the step and nothing else. No capture is
   * retracted — captures are append-only by storage rule, every verdict stays in `decisions`,
   * and the next capture on a field REPLACES its current answer because the field document's
   * id is derived from the step and the key (see `fieldId` in live-source.ts). A person cannot
   * delete evidence here; they can only put better evidence in front of the fleet.
   *
   * The status goes back to `pending` locally, which is this screen saying "a person is doing
   * this again" — not a claim about the server, which refuses `performed` from every client
   * anyway, and which the next verdict will restate.
   */
  function redoStep(stepId: string) {
    const i = proc!.steps.findIndex((s) => s.id === stepId);
    if (i < 0) return;
    const keys = [...proc!.steps[i].fields, ...(added[stepId] ?? [])].map((f) => f.key);
    setAnswers((a) => {
      const next = { ...a };
      for (const k of keys) delete next[`${stepId}:${k}`];
      return next;
    });
    dropFrames(stepId);
    setStatuses((st) => ({ ...st, [stepId]: "pending" }));
    setHolds(({ [stepId]: _gone, ...rest }) => rest);
    setCursor(i);
    setSelected(null);
    setTyped("");
  }

  async function record(
    fieldKey: string,
    mediaRef: string,
    blob: Blob | null,
    kind: "photo" | "video" | "text",
    mode: "live" | "upload" = "live",
  ) {
    // Resolves as soon as the evidence is durable. Nobody stands in a workshop watching a
    // spinner — but the bytes are part of "durable", so this does wait for the upload.
    await src.capture({
      jobId: job!.id, stepId: step.id, fieldKey,
      kind, mediaRef, blob, surface: "browser", mode,
    });
    setAnswers((a) => ({ ...a, [`${step.id}:${fieldKey}`]: mediaRef || "captured" }));
  }

  async function onShutter(field: FieldDef) {
    const slot = `${step.id}:${field.key}`;
    if (frames[slot]) {
      // Retake is two taps on purpose: drop the frame, look again, then decide. A single tap
      // that both discarded and re-fired would make the discard invisible.
      setFrames(({ [slot]: _gone, ...rest }) => rest);
      setAnswers(({ [slot]: _also, ...rest }) => rest);
      setSelected(field.key);
      return;
    }
    setWork("Capturing…");
    const shot = await camera.capture();
    if (!shot) { setWork(null); return; }
    setFrames((f) => ({ ...f, [slot]: shot.url }));
    setWork("Saving this capture…");
    try {
      await record(field.key, shot.url, shot.blob, field.kind === "video" ? "video" : "photo");
      setSelected(null);
    } finally {
      // Cleared even when the write throws. A bar stuck reading "Saving…" over a capture that
      // failed is a worse lie than the silence this replaced.
      setWork(null);
    }
  }

  async function onRecordTyped(field: FieldDef) {
    const value = typed.trim();
    if (!value) return;
    setWork("Recording…");
    try {
      await record(field.key, value, null, "text", "upload");
      setTyped("");
      setSelected(null);
    } finally {
      setWork(null);
    }
  }

  async function onReason(r: { kind: "voice" | "text"; transcript: string }) {
    setBusy(true);
    await src.declareBlocked({
      jobId: job!.id, stepId: step.id,
      reasonKind: r.kind, transcript: r.transcript,
    });
    setBusy(false);
    setReasoned((x) => ({ ...x, [step.id]: true }));
    // And then move. Stating a reason used to leave the technician exactly where they were —
    // same step, same grey bar, the sheet closing onto the question they had just finished
    // explaining they could not answer.
    //
    // What moves is the SCREEN, not the step's status. The outcome is still `pending` and the
    // fleet still has to rule on the reason; the record can still seal deficient because of
    // it. Nothing here forgives the step. It just stops standing in front of the next one.
    if (lastStep) void onFinish(); else setCursor((c) => Math.min(c + 1, proc!.steps.length - 1));
  }

  /**
   * The end of the technician's work, which is NOT the seal.
   *
   * Finalising is what hands the job to the fleet — before it, nothing has been adjudicated and
   * a workshop with no signal works exactly the same. After it the handover page says which of
   * the three true things is true. See data/handover.ts.
   */
  async function onFinish() {
    if (job!.status === "draft") {
      setWork("Handing this to the fleet…");
      try {
        await src.finalize(job!.id);
        const fresh = await src.getJob(jobId);
        if (fresh) setJob(fresh);
      } finally {
        setWork(null);
      }
    }
    setHandedOver(true);
  }

  function onPrimary() {
    switch (action.kind) {
      case "capture": if (active) void onShutter(active); break;
      case "record": if (active) void onRecordTyped(active); break;
      case "pair": router.push("/instruments"); break;
      // The bar's own way out, for a question that has no answers. Same sheet the ⚠ opens —
      // there is still exactly one second exit, and this is a second door onto it rather than
      // a third way out of the step.
      case "declare": setBlocked(true); break;
      case "advance": setCursor((c) => Math.min(c + 1, proc!.steps.length - 1)); break;
      // Deliberately not "advance". There is no step after the last one, so advancing past it
      // changes nothing and the button reads as dead — which is exactly what it was.
      case "finish": void onFinish(); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------------------ the notices

  const notices: Notice[] = [];
  if (held) {
    notices.push({
      headline: "Machine held",
      detail: `${held}. It will not be released until the record holds up.`,
      blocking: true,
    });
  }
  for (const item of waiting) {
    const at = proc.steps.find((s) => s.id === item.stepId);
    const key = `${item.stepId}:${item.kind}`;
    if (dismissed[key]) continue;
    notices.push({
      headline:
        item.kind === "question" ? "The fleet asked you something"
          : item.kind === "hold" ? "Stuck, and waiting on a person"
            : "One more thing needed",
      detail:
        `${item.ask}` +
        (at ? ` — step ${at.index}, ${at.title}.` : "") +
        // An answer that was already given stays on screen: the fleet has still to rule on it,
        // and clearing it the moment somebody spoke would claim a settlement that has not
        // happened.
        (!item.outstanding && item.answer
          ? ` You said: “${item.answer}” — ${item.answeredBy ?? "answered"}.`
          : ""),
      blocking: item.kind === "hold",
      goToLabel: "Go to that step",
      onGoTo: () => goToStep(item.stepId),
      // Both, because the ask does not say which is right and the person does. An appended
      // field is more evidence BESIDE what is there; a hold is usually the evidence itself
      // being wrong.
      onRedoStep: () => redoStep(item.stepId),
      onDismiss: () => setDismissed((d) => ({ ...d, [key]: true })),
    });
  }
  if (outstanding.length > 0 && !dismissed.outstanding) {
    const first = outstanding[0];
    notices.push({
      headline: `${outstanding.length} step${outstanding.length > 1 ? "s" : ""} still waiting`,
      detail:
        "This job cannot seal until every step has an outcome. Nothing here is lost — go back " +
        `and finish it whenever you like. The first is step ${first.step.index}, ${first.step.title}.`,
      goToLabel: `Go to step ${first.step.index}`,
      onGoTo: () => goToStep(first.step.id),
      onDismiss: () => setDismissed((d) => ({ ...d, outstanding: true })),
    });
  }

  // ----------------------------------------------------------------------------- the handover

  if (handedOver) {
    const owed = proc.steps.filter((s) =>
      (statuses[s.id] ?? "pending") === "pending" && !optionalStep(s) && !reasoned[s.id]).length;
    const explained = Object.keys(reasoned).length;
    const state = handoverStateFor(owed, sealedRecordId);
    const { headline, detail } = handoverHeadline(state, owed, explained);
    return (
      <AppShell tone="work">
        {/* `handover` is a hook for scripts/smoke_funnel.py, which drives this flow in a real
            browser and needs to know it has left the steps. */}
        <div className="stack stack--lg handover">
          <div className="w-trace__head">
            <span className="w-trace__agent">{headline}</span>
            <StatusPill status={(sealedRecordId ? "sealed" : job.status) as JobStatus} />
          </div>
          <p className="lede">{detail}</p>

          {owed > 0 && (
            <div className="stack">
              {proc.steps
                .filter((s) => (statuses[s.id] ?? "pending") === "pending"
                  && !optionalStep(s) && !reasoned[s.id])
                .map((s) => (
                  <button
                    key={s.id}
                    className="w-btn w-btn--ghost w-btn--block"
                    onClick={() => { setHandedOver(false); goToStep(s.id); }}
                  >
                    Step {s.index} — {s.title}
                  </button>
                ))}
            </div>
          )}

          <div className="w-step__exits">
            {sealedRecordId && (
              // A Link, NOT an anchor. On the fixture source the records live in this tab's
              // memory, so a full document load arrives at /r/{id} with an empty store and
              // reports the record as missing — which is exactly what the old redirect avoided
              // by being a client-side push. The distinction is invisible against Firestore and
              // fatal against fixtures, which is the harder of the two to notice.
              <Link className="w-btn" href={`/r/${encodeURIComponent(sealedRecordId)}`}>
                Open the record
              </Link>
            )}
            {owed === 0 && (
              <button
                className="w-btn w-btn--ghost"
                onClick={() => { setHandedOver(false); setCursor(0); }}
              >
                Back to the steps
              </button>
            )}
            <a className="w-btn w-btn--ghost" href="/">Start another task</a>
          </div>

          <div className="stack">
            <p className="eyebrow">What the fleet decided</p>
            <p className="w-trace__why">
              Capture never waits. These land behind you, and you can leave — it will not stop.
            </p>
            <AgentTrace decisions={decisions} />
          </div>
        </div>
      </AppShell>
    );
  }

  // ---------------------------------------------------------------------------- the step page

  const pips: FieldPip[] = fields.map((f) => ({
    key: f.key,
    label: f.key.replace(/_/g, " "),
    filled: isFilled(step.id, f.key),
    required: requiredAt(f, strictness),
  }));

  const evidence: ProvenanceClass = declaredClass(active ?? fields[0]);
  const cameraLive = Boolean(active && usesCamera(active) && reviewing === null);

  return (
    <>
      <StepPage
        stepIndex={cursor}
        stepCount={proc.steps.length}
        title={step.title}
        prompt={active?.prompt}
        guidance={active?.guidance}
        evidence={evidence}
        notices={notices}
        primary={action}
        onPrimary={onPrimary}
        onExit={() => router.push("/")}
        onBrief={() => setBrief(true)}
        onBlocked={() => setBlocked(true)}
        onTrace={() => setTrace(true)}
        onBack={cursor > 0 ? () => setCursor(cursor - 1) : null}
        onRedo={
          // Redo, at the scope of one capture. Offered only while a field is still outstanding,
          // which is to say while there is a frame on screen you have not decided about yet.
          active && framedField
            ? () => {
              const slot = `${step.id}:${framedField.key}`;
              setFrames(({ [slot]: _gone, ...rest }) => rest);
              setAnswers(({ [slot]: _also, ...rest }) => rest);
              setSelected(framedField.key);
            }
            : null
        }
        onRedoStep={
          // Redo, at the scope of the whole step. THE CASE THE BAR CANNOT REACH: a step with
          // every field filled points at nothing, so the bar says "Next step" and there is
          // nothing else to tap. That is exactly the state an agent's rejection leaves you in.
          !active && fields.some((f) => isFilled(step.id, f.key))
            ? () => redoStep(step.id)
            : null
        }
        pips={pips}
        activePipKey={active?.key ?? null}
        onPip={(key) => setSelected(key)}
        backdrop={
          framedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="w-steppage__frame" src={framedUrl} alt={active?.prompt ?? step.title} />
          ) : active && usesCamera(active) ? (
            <CameraLayer handle={camera} lens={lens} lamp={lamp} />
          ) : null
        }
        center={
          <StepCenter
            field={active}
            stepComplete={!active}
            live={cameraLive}
            canFlip={camera.canFlip}
            canLamp={camera.canLamp}
            lens={lens}
            lamp={lamp}
            onFlip={() => setLenses((l) => ({ ...l, [step.id]: flip(lens) }))}
            onLamp={() => setLamps((l) => ({ ...l, [step.id]: !lamp }))}
            typed={typed}
            onTyped={setTyped}
            signer={session?.name ?? session?.email ?? session?.uid ?? null}
            optional={active ? !requiredAt(active, strictness) : false}
            appended={Boolean(active && extra.some((f) => f.key === active.key))}
          />
        }
      />

      {brief && (
        <StepBriefSheet
          step={step}
          total={proc.steps.length}
          guidance={active?.guidance ?? fields[0]?.guidance}
          onDismiss={() => setBrief(false)}
        />
      )}
      {blocked && (
        <BlockedSheet
          busy={busy}
          onSubmit={(r) => void onReason(r)}
          onDismiss={() => setBlocked(false)}
        />
      )}
      {trace && (
        <TraceSheet
          decisions={decisions}
          sealedRecordId={sealedRecordId}
          fabricated={src.fabricated}
          onDismiss={() => setTrace(false)}
        />
      )}
    </>
  );
}

/** What a field can reach at best, which is what the chip over the frame states. */
function declaredClass(f: FieldDef | null | undefined): ProvenanceClass {
  if (!f) return "asserted";
  if (f.source === "instrument") return "measured";
  if (f.source === "human") return "asserted";
  return "inferred";
}

/**
 * Everything the field itself needs, drawn over the middle of the frame.
 *
 * A port of `StepCenter` in android/…/ui/job/JobScreen.kt. A camera field draws NOTHING here
 * on purpose — the lens is the backdrop and the prompt is already printed over it, so anything
 * in the middle would be furniture between the technician and the thing they are pointing at.
 */
function StepCenter({
  field, stepComplete, live, canFlip, canLamp, lens, lamp, onFlip, onLamp,
  typed, onTyped, signer, optional, appended,
}: {
  field: FieldDef | null;
  stepComplete: boolean;
  live: boolean;
  canFlip: boolean;
  canLamp: boolean;
  lens: Lens;
  lamp: boolean;
  onFlip: () => void;
  onLamp: () => void;
  typed: string;
  onTyped: (v: string) => void;
  signer: string | null;
  optional: boolean;
  appended: boolean;
}) {
  const fault = field ? unanswerable(field) : null;
  return (
    <>
      <div className="w-center">
        {appended && (
          <p className="w-center__note w-center__note--inferred">
            Added just now — the Inspector asked for this
          </p>
        )}
        {/* An added field is never optional: an agent does not ask for evidence it is willing
            to do without. So this can only mark a declared one. */}
        {!appended && optional && field && (
          <p className="w-center__note">Optional on this job — the step does not wait for this</p>
        )}

        {stepComplete ? (
          <p className="w-center__note w-center__note--measured">
            Everything this step needs is recorded. Verification is running behind you.
          </p>
        ) : !field ? null : fault ? (
          // Before every kind branch, because none of them can draw this honestly. Saying only
          // what is wrong is what wedged a job: the sentence was there, correct, and left the
          // technician looking at a grey bar with no reason to think the run could continue.
          <p className="w-center__note w-center__note--held">
            {fault} Say so with the bar below and carry on — the reason goes on the record and
            the fleet rules on it.
          </p>
        ) : field.kind === "measurement" ? (
          // There is no text input on this branch, at all, on purpose. If a person can type the
          // number, the number is asserted, and calling it measured afterwards would be a lie
          // told by the user interface. The bar below offers pairing instead.
          <p className="w-center__note w-center__note--measured">
            This value has to arrive from a paired instrument, and a browser has no pairing.
            Nothing here will accept a typed number wearing the measured chip.
          </p>
        ) : usesCamera(field) ? null : field.kind === "signature" ? (
          // STATED, NOT COLLECTED. The field is already satisfied from the signed-in account;
          // there is nothing here for anybody to do, and a box asking for a name would be
          // collecting a second copy of something the record already carries as the caller's
          // own uid.
          <Attribution prompt={field.prompt} who={signer} />
        ) : field.kind === "choice" ? (
          // The answers the procedure actually offers, drawn as answers. `typed` still carries
          // the pending value, so the bar below is untouched — the only thing that changes is
          // where the value comes from: a tap on a stated option rather than anything at all a
          // keyboard could produce.
          <div className="w-center__choices">
            {(field.choices ?? []).map((c) => (
              <button
                key={c}
                type="button"
                className={`w-center__choice${typed === c ? " w-center__choice--on" : ""}`}
                onClick={() => onTyped(c)}
                aria-pressed={typed === c}
              >
                {c}
              </button>
            ))}
          </div>
        ) : usesKeyboard(field) ? (
          <input
            className="w-center__input"
            value={typed}
            onChange={(e) => onTyped(e.target.value)}
            placeholder="Type the value"
            aria-label={field.prompt}
          />
        ) : null}
      </div>

      {/* Both only while the lens is actually open. `live` is already false while a frame is
          under review, which is what we want: the lamp cannot be changed for a photograph that
          has already been taken. Redo reopens the lens and the chips come back with it. */}
      {live && (
        <div className="w-lensbar">
          <LiveMark />
          <span className="w-lensbar__right">
            {canLamp && <LampControl on={lamp} onToggle={onLamp} />}
            {canFlip && <LensControl lens={lens} onFlip={onFlip} />}
          </span>
        </div>
      )}
    </>
  );
}
