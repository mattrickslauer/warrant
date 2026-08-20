// FixtureSource — deterministic, offline, and DELIBERATELY SLOW IN THE RIGHT PLACES.
//
// It plays the timeline in fixtures/scripts.ts rather than returning settled answers, so a
// screen built against it has already had to cope with a verdict arriving late and with the
// form growing a field mid-job. That is the entire point of building the surfaces first.
import type {
  Procedure, Job, StepOutcome, Capture, Decision, SealedRecord, Field,
} from "@/generated/types";
import type { DataSource, JobEvent, CaptureInput, BlockedInput, Tier, Unsubscribe } from "./source";
import { procedures } from "./fixtures/procedures";
import { scripts } from "./fixtures/scripts";
import { sealJob, readyToSeal, machineReleased } from "./seal";

let seq = 0;
const id = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36).slice(-4)}`;
const now = () => new Date().toISOString();

export interface FixtureOptions {
  /** 1 is demo pace. Raise to slow the timeline down for filming; 0 makes it instant for tests. */
  speed?: number;
}

export class FixtureSource implements DataSource {
  readonly name = "fixture" as const;
  readonly fabricated = true;

  private jobs = new Map<string, Job>();
  private records = new Map<string, SealedRecord>();
  private decisions: Decision[] = [];
  private listeners = new Map<string, Set<(e: JobEvent) => void>>();
  private attempts = new Map<string, number>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private speed: number;

  constructor(opts: FixtureOptions = {}) {
    this.speed = opts.speed ?? 1;
  }

  /** Cancel every pending beat. Screens call this on unmount so a demo cannot leak timers. */
  dispose() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------- reads

  async listProcedures(tenantId: string) {
    return procedures.filter((p) => p.tenant_id === tenantId || tenantId === "*");
  }
  async getProcedure(pid: string) {
    return procedures.find((p) => p.id === pid) ?? null;
  }
  async getJob(jid: string) {
    return this.jobs.get(jid) ?? null;
  }
  async listJobs(tenantId: string) {
    return [...this.jobs.values()].filter((j) => j.tenant_id === tenantId);
  }
  async getRecord(rid: string) {
    return this.records.get(rid) ?? null;
  }
  async listDecisions() {
    return [...this.decisions].sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  // ---------------------------------------------------------------- writes

  async startJob({ procedureId, tenantId, tier }: { procedureId: string; tenantId: string; tier: Tier }) {
    const proc = await this.getProcedure(procedureId);
    if (!proc) throw new Error(`no such procedure: ${procedureId}`);
    const jid = id("job");
    const job: Job = {
      id: jid,
      tenant_id: tenantId,
      procedure_id: proc.id,
      procedure_version: proc.version,
      asset_urn: null,
      technician_id: null,
      status: "draft",
      strictness: proc.strictness,
      tier,
      started_at: now(),
      sealed_at: null,
      steps: proc.steps.map<StepOutcome>((s) => ({
        id: id("out"), job_id: jid, step_id: s.id, status: "pending", fields: [],
      })),
    };
    this.jobs.set(jid, job);
    return job;
  }

  /**
   * The human act that lets the fleet see this job.
   *
   * Present here and not only on LiveSource on purpose: the seam is worth having only while a
   * screen cannot tell the two apart, so a draft gate in one implementation and not the other
   * would be exactly the divergence this interface exists to prevent.
   */
  async finalize(jobId: string, by: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`no such job: ${jobId}`);
    if (job.status !== "draft") return;
    job.status = "open";
    job.finalized_at = now();
    job.finalized_by = by;
  }

  /** Returns immediately. The verdict arrives later, over subscribe(). */
  async capture(input: CaptureInput): Promise<Capture> {
    const job = this.jobs.get(input.jobId);
    if (!job) throw new Error(`no such job: ${input.jobId}`);
    const cap: Capture = {
      id: id("cap"),
      field_id: `${input.stepId}:${input.fieldKey}`,
      kind: input.kind,
      media_ref: input.mediaRef,
      capture_mode: input.mode,
      capture_surface: input.surface,
      attestation_device_id: input.surface === "browser" ? null : "fixture-device",
      attestation_play_integrity: null,
      redacted: true,
      armor_verdict: "NO_MATCH_FOUND",
      created_at: now(),
    };

    const outcome = job.steps.find((s) => s.step_id === input.stepId);
    if (outcome) {
      const f: Field = {
        id: id("fld"), step_id: input.stepId, key: input.fieldKey,
        kind: input.kind === "audio" ? "text" : input.kind,
        media_ref: cap.id, captured_at: cap.created_at,
        // The class is stamped by the Seal, never here, and never by a model.
        provenance_class: input.surface === "app_instrument" ? "measured" : "inferred",
      };
      outcome.fields.push(f);
    }

    this.emit(job.id, { kind: "capture_accepted", stepId: input.stepId, fieldKey: input.fieldKey, at: cap.created_at });
    this.play(job, input.stepId);
    return cap;
  }

  /** The second exit. There is no skip — this always produces a recorded outcome. */
  async declareBlocked(input: BlockedInput): Promise<StepOutcome> {
    const job = this.jobs.get(input.jobId);
    if (!job) throw new Error(`no such job: ${input.jobId}`);
    const outcome = job.steps.find((s) => s.step_id === input.stepId);
    if (!outcome) throw new Error(`no such step: ${input.stepId}`);

    outcome.reason_kind = input.reasonKind;
    outcome.reason_transcript = input.transcript;
    outcome.reason_audio_ref = input.audioRef ?? null;
    outcome.reason_by = input.by;
    outcome.reason_at = now();
    outcome.provenance_class = "asserted";

    // Instructor reads the intent and recommends; Foreman disposes. Both are model calls,
    // so both land on the record and both cost money.
    this.after(700, () => {
      outcome.recommendation_text =
        "Nothing here can substitute for it. Record it as deferred and come back once the blocker clears.";
      outcome.recommendation_model = "gemini-3.5-flash";
      this.decide(job, input.stepId, "instructor", "DEFERRED_PROPOSED",
        `Reason read as a blocker, not a refusal: "${input.transcript.slice(0, 80)}"`, "gemini-3.5-flash", 0.00047);
    });
    this.after(1900, () => {
      outcome.status = "deferred";
      outcome.disposition_action = "chase";
      outcome.disposition_at = now();
      this.decide(job, input.stepId, "foreman", "DEFER",
        "Job stays open and the machine stays held. I will check back rather than closing this quietly.", "gemini-3.5-flash", 0.00062);
      this.emit(job.id, { kind: "step_status", stepId: input.stepId, status: "deferred" });
      this.maybeSeal(job);
    });

    return outcome;
  }

  subscribe(jobId: string, cb: (e: JobEvent) => void): Unsubscribe {
    if (!this.listeners.has(jobId)) this.listeners.set(jobId, new Set());
    this.listeners.get(jobId)!.add(cb);
    return () => this.listeners.get(jobId)?.delete(cb);
  }

  // ---------------------------------------------------------------- timeline

  private emit(jobId: string, e: JobEvent) {
    this.listeners.get(jobId)?.forEach((cb) => cb(e));
  }
  private after(ms: number, fn: () => void) {
    if (this.speed === 0) return fn();
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms * this.speed);
    this.timers.add(t);
  }
  private decide(job: Job, stepId: string | null, agent: string, verdict: string, rationale: string, model: string | null, cost: number) {
    const d: Decision = {
      id: id("dec"), job_id: job.id, step_id: stepId,
      agent: agent as Decision["agent"], agent_version: `${agent}@1.4.0`,
      model, verdict, rationale, cost_usd: cost, at: now(),
    };
    this.decisions.push(d);
    this.emit(job.id, { kind: "decision", stepId, decision: d });
  }

  private play(job: Job, stepId: string) {
    const script = scripts[job.procedure_id]?.[stepId];
    if (!script) return;
    const key = `${job.id}:${stepId}`;
    const attempt = this.attempts.get(key) ?? 0;
    this.attempts.set(key, attempt + 1);
    const beats = script[Math.min(attempt, script.length - 1)];

    for (const beat of beats) {
      this.after(beat.at, () => {
        if (beat.kind === "decision") {
          this.decide(job, stepId, beat.agent, beat.verdict, beat.rationale, beat.model ?? null, beat.cost ?? 0);
        } else if (beat.kind === "add_field") {
          this.emit(job.id, { kind: "add_field", stepId, field: beat.field });
        } else if (beat.kind === "escalate") {
          this.emit(job.id, { kind: "escalated", stepId, question: beat.question });
        } else {
          const o = job.steps.find((s) => s.step_id === stepId);
          if (o) o.status = beat.status;
          this.emit(job.id, { kind: "step_status", stepId, status: beat.status });
          this.maybeSeal(job);
        }
      });
    }
  }

  private maybeSeal(job: Job) {
    if (job.status === "sealed" || !readyToSeal(job)) return;
    job.status = "sealed";
    job.sealed_at = now();
    const rec = sealJob(job, this.decisions.filter((d) => d.job_id === job.id), { public: job.tenant_id === "anon" });
    this.records.set(rec.id, rec);
    if (!machineReleased(job)) this.emit(job.id, { kind: "held", reason: "a step was explained rather than performed" });
    this.emit(job.id, { kind: "sealed", recordId: rec.id });
  }
}
