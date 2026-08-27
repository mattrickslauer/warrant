// LiveSource — the same seam, backed by Firestore.
//
// This runs in the BROWSER, against the authenticated Firebase client, and that is a
// deliberate choice rather than an accident of where it ended up:
//
//   1. Every screen that reads a job is already a client component, because the job screen
//      is driven by subscribe() — verdicts land after the technician has moved on, and that
//      is the whole reason the seam exists (see source.ts).
//   2. Reading through the authenticated client means firestore.rules is what enforces
//      tenancy. Server code holds Admin credentials, which BYPASS rules; routing reads
//      through the client keeps the documented §7 rules load-bearing rather than decorative.
//   3. onSnapshot is a real push. The fixture timeline fakes lateness with setTimeout; here
//      lateness is genuine, and the screens cannot tell the difference — which is the test
//      that the seam was drawn in the right place.
//
// What this deliberately does NOT do is produce verdicts. The Inspector, the Skeptic and the
// Foreman decide, and they run server-side over Pub/Sub; a capture written here is evidence
// waiting on them. LiveSource inventing a PASS would be exactly the tick in the box this
// product exists to abolish.
//
// ---------------------------------------------------------------------------------------
// STORAGE IS DECOMPOSED, THE AGGREGATE IS NOT.
//
//   /tenants/{t}/jobs/{jobId}                         header — status, tier, counters
//   /tenants/{t}/jobs/{jobId}/step_outcomes/{stepId}   one per step
//   /tenants/{t}/jobs/{jobId}/fields/{stepId}__{key}   one per field
//   /tenants/{t}/jobs/{jobId}/captures/{captureId}     one per capture
//
// This file used to write `tx.update(jobRef, { steps })` on every capture, rewriting the
// whole steps[] array after reading the whole job inside a transaction. Write cost grew with
// evidence already captured, a document is capped at 1 MiB, and two technicians on one job
// contended on a single document. Now a capture writes two new documents and reads nothing.
//
// The `Job` the DataSource returns is unchanged — assembled here from the header plus two
// subcollection reads. That is the seam earning its keep: storage moved and no screen did.
//
// It bought a second thing. `tool_id` used to sit inside an array, where no Firestore rule
// could see it, so a client could claim a fabricated measured reading and only the Seal would
// catch it. As a field on its own document it is guarded by clientMayNotClaim() in
// firestore.rules. See specs/2026-08-20-firestore-design.md §7.0.

import {
  collection, deleteField, doc, getDoc, getDocs, increment, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where, writeBatch, type Firestore,
} from "firebase/firestore";
import type {
  Procedure, Job, StepOutcome, Capture, Decision, SealedRecord, Field,
} from "@/generated/types";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import type { DataSource, JobEvent, CaptureInput, BlockedInput, Tier, Unsubscribe } from "./source";
import { clientDb, clientAuth, clientStorage } from "@/auth/firebase-client";

const now = () => new Date().toISOString();

/**
 * The extension a kind is stored under, or null when the kind has no object behind it.
 *
 * It has to be here and it has to agree with `server/adjudicate/cases.ts`, which derives the
 * same name on the other side and never looks the object up. The fleet reads the media type
 * off the suffix, so an extensionless object is refused by the agent rather than judged.
 * Android says all of this in `data/Media.kt`; the two tables are the same table.
 */
const EXTENSION: Record<Capture["kind"], string | null> = {
  photo: "jpg",
  video: "mp4",
  scan: "jpg",
  audio: "m4a",
  // The one kind with no object. `media_ref` carries the answer itself — see
  // contract/entities/capture.schema.json, which says so in the field description.
  text: null,
};

/**
 * Where the bytes go, which is the one path `storage.rules` allows a client to create.
 *
 * Append-only by rule: a technician cannot replace a photograph that failed inspection with
 * one that passes.
 */
const mediaPath = (tenantId: string, jobId: string, captureId: string, ext: string) =>
  `tenants/${tenantId}/captures/${jobId}/${captureId}.${ext}`;

/**
 * Who is writing this, taken from the signed-in user and never from a caller.
 *
 * `reason_by` and `finalized_by` are read back by the Seal to name the people on a record, so
 * they are a signature. This used to be a parameter, and every call site passed a placeholder
 * — `by: "you"` here, `by = "technician"` on the phone — which meant the member lookup found
 * nobody and no record ever named anyone. A caller that CAN say who it is will eventually say
 * something else, so it is no longer asked: firestore.rules refuses either field unless it
 * equals `request.auth.uid`, and this is that same uid, read from the same client whose token
 * authorises the write. The value and the permission cannot disagree.
 */
