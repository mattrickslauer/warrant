"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  StepCard, CaptureTile, ReasonCapture, Attribution, AnswerInput, AgentTrace, HoldBanner,
  StatusPill, Rule, Wrap, EvidenceChip, type JobStatus,
} from "@/components";
import { useSession } from "@/auth/session-context";
import {
  getDataSource, scoped, surfaceCanRun, openItems, firstOwed,
  type JobEvent, type OpenItem,
} from "@/data";
import type { Decision, Field, FieldDef, Job, Procedure, StepOutcome } from "@/generated/types";

type Exit = "capture" | "reason";

export function JobFlow({ jobId }: { jobId: string }) {
  const router = useRouter();
  const src = useMemo(() => getDataSource(), []);
  // Who the record attributes assertions to. Never typed — see the effect below.
  const { session } = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [finalising, setFinalising] = useState(false);
  const [proc, setProc] = useState<Procedure | null>(null);
  const [cursor, setCursor] = useState(0);
  const [exit, setExit] = useState<Exit>("capture");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [added, setAdded] = useState<Record<string, FieldDef[]>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  /** A question an agent put to a person, per step. The step stays pending and carries it. */
  const [escalations, setEscalations] = useState<Record<string, string>>({});
  /** Why a step did not advance, per step. An agent answered and could not be acted on. */
  const [holds, setHolds] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const [furthest, setFurthest] = useState(0);
  const advanced = useRef<Set<string>>(new Set());
  /** Signature fields already satisfied from the session, so this happens once each. */
  const attributed = useRef<Set<string>>(new Set());

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
      const p = await src.getProcedure(scoped(j.tenant_id, j.procedure_id));
      if (!alive) return;
      setProc(p);

      // EVERYTHING THE JOB ALREADY KNOWS, BEFORE THE FIRST EVENT ARRIVES.
      //
      // This screen used to start blank whatever the job had done: no statuses, no appended
      // fields, no questions, and the cursor on step one. So a job reopened in a new tab — or
      // simply reloaded — presented four finished steps as untouched work, and the panel that
      // lists what is still waiting listed nothing, because it is fed by state that only
      // arrives over `subscribe`. The phone has rebuilt itself from the job like this since
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
      setAnswers(Object.fromEntries(
        (j.steps ?? []).flatMap((o) =>
          (o.fields ?? []).map((f) => [
            `${o.step_id}:${f.key}`,
            f.value_text ?? f.value_choice ?? (f.value_number != null ? String(f.value_number) : "captured"),
          ] as [string, string])),
      ));

      // Land on the first step that still owes something, never on step one. The same rule
      // the phone lands by, imported rather than rewritten — see data/attention.ts.
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
      // A question put to a person. Nothing on this screen used to read it, so an Inspector
      // that escalated reached the browser and stopped there — the step went back to pending
      // and the question was never drawn.
      if (e.kind === "escalated") setEscalations((q) => ({ ...q, [e.stepId]: e.question }));
      if (e.kind === "step_status") {
        setStatuses((s) => ({ ...s, [e.stepId]: e.status }));
        // A step that has since passed is not holding anything. Leaving the hold up would
        // nag about a step the fleet has already let through.
        if (e.status === "performed") {
          setHolds(({ [e.stepId]: _gone, ...rest }) => rest);
        }
      }
      // An answer landing, from this tab or another surface. Marks the field satisfied so the
      // step stops appearing as one that owes it.
      if (e.kind === "capture_accepted") {
        setAnswers((a) =>
          a[`${e.stepId}:${e.fieldKey}`] ? a : { ...a, [`${e.stepId}:${e.fieldKey}`]: "captured" });
      }
      if (e.kind === "held") setHeld(e.reason);
      if (e.kind === "sealed") router.push(`/r/${encodeURIComponent(e.recordId)}`);
    });
  }, [src, job, router]);

  // A SIGNATURE IS SATISFIED BY BEING SIGNED IN, AND IS NEVER ASKED FOR.
  //
  // The full argument is in `Attribution`. In short: a box asking a person to put their name
  // to a claim nothing checks is the tick in the box this product exists to replace, it proved
  // nothing when it was a typed name and it proved nothing when it was one tap, and the
  // attribution it collected already existed — the session's uid is on every write, and
  // firestore.rules refuses `reason_by`/`finalized_by` unless they equal `request.auth.uid`.
  //
  // So the field is satisfied here, from the session, with no act required of anybody. It is
  // still recorded as an ASSERTION and can never be promoted past one; the record's ceiling
  // states what that leaves unproved, which is the honest handling of a claim no machine can
  // check.
  useEffect(() => {
    if (!job || !proc) return;
    const s = proc.steps[cursor];
    if (!s) return;
    const here: FieldDef[] = [...s.fields, ...(added[s.id] ?? [])];
    const sigs = here.filter((f) => f.kind === "signature");
    if (sigs.length === 0) return;

    // Advancing is only right when there is nothing else on this step. A step that also wants
    // a photograph must not be walked past because the assertion on it resolved instantly.
    const onlySignatures = here.length === sigs.length;
    const who = session?.name ?? session?.email ?? session?.uid ?? null;

    void (async () => {
      let wrote = false;
      for (const f of sigs) {
        const key = `${s.id}:${f.key}`;
        if (attributed.current.has(key)) continue;
        attributed.current.add(key);
        setAnswers((prev) => ({ ...prev, [`${s.id}:${f.key}`]: who ?? "unattributed" }));
        await src.capture({
          jobId: job.id, stepId: s.id, fieldKey: f.key,
          // `text` is the one capture kind with no object behind it, and `media_ref` carries
          // the claim itself. Never `photo` — that would have the fleet derive a .jpg path
          // for somebody's name and then fail to read it.
          kind: "text", mediaRef: who ?? "unattributed", blob: null,
          surface: "browser", mode: "upload",
        });
        wrote = true;
      }
      if (wrote && onlySignatures) {
        setTimeout(() => {
          setCursor((c) => (c === cursor ? Math.min(c + 1, proc.steps.length - 1) : c));
        }, 900);
      }
    })();
  }, [src, job, proc, cursor, added, session]);

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

  // What this job does not actually need.
  //
  // A procedure may declare a step or a capture optional — `required_at_strictness: 4`, the
  // level strictness cannot reach — and the seal honours it. Saying so HERE is what makes it
  // real for the person standing at the machine: an optional capture the screen presented
  // exactly like a required one would be taken every time, which is the same as not having
  // marked it optional at all. Judged against the job's own strictness, because a capture
  // required at 3 is mandatory on a regulated job and optional on a standard one.
  const optionalField = (f: FieldDef) => f.required_at_strictness > job.strictness;
  const optionalStep = (s: Procedure["steps"][number]) =>
    (s.required_at_strictness ?? 0) > job.strictness;

  // The job as this screen currently understands it: what the server last said, with every
  // event that has landed since folded on top.
  //
  // Assembled rather than kept as a second copy, so `openItems` can be asked directly — the
  // rule that decides what is waiting on a person is IMPORTED from data/attention.ts and not
  // rewritten here. The phone answers that question with the same function, and two surfaces
  // disagreeing about what an agent is asking for is exactly the drift that file exists to
  // prevent.
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
        // Only the KEYS matter to `openItems`, which asks whether an appended field has been
        // answered yet. Synthesised from what this screen has seen answered — which includes
        // answers that landed on another device, since `capture_accepted` feeds the same map.
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

  /**
   * Do this step again, and stand on it.
   *
   * The move an agent's rejection asks for and this screen had no way to offer. A step whose
   * fields are all answered shows a filled-in form and a "Next step" button; nothing on the
   * page could put the question back. So a verdict saying "this photograph will not do"
   * arrived, and the only way to act on it was to start the job over.
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
    // Otherwise the first capture of the redo does not advance: the guard below fires once per
    // field for the whole life of the screen, and this field has already spent its turn.
    for (const k of keys) advanced.current.delete(`${stepId}:${k}`);
    setStatuses((st) => ({ ...st, [stepId]: "pending" }));
    setHolds(({ [stepId]: _gone, ...rest }) => rest);
    setCursor(i);
    setExit("capture");
  }

  /** Land on a step somebody pointed at, without touching what it has. */
  function goToStep(stepId: string) {
    const i = proc!.steps.findIndex((s) => s.id === stepId);
    if (i < 0) return;
    setCursor(i);
    setExit("capture");
  }

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
      // An optional step left undone is not outstanding — the job seals without it, and
      // listing it under "cannot seal until every step passes" would be false.
      !optionalStep(x.step) &&
      (x.i < furthest || (added[x.step.id]?.length ?? 0) > 0)
    );

  // Field.kind is the discriminator, so the UI dispatches on it. A signature is not a
  // photograph and must never be collected as one.
  //
  // `text` and `choice` are not signatures and must not share a control with one: a text
  // answer is a claim, a choice is one of a fixed set the procedure already wrote down, and a
  // signature is not collected at all any more. They used to share one box and a camera, so
  // "How do the brakes perform?" opened a viewfinder and "What did you set them to?" asked for
  // a name. See `AnswerInput`, and `Attribution` for why the third asks for nothing.
  /** The name the record attributes an assertion to. Never typed, never asked for. */
  function signerName(): string | null {
    return session?.name ?? session?.email ?? session?.uid ?? null;
  }

  function controlFor(f: FieldDef) {
    // NOTHING IS ASKED FOR A SIGNATURE. See `Attribution`, which carries the argument: the
    // person is signed in, the record already attributes every write to their uid, and a box
    // asking them to put their name to an unverifiable claim is the tick in the box this
    // product exists to abolish. It is satisfied from the session by the effect above.
    if (f.kind === "signature") {
      return <Attribution prompt={f.prompt} who={signerName()} />;
    }
    if (f.kind === "text" || f.kind === "choice") {
      return (
        <AnswerInput
          prompt={f.prompt}
          choices={f.kind === "choice" ? (f.choices ?? []) : undefined}
          answered={answers[`${step.id}:${f.key}`] ?? null}
          onAnswer={(value) => {
            setAnswers((a) => ({ ...a, [`${step.id}:${f.key}`]: value }));
            onAnswer(f.key, value);
          }}
        />
      );
    }
    return (
      <CaptureTile
        hint={f.prompt}
        provenance={f.source === "instrument" ? "measured" : f.source === "human" ? "asserted" : "inferred"}
        // The blob travels. Without it the capture document points at an object nobody
        // uploaded — see `CaptureInput.blob`, which is where that failure is written down.
        onCapture={(blob, url) => onCapture(f.key, url, blob, f.kind === "video" ? "video" : "photo")}
      />
    );
  }

  /**
   * An answer, which is a capture of kind `text` and has no object anywhere.
   *
   * `media_ref` carries the answer itself — the contract says so, and the adjudication spine
   * already reads it that way: `run.ts` sets `sources.answer` from it, screens the text
   * instead of an image, and tells the Skeptic that belonging is not applicable. This used to
   * be written as `kind: "photo"` with `media_ref: "signature:Name"`, so the fleet derived a
   * `.jpg` path for it and Vertex was asked to read a photograph of somebody's name.
   */
  function onAnswer(fieldKey: string, value: string) {
    return onCapture(fieldKey, value, null, "text", "upload");
  }

  async function onCapture(
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
      reasonKind: r.kind, transcript: r.transcript,
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
                {/* Do this one again. Offered once the step has something to throw away —
                    over an untouched step it is a button that does nothing — and this is the
                    control an agent's rejection needs: without it a finished step shows a
                    filled-in form and no way back into it. */}
                {fields.some((f) => answers[`${step.id}:${f.key}`]) && (
                  <button
                    className="w-btn w-btn--ghost w-btn--block"
                    onClick={() => redoStep(step.id)}
                  >
                    Redo this step
                  </button>
                )}
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
              {optionalStep(step) && (
                <p className="w-step__num">
                  Optional on this job — do it if it is worth doing. The job seals without it.
                </p>
              )}
              {fields.map((f) => (
                <div className="stack" key={f.key}>
                  {extra.includes(f) && (
                    <p className="w-step__num" style={{ color: "var(--inferred-lift)" }}>
                      Added just now — the Inspector asked for this
                    </p>
                  )}
                  {/* An added field is never optional: an agent does not ask for evidence it
                      is willing to do without. So this can only mark a declared one. */}
                  {!extra.includes(f) && optionalField(f) && (
                    <p className="w-step__num">Optional — the step does not wait for this</p>
                  )}
                  {controlFor(f)}
                </div>
              ))}
            </div>
          ) : (
            <ReasonCapture onSubmit={onReason} busy={busy} />
          )}
        </StepCard>

        {/* WHAT AN AGENT IS ASKING FOR, IN THE WORDS IT ASKED.
            The panel below this one lists steps that will hold the seal open; this one lists
            questions. They are different things and the browser used to show only the first,
            which meant an Inspector appending a field or escalating to a person reached the
            app and stopped there — the step went back to pending and nothing said why. */}
        {waiting.length > 0 && (
          <div className="stack">
            <p className="eyebrow">Waiting on you</p>
            {waiting.map((item, n) => {
              const title = proc.steps.find((s) => s.id === item.stepId)?.title ?? item.stepId;
              const index = proc.steps.find((s) => s.id === item.stepId)?.index;
              return (
                <div className="stack" key={`${item.stepId}:${item.kind}:${n}`}>
                  <HoldBanner
                    kind={item.kind === "hold" ? "held" : "waiting"}
                    title={
                      item.kind === "question" ? "The fleet asked you something"
                        : item.kind === "hold" ? "Stuck, and waiting on a person"
                          : "One more thing needed"
                    }
                  >
                    {item.ask}
                  </HoldBanner>
                  <p className="w-timeline__when">Step {index ?? "?"} — {title}</p>
                  {/* An answer that was already given stays on screen: the fleet has still to
                      rule on it, and clearing it the moment somebody spoke would claim a
                      settlement that has not happened. */}
                  {!item.outstanding && item.answer && (
                    <p className="w-step__why">
                      &ldquo;{item.answer}&rdquo; — {item.answeredBy ?? "answered"}
                    </p>
                  )}
                  <div className="w-step__exits">
                    <button className="w-btn w-btn--ghost" onClick={() => goToStep(item.stepId)}>
                      Go to that step
                    </button>
                    {/* Both, because the ask does not say which is right and the person does.
                        An appended field is more evidence BESIDE what is there; a hold is
                        usually the evidence itself being wrong. */}
                    <button className="w-btn w-btn--ghost" onClick={() => redoStep(item.stepId)}>
                      Redo that step
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

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
                  onClick={() => goToStep(o.step.id)}
                >
                  Step {o.step.index} — {o.step.title}
                  {(added[o.step.id]?.length ?? 0) > 0 ? " · needs another capture" : ""}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* EVERY STEP OF AN UNSEALED JOB, AND THE WAY BACK INTO ANY OF THEM.
            This is the browser's version of the phone's job-record screen: a job that has not
            sealed is still moving and can still be argued with, so what it has captured is
            listed and each step can be done again. It is deliberately absent once the job
            seals — a sealed record is what SURVIVES the workshop, and offering to redo a step
            of it would be offering to change the one artifact whose whole value is that it
            cannot be changed afterwards. The record at /r/{id} is read-only for the same
            reason. */}
        {job.status !== "sealed" && (
          <div className="stack">
            <p className="eyebrow">Every step</p>
            <p className="w-trace__why">
              Where each one stands, and the way back into it. Nothing here deletes evidence:
              a capture that happened stays on the record, and doing a step again puts a better
              answer in front of the fleet beside the one it already has.
            </p>
            <div className="w-ceiling__rows">
              {proc.steps.map((st, i) => {
                const status = statuses[st.id] ?? "pending";
                const answered = [...st.fields, ...(added[st.id] ?? [])]
                  .some((f) => answers[`${st.id}:${f.key}`]);
                return (
                  <div className="w-ceiling__row" key={st.id}>
                    <span className="w-ceiling__reason" style={{ flex: 1 }}>
                      <span className="w-timeline__when">Step {st.index}</span> {st.title}
                      {" · "}
                      {status === "performed" ? "performed"
                        : optionalStep(st) ? "optional on this job"
                          : status}
                    </span>
                    <div className="w-step__exits">
                      <button
                        className="w-btn w-btn--ghost"
                        disabled={i === cursor}
                        onClick={() => goToStep(st.id)}
                      >
                        {i === cursor ? "You are here" : "Go to it"}
                      </button>
                      {answered && (
                        <button className="w-btn w-btn--ghost" onClick={() => redoStep(st.id)}>
                          Redo this step
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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
                  await src.finalize(job.id);
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
