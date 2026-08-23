// Firestore documents, in the shape the agents actually read.
//
// `inspector.py:parts` and `skeptic.py:parts` index into these dictionaries directly —
// case["field"]["key"], case["step"]["title"]. There is no adapter on the remote and no
// tolerance for a renamed key: it is a KeyError inside the engine, surfacing as a 500 that
// names nothing useful. So these builders are pure, tested against the keys the Python
// reaches for, and the Python is the authority whenever the two disagree.

export interface CaseSources {
  step: { id: string; title: string; explanation?: string; max_add_fields?: number };
  fieldDef: Record<string, any>;
  capture: Record<string, any>;
  job: Record<string, any>;
  strictness: number;
  addFieldsUsed: number;
  reading: { value: number; unit: string; source: string } | null;
  answer: string | null;
  mediaUris: string[];
  priorMediaUris: string[];
  /**
   * The capture this field's `consistent_with` rule resolves against, if there is one.
   *
   * Separate from priorMediaUris on purpose. Prior media is everything earlier, and it exists
   * so the Skeptic can spot a frame being submitted twice. This is one specific earlier
   * capture, named by the contract, and the Inspector judges against it.
   */
  referenceUris: string[];
  /** Null when this job names no asset. Absence is a fact, not an empty object. */
  asset: Record<string, any> | null;
}

/**
 * Extensions matter here, and not for tidiness.
 *
 * `Agent.media()` reads the MIME type off the suffix. An extensionless object raises
 * MediaMissing on the remote rather than being judged — which is the correct failure, but a
 * needless one.
 */
const EXTENSION: Record<string, string> = {
  photo: "jpg",
  video: "mp4",
  scan: "jpg",
  audio: "m4a",
};

/**
 * Where a capture's bytes live.
 *
 * Must agree with `storage.rules`, which allows exactly
 * `/tenants/{t}/captures/{jobId}/{file}` — append-only, so a technician cannot replace a
 * photograph that failed inspection with one that passes.
 */
export function mediaUri(
  bucket: string,
  capture: { id: string; kind: string },
  tenantId: string,
  jobId: string,
): string {
  const ext = EXTENSION[capture.kind] ?? "bin";
  return `gs://${bucket}/tenants/${tenantId}/captures/${jobId}/${capture.id}.${ext}`;
}

/**
 * The capture a `consistent_with` target names, in the spelling captures are stored under.
 *
 * The contract writes `acceptance_target` as `<stepId>.<fieldKey>`; a capture carries
 * `field_id` as `<stepId>__<fieldKey>`. Those two spellings meet here and nowhere else, so
 * a target that is not that shape resolves to null rather than to a query that matches
 * nothing — an unresolvable target is a procedure defect, not an empty result set.
 */
export function referenceFieldId(acceptanceTarget: string | null | undefined): string | null {
  if (!acceptanceTarget) return null;
  const parts = acceptanceTarget.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return `${parts[0]}__${parts[1]}`;
}

export function inspectorCase(a: CaseSources): Record<string, unknown> {
  return {
    step: {
      title: a.step.title,
      explanation: a.step.explanation ?? "",
      max_add_fields: a.step.max_add_fields ?? 2,
    },
    field: a.fieldDef,
    strictness: a.strictness,
    add_fields_used: a.addFieldsUsed,
    capture: {
      capture_surface: a.capture.capture_surface ?? "unknown",
      capture_mode: a.capture.capture_mode ?? "unknown",
    },
    // Present only when there IS one. inspector.py checks `is not None`, and a null here
    // would print an instrument block about a reading that does not exist.
    ...(a.reading ? { reading: a.reading } : {}),
    ...(a.answer !== null ? { answer: a.answer } : {}),
    // Omitted rather than emptied, like every other optional block: inspector.py renders a
    // heading only when there is an image under it, and a heading with nothing under it is
    // an invitation to invent what belongs there.
    ...(a.referenceUris.length
      ? {
          reference: {
            target: a.fieldDef.acceptance_target ?? null,
            media: a.referenceUris,
          },
        }
      : {}),
    media: a.mediaUris,
  };
}