function currentUid(): string {
  const uid = clientAuth().currentUser?.uid;
  if (!uid) throw new Error("Not signed in; nothing can be written on nobody's behalf.");
  return uid;
}

/** `/tenants/{t}/…` — the one path shape docs/data-model.md §4 defines. */
const tenantCol = (db: Firestore, tenantId: string, name: string) =>
  collection(db, "tenants", tenantId, name);

/**
 * A field's document id, derived rather than random.
 *
 * Re-capturing a field REPLACES the current answer instead of appending, which bounds this
 * subcollection at (declared fields + ADD_FIELDs) however many attempts a step takes. Nothing
 * is lost: every attempt stays in `captures`, which storage.rules makes append-only, and every
 * verdict stays in `decisions`. This collection holds the current answer; history lives where
 * history belongs.
 */
export const fieldId = (stepId: string, key: string) => `${stepId}__${key}`;

export class LiveSource implements DataSource {
  readonly name = "live" as const;
  readonly fabricated = false;

  private db: Firestore;
  /**
   * Where the signature comes from. See `currentUid`.
   *
   * Injectable for the same reason `db` is: a test drives this class against the emulator with
   * no Firebase app initialised, and reaching for `clientAuth()` there throws before the write
   * under test is ever attempted. The DEFAULT is the real signed-in user, so nothing in the
   * product can quietly supply an identity of its own — the seam exists for the emulator, not
   * as a way to pass a uid in.
   */
  private uid: () => string;

  /**
   * How bytes reach Cloud Storage. Injectable for exactly the reason `db` and `uid` are.
   *
   * The emulator suite drives this class with no Firebase app initialised, and there is no
   * Storage emulator in `scripts/smoke.sh` — so a test that had to reach `clientStorage()`
   * would throw before the Firestore write it is actually asserting on ever happened. The
   * DEFAULT is the real bucket; the seam exists for the emulator, not as a way for anything
   * in the product to put evidence somewhere else.
   */
  private put: (path: string, blob: Blob) => Promise<void>;

  constructor(
    db?: Firestore,
    uid: () => string = currentUid,
    put: (path: string, blob: Blob) => Promise<void> = async (path, blob) => {
      await uploadBytes(storageRef(clientStorage(), path), blob, {
        // storage.rules checks this, and a blob that arrived without a type would be refused
        // by the rule rather than by anything that could explain itself.
        contentType: blob.type || "image/jpeg",
      });
    },
  ) {
    this.db = db ?? clientDb();
    this.uid = uid;
    this.put = put;
  }

  // ---------------------------------------------------------------- reads
  //
  // Every read takes the tenant explicitly. If a caller passes a tenant that is not theirs,
  // Firestore refuses — the check is in the rules, not in this file, which is the point.

  async listProcedures(tenantId: string): Promise<Procedure[]> {
    const snap = await getDocs(tenantCol(this.db, tenantId, "procedures"));
    return snap.docs.map((d) => d.data() as Procedure);
  }

  async getProcedure(id: string): Promise<Procedure | null> {
    // Procedures are addressed `{tenant}/{procedure}` so a bare id can be resolved.
    const [tenantId, procedureId] = splitScoped(id);
    if (!tenantId) return null;
    const snap = await getDoc(doc(this.db, "tenants", tenantId, "procedures", procedureId));
    return snap.exists() ? (snap.data() as Procedure) : null;
  }

  /**
   * The frozen version, not the live procedure.
   *
   * A job pins the version it started under. Reading the live document instead would mean
   * publishing v3 mid-job silently changed what a running v2 job was executing, while the job
   * still recorded `procedure_version: 2` — and a sealed record promises it names the version
   * that ran.
   */
  async getProcedureVersion(tenantId: string, procedureId: string, version: number): Promise<Procedure | null> {
    const bare = splitScoped(procedureId)[1];
    const snap = await getDoc(
      doc(this.db, "tenants", tenantId, "procedure_versions", `${bare}:${version}`),
    );
    return snap.exists() ? (snap.data() as Procedure) : null;
  }

