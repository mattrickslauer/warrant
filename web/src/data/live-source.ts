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

import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, setDoc, where, type Firestore,
} from "firebase/firestore";
import type {
  Procedure, Job, StepOutcome, Capture, Decision, SealedRecord, Field,
} from "@/generated/types";
import type { DataSource, JobEvent, CaptureInput, BlockedInput, Tier, Unsubscribe } from "./source";
import { clientDb } from "@/auth/firebase-client";

const now = () => new Date().toISOString();

/** `/tenants/{t}/…` — the one path shape docs/data-model.md §4 defines. */
const tenantCol = (db: Firestore, tenantId: string, name: string) =>
  collection(db, "tenants", tenantId, name);

export class LiveSource implements DataSource {
  readonly name = "live" as const;
  readonly fabricated = false;

  private db: Firestore;

  constructor(db?: Firestore) {
    this.db = db ?? clientDb();
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

  async getJob(id: string): Promise<Job | null> {
    const [tenantId, jobId] = splitScoped(id);
    if (!tenantId) return null;
    const snap = await getDoc(doc(this.db, "tenants", tenantId, "jobs", jobId));
    return snap.exists() ? (snap.data() as Job) : null;
  }

  async listJobs(tenantId: string): Promise<Job[]> {
    const snap = await getDocs(
      query(tenantCol(this.db, tenantId, "jobs"), orderBy("started_at", "desc")),
    );
    return snap.docs.map((d) => d.data() as Job);
  }

  async getRecord(id: string): Promise<SealedRecord | null> {
    const [tenantId, recordId] = splitScoped(id);
    if (!tenantId) return null;
    const snap = await getDoc(doc(this.db, "tenants", tenantId, "records", recordId));
    return snap.exists() ? (snap.data() as SealedRecord) : null;
  }

  async listDecisions(tenantId: string): Promise<Decision[]> {
    const snap = await getDocs(
      query(tenantCol(this.db, tenantId, "decisions"), orderBy("at", "desc")),
    );
    return snap.docs.map((d) => d.data() as Decision);
  }

  // ---------------------------------------------------------------- writes

  async startJob({
    procedureId, tenantId, tier,
  }: { procedureId: string; tenantId: string; tier: Tier }): Promise<Job> {
    const procedure = await this.getProcedure(scoped(tenantId, procedureId));
    if (!procedure) throw new Error(`no such procedure: ${procedureId}`);

    const ref = doc(tenantCol(this.db, tenantId, "jobs"));
    const job: Job = {
      id: scoped(tenantId, ref.id),
      tenant_id: tenantId,
      procedure_id: procedure.id,
      procedure_version: procedure.version,
      asset_urn: null,
      technician_id: null,
      status: "open",
      strictness: procedure.strictness,
      tier,
      started_at: now(),
      sealed_at: null,
      steps: procedure.steps.map<StepOutcome>((s, i) => ({
        id: `${ref.id}:${i}`, job_id: scoped(tenantId, ref.id), step_id: s.id,
        status: "pending", fields: [],
      })),
    };

    await setDoc(ref, { ...job, created_at: serverTimestamp() });
    return job;
  }

  /**
   * Returns as soon as the evidence is durable. Nothing waits on a verdict.
   *
   * Capture never blocks — a technician with dirty hands does not stand in a workshop
   * watching a spinner. The write lands, the screen advances, and whatever the Inspector
   * concludes arrives later through subscribe().
   */
  async capture(input: CaptureInput): Promise<Capture> {
    const [tenantId, jobId] = splitScoped(input.jobId);
    if (!tenantId) throw new Error(`job id is not tenant-scoped: ${input.jobId}`);

    const jobRef = doc(this.db, "tenants", tenantId, "jobs", jobId);
    const capRef = doc(collection(jobRef, "captures"));

    const capture: Capture = {
      id: capRef.id,
      field_id: `${input.stepId}:${input.fieldKey}`,
      kind: input.kind,
      media_ref: input.mediaRef,
      capture_mode: input.mode,
      capture_surface: input.surface,
      attestation_device_id: null,
      attestation_play_integrity: null,
      redacted: false,
      armor_verdict: null,
      created_at: now(),
    };

    // The capture and the field it produces land together or not at all. A field pointing at
    // a capture that failed to write would be a record claiming evidence it does not have.
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(jobRef);
      if (!snap.exists()) throw new Error(`no such job: ${input.jobId}`);
      const job = snap.data() as Job;

      const field: Field = {
        id: `${input.stepId}:${input.fieldKey}:${capRef.id}`,
        step_id: input.stepId,
        key: input.fieldKey,
        kind: input.kind === "audio" ? "text" : input.kind,
        media_ref: capRef.id,
        captured_at: capture.created_at,
        // Provisional and inferred by definition. The Seal stamps the real class, and only
        // an instrument reading through a paired tool ever earns `measured`.
        provenance_class: input.surface === "app_instrument" ? "measured" : "inferred",
      };

      const steps = job.steps.map((s) =>
        s.step_id === input.stepId ? { ...s, fields: [...s.fields, field] } : s,
      );

      tx.set(capRef, capture);
      tx.update(jobRef, { steps });
    });

