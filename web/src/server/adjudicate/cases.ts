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
    asset: a.asset ?? { id: a.job.asset_id ?? null },
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