  /** The assembled aggregate: header, plus its step outcomes, plus their fields. */
  async getJob(id: string): Promise<Job | null> {
    const [tenantId, jobId] = splitScoped(id);
    if (!tenantId) return null;

    const jobRef = doc(this.db, "tenants", tenantId, "jobs", jobId);
    const snap = await getDoc(jobRef);
    if (!snap.exists()) return null;

    const [outcomes, fields] = await Promise.all([
      getDocs(collection(jobRef, "step_outcomes")),
      getDocs(collection(jobRef, "fields")),
    ]);

    return assemble(
      snap.data() as JobHeader,
      outcomes.docs.map((d) => d.data() as StepOutcome),
      fields.docs.map((d) => d.data() as Field),
    );
  }

  /**
   * The job list, from headers alone.
   *
   * One read per job and no subcollection fan-out — which is why the header carries
   * denormalised counters. A list view that had to assemble every aggregate to show a
   * progress bar would read the whole tenant to render one screen.
   */
  async listJobs(tenantId: string): Promise<Job[]> {
    const snap = await getDocs(
      query(tenantCol(this.db, tenantId, "jobs"), orderBy("started_at", "desc")),
    );
    return snap.docs.map((d) => assemble(d.data() as JobHeader, [], []));
  }

  async getRecord(id: string): Promise<SealedRecord | null> {
    const [tenantId, recordId] = splitScoped(id);
    if (!tenantId) return null;
    const snap = await getDoc(doc(this.db, "tenants", tenantId, "records", recordId));
    return snap.exists() ? (snap.data() as SealedRecord) : null;
  }

  async listRecords(tenantId: string): Promise<SealedRecord[]> {
    const snap = await getDocs(
      query(tenantCol(this.db, tenantId, "records"), orderBy("sealed_at", "desc")),
    );
    // Scoped on the way out, the way a job header already is. A bare id from the document
    // would not survive a round trip through getRecord(), which addresses by tenant.
    return snap.docs.map((d) => {
      const rec = d.data() as SealedRecord;
      return { ...rec, id: scoped(tenantId, rec.id ?? d.id) };
    });
  }

  async listDecisions(tenantId: string): Promise<Decision[]> {
    const snap = await getDocs(
      query(tenantCol(this.db, tenantId, "decisions"), orderBy("at", "desc")),
    );
    return snap.docs.map((d) => d.data() as Decision);
  }

  // ---------------------------------------------------------------- writes

  /**
   * A job starts as a DRAFT. No agent runs on it until finalize() says so.
   *
   * The header and every step outcome land in one batch, because a job whose steps failed to
   * write would be a job that cannot record why a step was not done — and the second exit is
   * the thing that must never be missing.
   */
  async startJob({
    procedureId, tenantId, tier,
  }: { procedureId: string; tenantId: string; tier: Tier }): Promise<Job> {
    const live = await this.getProcedure(scoped(tenantId, procedureId));
    if (!live) throw new Error(`no such procedure: ${procedureId}`);

    // Pin the frozen version. Falling back to the live document keeps a procedure that was
    // never published through the version path runnable, rather than failing the technician.
    const pinned =
      (await this.getProcedureVersion(tenantId, procedureId, live.version)) ?? live;

    const ref = doc(tenantCol(this.db, tenantId, "jobs"));
    const id = scoped(tenantId, ref.id);

    const header: JobHeader = {
      schema_version: 1,
      id,
      tenant_id: tenantId,
      procedure_id: pinned.id,
      procedure_version: pinned.version,
      asset_urn: null,
      technician_id: null,
      status: "draft",
      strictness: pinned.strictness,
      tier,
      started_at: now(),
      sealed_at: null,
      finalized_at: null,
      finalized_by: null,
      step_count: pinned.steps.length,
      performed_count: 0,
      field_count: 0,
    };

    const batch = writeBatch(this.db);
    batch.set(ref, { ...header, created_at: serverTimestamp() });
    for (const step of pinned.steps) {
      batch.set(doc(collection(ref, "step_outcomes"), step.id), {
        id: `${ref.id}:${step.id}`,
        job_id: id,
        step_id: step.id,
        status: "pending",
      } satisfies Omit<StepOutcome, "fields">);
    }
    await batch.commit();

    return assemble(header, pinned.steps.map((s) => ({
      id: `${ref.id}:${s.id}`, job_id: id, step_id: s.id, status: "pending", fields: [],
    })), []);
  }

