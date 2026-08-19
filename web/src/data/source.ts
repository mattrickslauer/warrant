// The seam. Every surface — web and, by the same shape, Kotlin — reads and writes through
// this and nothing else. Two implementations exist: FixtureSource and (later) LiveSource.
// Screens depend on this interface only, so phase 3 swaps a binding, never a screen.
import type {
  Procedure, Job, StepOutcome, Capture, Decision, SealedRecord, FieldDef,
} from "@/generated/types";

export type Tier = "open" | "attested" | "instrumented";

/**
 * What arrives AFTER the technician has moved on.
 *
 * This is the whole reason the seam exists. Verification is asynchronous: the capture is
 * accepted immediately, the screen advances, and a verdict lands seconds or days later —
 * sometimes growing a field that was not in the procedure when the job started. A data
 * layer that returns settled answers lets you build screens in a world where none of that
 * happens, and every one of them breaks the day the real backend is connected.
 */
export type JobEvent =
  | { kind: "capture_accepted"; stepId: string; fieldKey: string; at: string }
  | { kind: "decision"; stepId: string | null; decision: Decision }
  | { kind: "add_field"; stepId: string; field: FieldDef }
  | { kind: "step_status"; stepId: string; status: StepOutcome["status"] }
  | { kind: "escalated"; stepId: string; question: string }
  | { kind: "held"; reason: string }
  | { kind: "sealed"; recordId: string };

export type Unsubscribe = () => void;

export interface CaptureInput {
  jobId: string;
  stepId: string;
  fieldKey: string;
  kind: Capture["kind"];
  /** Object URL, data URL, or a storage ref once live. Never the bytes themselves. */
  mediaRef: string;
  surface: Capture["capture_surface"];
  /** live = grabbed from an open camera stream here and now. Uploads cannot show liveness. */
  mode: Capture["capture_mode"];
}

export interface BlockedInput {
  jobId: string;
  stepId: string;
  reasonKind: "voice" | "text";
  transcript: string;
  audioRef?: string | null;
  by: string;
}

export interface DataSource {
  readonly name: "fixture" | "live";
  /** True when the surface is serving fabricated data. Screens MUST show this. */
  readonly fabricated: boolean;

  listProcedures(tenantId: string): Promise<Procedure[]>;
  getProcedure(id: string): Promise<Procedure | null>;

  startJob(input: { procedureId: string; tenantId: string; tier: Tier }): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  listJobs(tenantId: string): Promise<Job[]>;

  capture(input: CaptureInput): Promise<Capture>;
  /** The second exit. A step is never silently abandoned. */
  declareBlocked(input: BlockedInput): Promise<StepOutcome>;

  getRecord(id: string): Promise<SealedRecord | null>;
  listDecisions(tenantId: string): Promise<Decision[]>;

  subscribe(jobId: string, onEvent: (e: JobEvent) => void): Unsubscribe;
}

/** What a procedure needs from a surface, and what a surface can actually supply. */
export const TIER_RANK: Record<Tier, number> = { open: 0, attested: 1, instrumented: 2 };

export const CLASS_BY_TIER: Record<Tier, Array<"measured" | "specified" | "inferred" | "asserted">> = {
  open: ["inferred", "asserted"],
  attested: ["specified", "inferred", "asserted"],
  instrumented: ["measured", "specified", "inferred", "asserted"],
};

export const UNREACHABLE_REASON: Record<string, string> = {
  measured: "requires a paired instrument",
  specified: "requires a catalogued machine with a published figure",
};

/** A procedure demanding a class the surface cannot reach is refused, never downgraded. */
export function surfaceCanRun(procedure: Procedure, tier: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[procedure.minimum_tier as Tier];
}