/**
 * The second opinion, and deliberately a narrower one.
 *
 * The Skeptic is told: "You have not seen the Inspector's conclusion and must not guess it."
 * So nothing about acceptance, sufficiency or the Inspector's verdict may appear in here.
 * Leaking it would turn an independent check into an echo of the first one.
 */
export function skepticCase(a: CaseSources): Record<string, unknown> {
  return {
    // Null when the job names no asset, and never `{ id: null }`. The public procedures
    // never name one — the subject is whatever was on the desk — and skeptic.py branches on
    // absence to withdraw the asset question entirely. An empty shell would instead read as
    // an asset it was handed and could not identify, and "if you cannot establish identity,
    // dissent" would make a dissent the only honest answer to a question nobody asked.
    asset: a.asset ?? (a.job.asset_id ? { id: a.job.asset_id } : null),
    job: {
      id: a.job.id,
      procedure: a.job.procedure ?? a.job.procedure_id ?? null,
      opened_at: a.job.started_at ?? null,
      location: a.job.location ?? null,
    },
    capture: {
      kind: a.capture.kind,
      created_at: a.capture.created_at,
      capture_mode: a.capture.capture_mode,
      capture_surface: a.capture.capture_surface,
    },
    media: a.mediaUris,
    prior_media: a.priorMediaUris,
  };
}

/**
 * A step a technician could not perform, in the shape the Instructor reads.
 *
 * The transcript is passed through UNTIDIED. `instructor.py` says so in as many words — the
 * words somebody chooses when a bolt is round are evidence about the blocker — and cleaning it
 * up here would delete the evidence before the agent saw it.
 */
export interface StallSources {
  step: Record<string, any>;
  procedure: { title?: string; version?: number | string; strictness?: number; stepCount: number };
  stepIndex: number;
  job: Record<string, any>;
  outcome: Record<string, any>;
  /** Steps after this one in the pinned version, so a blocker can be judged against what is left. */
  remainingSteps: string[];
  now: string;
  /**
   * The shelf, or null when the shop keeps no inventory.
   *
   * NULL is not an empty shelf. Both agents branch on presence, so an empty list would print a
   * heading with nothing under it and invite the conclusion that there are no parts.
   *
   * Structurally typed rather than importing `StockLine`, so this module keeps no dependency on
   * `stock.ts` — that file is `server-only`, and `cases.test.mjs` imports this one directly to
   * test the builders as the pure functions they are.
   */
  stock?: readonly unknown[] | null;
}

export function instructorCase(a: StallSources): Record<string, unknown> {
  return {
    procedure: {
      title: a.procedure.title ?? null,
      version: a.procedure.version ?? null,
      strictness: a.procedure.strictness ?? 1,
      step_count: a.procedure.stepCount,
    },
    step: {
      title: a.step.title,
      explanation: a.step.explanation ?? "",
      index: a.stepIndex,
      fields: (a.step.fields ?? []).map((f: any) => ({ prompt: f.prompt })),
    },
    machine: {
      id: a.job.asset_id ?? null,
      model: a.job.asset_model ?? null,
      usage: a.job.asset_usage ?? null,
      history: a.job.asset_history ?? [],
    },
    ...(a.remainingSteps.length ? { remaining_steps: a.remainingSteps } : {}),
    // "What is on the shelf right now". The Instructor's whole job is a next action that is
    // doable NOW or plainly is not, and it cannot tell those apart without this.
    ...(a.stock ? { stock: a.stock } : {}),
    reason_kind: a.outcome.reason_kind ?? "voice",
    // Verbatim. Not trimmed, not sanitised, not summarised.
    transcript: a.outcome.reason_transcript ?? "",
  };
}

/**
 * The same stall, one agent later.
 *
 * `recommendation` is the Instructor's own six fields, unchanged — `instructor-recommendation`
 * and the block `foreman.py` renders as "What the Instructor made of it" are the same six keys,
 * which is not a coincidence: the handoff was designed, it was simply never connected.
 *
 * Null when the Instructor could not be asked. The Foreman is shown the absence rather than a
 * fabricated recommendation, because a disposition built on an invented blocker is worse than
 * one built on a technician's raw sentence.
 */