  /**
   * The human act that lets the fleet see this job.
   *
   * Everything before this is a draft: performed against the local cache, syncing when there
   * is signal, and invisible to every agent. This is the moment the work becomes work.
   */
  async finalize(jobId: string): Promise<void> {
    const [tenantId, id] = splitScoped(jobId);
    if (!tenantId) throw new Error(`job id is not tenant-scoped: ${jobId}`);
    await updateDoc(doc(this.db, "tenants", tenantId, "jobs", id), {
      status: "open",
      finalized_at: now(),
      // The signature, from the signed-in user. See `signedInUid`.
      finalized_by: this.uid(),
    });
  }

  /**
   * Returns as soon as the evidence is durable. Nothing waits on a verdict.
   *
   * Capture never blocks — a technician with dirty hands does not stand in a workshop
   * watching a spinner. The write lands, the screen advances, and whatever the Inspector
   * concludes arrives later through subscribe().
   *
   * Two documents, no reads, no transaction. The capture and the field it produces land in one
   * batch, so a field pointing at a capture that failed to write cannot exist — that would be
   * a record claiming evidence it does not have. The batch replaces the old read-modify-write
   * transaction entirely: nothing here depends on the job's current contents, which is exactly
   * what makes the cost O(1) rather than O(evidence so far).
   */
  async capture(input: CaptureInput): Promise<Capture> {
    const [tenantId, jobId] = splitScoped(input.jobId);
    if (!tenantId) throw new Error(`job id is not tenant-scoped: ${input.jobId}`);

    const jobRef = doc(this.db, "tenants", tenantId, "jobs", jobId);
    const capRef = doc(collection(jobRef, "captures"));
    const fRef = doc(collection(jobRef, "fields"), fieldId(input.stepId, input.fieldKey));

    // THE BYTES GO UP FIRST, and the write below only happens if they landed.
    //
    // A capture document pointing at an object that is not there is not a slow capture, it is
    // a false one: the fleet derives the path by convention and Vertex answers 404, which the
    // technician reads as "the fleet could not be reached" — a sentence about the network, for
    // a photograph still sitting in the tab. That was every browser capture this product ever
    // took. Failing HERE reaches the person while they can still take it again.
    const stored = await this.upload(tenantId, jobId, capRef.id, input);

    const capture: Capture = {
      id: capRef.id,
      field_id: fieldId(input.stepId, input.fieldKey),
      kind: input.kind,
      // The stored path, or — for `text`, the only kind with no object — the answer itself.
      media_ref: stored ?? input.mediaRef,
      capture_mode: input.mode,
      // Reported, not believed. A surface above `browser` is only credited once a server-side
      // attestation accompanies it, and firestore.rules refuses `app_instrument` from any
      // client at all — an instrumented capture is written by POST /api/ingest/reading.
      capture_surface: input.surface === "app_instrument" ? "app" : input.surface,
      attestation_device_id: null,
      attestation_play_integrity: null,
      redacted: false,
      armor_verdict: null,
      // The sweep's flag. FALSE, not absent — Firestore cannot query for a missing field, so
      // a capture written without this is invisible to the safety net that exists to catch it.
      adjudicated: false,
      created_at: now(),
    };

    const field: Field = {
      id: fieldId(input.stepId, input.fieldKey),
      step_id: input.stepId,
      key: input.fieldKey,
      kind: input.kind === "audio" ? "text" : input.kind,
      media_ref: capRef.id,
      captured_at: capture.created_at,
      // Null on purpose. The Seal stamps provenance, recomputed from the server-written
      // `readings` collection; a class asserted here would be this file deciding the one thing
      // the whole product exists to decide independently.
      provenance_class: null,
    };

    const batch = writeBatch(this.db);
    batch.set(capRef, capture);
    batch.set(fRef, field);
    // A counter, not a rewrite. increment() is a server-side operation, so two technicians
    // capturing at once both count rather than one overwriting the other.
    batch.update(jobRef, { field_count: increment(1) });
    await batch.commit();

    // Fire and forget. The technician's screen advances now and learns the verdict through
    // its snapshot listener; making a person wait on a model would defeat the entire seam.
    // A failure here is not fatal — the sweep finds whatever this call did not.
    void fetch("/api/adjudicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: input.jobId,
        step_id: input.stepId,
        field_key: input.fieldKey,
        capture_id: capRef.id,
      }),
    }).catch(() => {});

    return capture;
  }

  /**
   * Evidence into Cloud Storage, at the one path `storage.rules` allows, before anything
   * claims it exists. Returns the stored path, or null for a kind with no object.
   *
   * THE THROW IS DELIBERATE. Returning null on a failed upload would hand the caller a
   * capture document to write about bytes that are not there, which is the exact failure this
   * exists to end. `LiveSource.uploadMedia` on Android makes the same argument and made the
   * same correction; a capture that cannot be stored has not happened.
   */
  private async upload(
    tenantId: string, jobId: string, captureId: string, input: CaptureInput,
  ): Promise<string | null> {
    const ext = EXTENSION[input.kind];
    if (!ext) return null;
    if (!input.blob) {
      throw new Error(
        "That capture produced no image, so nothing was recorded. Take it again.",
      );
    }
    const path = mediaPath(tenantId, jobId, captureId, ext);
    try {
      await this.put(path, input.blob);
    } catch (error) {
      throw new Error(
        "The photograph could not be uploaded, so nothing was recorded. Check the " +
          `connection and take it again. (${String(error)})`,
      );
    }
    return path;
  }

  /** The second exit. A step is never silently abandoned — this always records an outcome. */
  async declareBlocked(input: BlockedInput): Promise<StepOutcome> {
    const [tenantId, jobId] = splitScoped(input.jobId);
    if (!tenantId) throw new Error(`job id is not tenant-scoped: ${input.jobId}`);

    const outcomeRef = doc(
      this.db, "tenants", tenantId, "jobs", jobId, "step_outcomes", input.stepId,
    );

    // The status is deliberately left alone. There is no `blocked` state — the contract
    // offers pending, performed, deferred, waived and impossible, and choosing between the
    // last three is the FOREMAN's disposition, made server-side against the reason the
    // technician just gave. Writing a disposition here would be this file deciding something
    // it has no standing to decide.
    const patch = {
      reason_kind: input.reasonKind,
      reason_transcript: input.transcript,
      reason_audio_ref: input.audioRef ?? null,
      reason_by: this.uid(),
      reason_at: now(),
      provenance_class: "asserted" as const,
    };

    await setDoc(outcomeRef, patch, { merge: true });

    const snap = await getDoc(outcomeRef);
    if (!snap.exists()) throw new Error(`no such step: ${input.stepId}`);
    return { ...(snap.data() as StepOutcome), fields: [] };
  }

  // ---------------------------------------------------------------- the late half

  /**
   * Real push, not a poll.
   *
   * Four listeners: the job header, its step outcomes, its fields, and the decision log. All
   * four are what the fixture timeline was imitating.
   *
   * ## What an agent asks for comes off the STEP OUTCOME
   *
   * `added_fields`, `escalation_question` and `hold_reason` are written by `applyEffect()` in
   * server/adjudicate/run.ts, and they are the only place an agent's ask exists. This used to
   * read none of them. It watched the `fields` collection instead and called every document
   * that appeared there an `add_field` — but `fields` holds CAPTURED ANSWERS, one per filled
   * field, written by `capture()` twenty lines up. So the browser had it exactly inverted:
   * every photograph the technician took came back labelled "the Inspector asked for this",
   * carrying `{key, kind}` and no prompt, while the field an agent had actually appended never
   * arrived at all. An escalation never arrived either — nothing read the question.
   *
   * The phone had this right the whole time (`LiveSource.kt`), which is why the failure was
   * invisible in a demo driven from a phone.
   *
   * ## Why both `added` and `modified`
   *
   * `added` fires for what is already there when the listener opens, which is the reload case:
   * a person who closes the tab and comes back must find the same question waiting. So both
   * kinds are read, and each ask is emitted exactly once per job — tracked in `seen` below,
   * because a snapshot repeats the whole document every time any part of it changes and a
   * screen that appended on every repeat would grow the same ask forever.
   */
  subscribe(jobId: string, onEvent: (e: JobEvent) => void): Unsubscribe {
    const [tenantId, id] = splitScoped(jobId);
    if (!tenantId) return () => {};

    const jobRef = doc(this.db, "tenants", tenantId, "jobs", id);
    let previous: JobHeader | null = null;

    const stopJob = onSnapshot(jobRef, (snap) => {
      if (!snap.exists()) return;
      const job = snap.data() as JobHeader;
      if (previous && previous.status !== job.status) {
        if (job.status === "held") onEvent({ kind: "held", reason: "The record does not hold up." });
        if (job.status === "sealed") onEvent({ kind: "sealed", recordId: jobId });
      }
      previous = job;
    });

    // Every ask already delivered, so a snapshot that repeats one does not deliver it twice.
    // Keyed by what makes an ask distinct: the step plus the field key, or the step plus the
    // question itself — a REWORDED escalation is a new question and must arrive as one.
    const seen = new Set<string>();
    const once = (key: string, emit: () => void) => {
      if (seen.has(key)) return;
      seen.add(key);
      emit();
    };

    const stopOutcomes = onSnapshot(collection(jobRef, "step_outcomes"), (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === "removed") continue;
        const outcome = change.doc.data() as StepOutcome;
        const stepId = outcome.step_id;

        // The status on `added` too, which is the reload: without it a job reopened in a new
        // tab knew nothing about which steps were done and presented finished work as untouched.
        onEvent({ kind: "step_status", stepId, status: outcome.status });

        // The form grows. This is the ask that says "one more photograph", and it carries the
        // whole FieldDef — prompt, kind, guidance, acceptance rule — because the screen has to
        // render the ask in the words the agent asked it in.
        for (const field of outcome.added_fields ?? []) {
          once(`add:${stepId}:${field.key}`, () => {
            onEvent({ kind: "add_field", stepId, field });
          });
        }

        // A question put to a person. The step stays pending and carries it — an escalation is
        // a decision awaited, not a status of its own — so nothing but this field says it
        // happened.
        const question = outcome.escalation_question?.trim();
        if (question) {
          once(`ask:${stepId}:${question}`, () => {
            onEvent({ kind: "escalated", stepId, question });
          });
        }
      }
    });

    // An answer landing, from any surface. The phone folds this into what it considers filled;
    // the browser uses it to know that a field it is looking at has been satisfied elsewhere.
    // NOT an add_field, which is what this listener used to report — see the note above.
    const stopFields = onSnapshot(collection(jobRef, "fields"), (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === "removed" || snap.metadata.hasPendingWrites) continue;
        const field = change.doc.data() as Field;
        onEvent({
          kind: "capture_accepted",
          stepId: field.step_id,
          fieldKey: field.key,
          // Never absent in practice — capture() stamps it — but the contract allows null,
          // and an event whose timestamp is `undefined` is worse than one that says now.
          at: field.captured_at ?? new Date().toISOString(),
        });
      }
    });

    const stopDecisions = onSnapshot(
      query(tenantCol(this.db, tenantId, "decisions"), where("job_id", "==", jobId)),
      (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type !== "added") continue;
          const decision = change.doc.data() as Decision;
          onEvent({ kind: "decision", stepId: decision.step_id ?? null, decision });
        }
      },
    );

    return () => {
      stopJob();
      stopOutcomes();
      stopFields();
      stopDecisions();
    };
  }
}