    return capture;
  }

  /** The second exit. A step is never silently abandoned — this always records an outcome. */
  async declareBlocked(input: BlockedInput): Promise<StepOutcome> {
    const [tenantId, jobId] = splitScoped(input.jobId);
    if (!tenantId) throw new Error(`job id is not tenant-scoped: ${input.jobId}`);

    const jobRef = doc(this.db, "tenants", tenantId, "jobs", jobId);
    let result: StepOutcome | null = null;

    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(jobRef);
      if (!snap.exists()) throw new Error(`no such job: ${input.jobId}`);
      const job = snap.data() as Job;

      const steps = job.steps.map((s) => {
        if (s.step_id !== input.stepId) return s;
        // The status is deliberately left alone. There is no `blocked` state — the contract
        // offers pending, performed, deferred, waived and impossible, and choosing between
        // the last three is the FOREMAN's disposition, made server-side against the reason
        // the technician just gave. Writing a disposition here would be this file deciding
        // something it has no standing to decide.
        const updated: StepOutcome = {
          ...s,
          reason_kind: input.reasonKind,
          reason_transcript: input.transcript,
          reason_audio_ref: input.audioRef ?? null,
          reason_by: input.by,
          reason_at: now(),
          provenance_class: "asserted",
        };
        result = updated;
        return updated;
      });

      tx.update(jobRef, { steps });
    });

    if (!result) throw new Error(`no such step: ${input.stepId}`);
    return result;
  }

  // ---------------------------------------------------------------- the late half

  /**
   * Real push, not a poll.
   *
   * Two listeners: the job document, which carries step status and the fields the Inspector
   * may have ADDED mid-job, and the decision log for this job, which is where every agent's
   * reasoning and cost surfaces. Both are what the fixture timeline was imitating.
   */
  subscribe(jobId: string, onEvent: (e: JobEvent) => void): Unsubscribe {
    const [tenantId, id] = splitScoped(jobId);
    if (!tenantId) return () => {};

    const jobRef = doc(this.db, "tenants", tenantId, "jobs", id);
    let previous: Job | null = null;

    const stopJob = onSnapshot(jobRef, (snap) => {
      if (!snap.exists()) return;
      const job = snap.data() as Job;

      for (const step of job.steps) {
        const before = previous?.steps.find((s) => s.step_id === step.step_id);
        if (!before) continue;

        if (before.status !== step.status) {
          onEvent({ kind: "step_status", stepId: step.step_id, status: step.status });
        }
        // A field that exists now and did not before is an ADD FIELD — the Inspector asking
        // for more rather than refusing. See docs/architecture.md §3.
        for (const field of step.fields) {
          if (!before.fields.some((f) => f.id === field.id)) {
            onEvent({
              kind: "add_field",
              stepId: step.step_id,
              field: { key: field.key, kind: field.kind } as never,
            });
          }
        }
      }

      if (previous && previous.status !== job.status) {
        if (job.status === "held") onEvent({ kind: "held", reason: "The record does not hold up." });
        if (job.status === "sealed") onEvent({ kind: "sealed", recordId: jobId });
      }

      previous = job;
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
      stopDecisions();
    };
  }
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