export function foremanCase(
  a: StallSources & { recommendation: Record<string, any> | null;
                      stepsOutstanding: number; daysOpen: number | null;
                      history: string[] },
): Record<string, unknown> {
  const r = a.recommendation;
  return {
    job: {
      id: a.job.id,
      procedure: a.job.procedure ?? a.job.procedure_id ?? null,
      opened_at: a.job.started_at ?? null,
      now: a.now,
      days_open: a.daysOpen,
      asset_id: a.job.asset_id ?? null,
      booking: a.job.booking ?? null,
      steps_outstanding: a.stepsOutstanding,
    },
    step: {
      title: a.step.title,
      explanation: a.step.explanation ?? "",
      // "unstated" rather than false. A step nobody marked safety-critical is not a step
      // somebody marked safe, and foreman.py renders the difference.
      safety_critical: a.step.safety_critical ?? "unstated",
    },
    recommendation: r
      ? {
          reason_summary: r.reason_summary ?? null,
          blocker_kind: r.blocker_kind ?? null,
          recommended_action: r.recommended_action ?? null,
          proposed_status: r.proposed_status ?? null,
          blocking_part: r.blocking_part ?? null,
          safety_flag: r.safety_flag ?? null,
        }
      : {
          reason_summary: a.outcome.reason_transcript ?? null,
          blocker_kind: null,
          recommended_action: null,
          proposed_status: null,
          blocking_part: null,
          safety_flag: null,
        },
    ...(a.history.length ? { history: a.history } : {}),
    // "Stock and orders". CHASE and REORDER are the same decision seen from either side of
    // this list: chasing a part that is on the shelf wastes a week, and reordering one that
    // is already on order buys it twice.
    ...(a.stock ? { stock: a.stock } : {}),
  };
}

/**
 * Weeks of finished jobs, in the shape the Auditor reads.
 *
 * The jobs go over WHOLE rather than pre-tallied, and `auditor.py` says why: counting the
 * recurrences is arithmetic the model must do against the evidence in front of it, and handing
 * it the conclusion would leave only the wording to generate.
 *
 * But whole is not unbounded. Every job is serialised into one prompt, and "across weeks of
 * asynchronous operations" is the timescale this agent exists for — so the window is capped and
 * the truncation is STATED IN THE PROMPT rather than applied silently. An Auditor that believes
 * it read every job in the window will compute "nine in forty" from a sample of twenty, and the
 * denominator is the whole basis of a finding.
 */
export interface AuditSources {
  procedure: { key: string; title?: string; version?: number | string;
               strictness?: number; inServiceSince?: string | null };
  steps: Array<Record<string, any>>;
  window: { from: string; to: string };
  jobs: Array<Record<string, any>>;
  /** How many jobs were in the window before the cap. */
  totalInWindow: number;
  priorFindings: Array<Record<string, any>>;
}

export function auditorCase(a: AuditSources): Record<string, unknown> {
  const truncated = a.totalInWindow > a.jobs.length;
  return {
    procedure: {
      key: a.procedure.key,
      title: a.procedure.title ?? null,
      version: a.procedure.version ?? null,
      strictness: a.procedure.strictness ?? 1,
      in_service_since: a.procedure.inServiceSince ?? null,
      steps: a.steps,
    },
    window: {
      from: a.window.from,
      to: a.window.to,
      // Never silently. A count computed from a sample presented as a census is a fabricated
      // denominator, and every finding this agent makes rests on one.
      ...(truncated
        ? { truncated: `${a.totalInWindow} jobs ran in this window and you are being shown the ` +
                       `${a.jobs.length} most recent. Any count you make is out of ` +
                       `${a.jobs.length}, not ${a.totalInWindow}.` }
        : {}),
    },
    jobs: a.jobs,
    ...(a.priorFindings.length ? { prior_findings: a.priorFindings } : {}),
  };
}