// ---------------------------------------------------------------- assembly

/** The job document as STORED: everything except the steps, which are subcollections. */
export type JobHeader = Omit<Job, "steps"> & {
  step_count?: number;
  performed_count?: number;
  field_count?: number;
};

/**
 * Put the aggregate back together.
 *
 * The contract's `Job` is the read model every screen already depends on, so it is assembled
 * here rather than pushed outwards as a breaking change. Storage moved; the interface did not.
 */
export function assemble(header: JobHeader, outcomes: StepOutcome[], fields: Field[]): Job {
  const byStep = new Map<string, Field[]>();
  for (const f of fields) {
    const list = byStep.get(f.step_id) ?? [];
    list.push(f);
    byStep.set(f.step_id, list);
  }

  return {
    ...header,
    steps: outcomes.map((o) => ({ ...o, fields: byStep.get(o.step_id) ?? [] })),
  } as Job;
}

// ---------------------------------------------------------------- ids
//
// A bare Firestore document id says nothing about which tenant it belongs to, and the
// DataSource interface passes ids around on their own (getJob, getRecord). Scoping the id
// keeps every lookup addressable without a second argument, and — since the tenant travels
// with the id — a mismatched tenant is rejected by the rules rather than silently read.

const SEP = "/";

export function scoped(tenantId: string, id: string): string {
  return id.includes(SEP) ? id : `${tenantId}${SEP}${id}`;
}

export function splitScoped(id: string): [string | null, string] {
  const cut = id.lastIndexOf(SEP);
  if (cut < 0) return [null, id];
  return [id.slice(0, cut), id.slice(cut + 1)];
}

// `deleteField` is re-exported for the seal path, which clears provisional values when it
// stamps the real ones.
export { deleteField };
