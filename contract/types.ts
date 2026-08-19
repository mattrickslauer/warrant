// GENERATED from contract/*.schema.json — do not edit.
// Run: node contract/build-types.mjs

// ---- entities ----
/** A piece of media. capture_surface is what decides the tier ceiling, so it is recorded here and nowhere else. */
export interface Capture {
  id: string;
  field_id: string;
  kind: "photo" | "video" | "audio" | "scan";
  media_ref: string;
  /** live means the frame was grabbed from an active camera stream on this device. An uploaded file says nothing about when or where it was made, so it can never support a stronger class than a claim. */
  capture_mode: "live" | "upload";
  /** browser cannot reach the measured class: no pairing, no attestation, and its sensors are supplied by the person being verified. */
  capture_surface: "browser" | "app" | "app_instrument";
  /** Null on browser. */
  attestation_device_id?: string | null;
  /** Null on browser. */
  attestation_play_integrity?: string | null;
  /** On-device ML Kit face and plate redaction has run. A record is not readable until this is true. */
  redacted: boolean;
  /** Model Armor pi_and_jailbreak on the image. */
  armor_verdict?: "NO_MATCH_FOUND" | "MATCH_FOUND" | null;
  created_at: string;
}

/** One agent doing one thing. This is the row AgentTrace renders and the line the public decision log carries. */
export interface Decision {
  id: string;
  job_id: string;
  step_id?: string | null;
  agent: "scoper" | "foreman" | "inspector" | "skeptic" | "auditor" | "instructor" | "wright";
  /** From Agent Registry. The sealed record stamps WHICH agent version decided. */
  agent_version: string;
  /** Null for deterministic core decisions. */
  model?: string | null;
  verdict: string;
  rationale: string;
  /** Estimated from token counts. The Ledger meters against a hard ceiling. */
  cost_usd?: number | null;
  at: string;
}

/** What a procedure DECLARES a step must produce. The filled version is Field. */
export interface FieldDef {
  /** Stable within the step. e.g. pad_torque. */
  key: string;
  /** The discriminator. Decides which value slot on Field is meaningful. */
  kind: "measurement" | "photo" | "video" | "scan" | "choice" | "text" | "signature" | "location";
  /** What to do. Shown as the instruction. */
  prompt: string;
  /** instrument is the only source that can yield the measured class. */
  source: "instrument" | "camera" | "human";
  /** 0 log, 1 standard, 2 assured, 3 regulated. The field is required at or above this. */
  required_at_strictness: number;
  /** Only meaningful when kind is choice. */
  choices?: string[];
  /** Decides the provenance class. within/matches/per_spec resolve without a model. */
  acceptance_rule: "within" | "matches" | "must_show" | "consistent_with" | "per_spec" | "signed_by";
  acceptance_min?: number | null;
  acceptance_max?: number | null;
  acceptance_unit?: string | null;
  /** For matches/consistent_with/signed_by: what it resolves against. */
  acceptance_target?: string | null;
  /** For must_show: what the media has to show. */
  acceptance_description?: string | null;
  /** What good looks like, in plain language. Shown to the human BEFORE the capture — the same rule the Inspector applies after it. */
  guidance: string;
}

/** A FieldDef once it has been filled. Flat with a discriminator: kind decides which value slot is meaningful, the rest are null. */
export interface Field {
  id: string;
  step_id: string;
  key: string;
  kind: "measurement" | "photo" | "video" | "scan" | "choice" | "text" | "signature" | "location";
  /** measurement only. */
  value_number?: number | null;
  /** text, scan, signature. */
  value_text?: string | null;
  /** choice only. */
  value_choice?: string | null;
  /** measurement only. */
  unit?: string | null;
  /** photo, video. A Capture id. */
  media_ref?: string | null;
  /** Set only when the value arrived from a paired instrument. Its presence is what makes the class measured. */
  tool_id?: string | null;
  captured_at?: string | null;
  /** Stamped by the Seal from the acceptance rule and the capture surface. Never asserted by a model. Null until sealed. */
  provenance_class?: "measured" | "specified" | "inferred" | "asserted" | null;
  /** Which resolution step supplied the bound. See data-model.md section 5. */
  resolved_from_order?: "override_instance" | "override_type" | "spec" | "asked" | null;
  /** doc/section/page when the order is spec. */
  resolved_from_cite?: string | null;
  /** Evidence attaches to the component, not the position, so it survives the part moving machines. */
  component_ref?: string | null;
}

/** One run of one procedure version against one asset. */
export interface Job {
  id: string;
  tenant_id: string;
  procedure_id: string;
  /** The version that ran, not the current one. */
  procedure_version: number;
  asset_urn?: string | null;
  technician_id?: string | null;
  status: "open" | "waiting" | "held" | "sealed";
  strictness: number;
  /** What the surface performing this job can actually supply. */
  tier: "open" | "attested" | "instrumented";
  started_at: string;
  sealed_at?: string | null;
  steps: StepOutcome[];
}

/** Compiled from a Scoper conversation. Versioned; a sealed record names the version it ran. */
export interface Procedure {
  id: string;
  tenant_id: string;
  /** Stable across versions. e.g. front-brake-service. */
  key: string;
  title: string;
  version: number;
  /** 0 log, 1 standard, 2 assured, 3 regulated. */
  strictness: number;
  /** Derived from the fields. A surface below this is refused before the job starts, never downgraded. */
  minimum_tier: "open" | "attested" | "instrumented";
  disqualifiers?: string[];
  releases?: string[];
  steps: Step[];
  created_at: string;
}

/** A number from a paired instrument. Never embedded, never consolidated, never in Memory Bank — these are queried exactly and ordered by time, and they are what makes wear rate computable. */
export interface Reading {
  id: string;
  field_id?: string | null;
  component_id?: string | null;
  key: string;
  value: number;
  unit: string;
  /** Device identity. Without this the value is typed, not measured. */
  tool_id: string;
  at: string;
}

/** Written once by the Seal, never updated. This is what /r/<id> renders and what a stranger checks. */
export interface SealedRecord {
  /** Opaque and unguessable. It is a public URL. */
  id: string;
  job_id: string;
  tenant_id: string;
  /** True only for anon and demo tenants. Real tenant records are private with an explicit share action. */
  public: boolean;
  sealed_at: string;
  ceiling_tier: "open" | "attested" | "instrumented";
  ceiling_reachable: ("measured" | "specified" | "inferred" | "asserted")[];
  /** Each with the one-line reason it is out of reach at this tier. This is the call to action, and it is honest. */
  ceiling_unreachable: ({
    class: "measured" | "specified" | "inferred" | "asserted";
    reason: string;
  })[];
  /** What the Gate reads. A deficiency against a field required at this strictness holds the machine. */
  deficiencies: ({
    step_id: string;
    status: "deferred" | "waived" | "impossible";
    reason: string;
  })[];
  /** The Gate's answer. Deterministic, from deficiencies and strictness. */
  machine_released: boolean;
  steps: StepOutcome[];
  decisions: Decision[];
}

/** One per step, ALWAYS written, never absent. A step can be satisfied or explained; it can never be silently abandoned. */
export interface StepOutcome {
  id: string;
  job_id: string;
  step_id: string;
  /** There is no skip. deferred keeps the job open and the machine held; waived seals with a signed waiver and releases; impossible seals deficient and files a procedure defect. */
  status: "pending" | "performed" | "deferred" | "waived" | "impossible";
  reason_kind?: "voice" | "text" | null;
  /** What the technician said, in their words. */
  reason_transcript?: string | null;
  reason_audio_ref?: string | null;
  /** Named human, or the warrant_uid on the open tier. */
  reason_by?: string | null;
  reason_at?: string | null;
  /** The Instructor's next action for the person standing there now. */
  recommendation_text?: string | null;
  recommendation_model?: string | null;
  /** The Foreman's call on what happens to the job, the machine, the booking and the parts order. */
  disposition_action?: "chase" | "reorder" | "escalate" | "revise" | null;
  disposition_at?: string | null;
  /** Required when status is waived. A named person with the standing to waive. */
  waived_by?: string | null;
  /** A stated reason is always asserted — a named human said it, at this time. */
  provenance_class?: "asserted" | null;
  fields: Field[];
}

/** One card in a procedure. Always has two exits: capture, or state why not. */
export interface Step {
  id: string;
  index: number;
  title: string;
  /** Show only if. Null means always. */
  condition?: string | null;
  /** WHY this step exists and what goes wrong without it. Authored by the Scoper during the interview. */
  explanation: string;
  /** Hard cap on Inspector ADD FIELD. On exhaustion the step escalates with the unresolved question. */
  max_add_fields: number;
  fields: FieldDef[];
}

/** A Workspace domain is an enterprise; a consumer account is a tenant of one; an anonymous visitor is a tenant of one that has not been claimed. */
export interface Tenant {
  /** Workspace domain, or u:<sub>, or anon:<warrant_uid>. */
  id: string;
  kind: "workspace" | "solo" | "anon";
  /** Google Sign-In hd claim. Null unless kind is workspace. */
  hd?: string | null;
  /** Sovereignty. Evidence and memory never leave it. */
  region: "us" | "eu";
  /** ISO 8601 UTC. Null while anonymous. */
  claimed_at?: string | null;
}

// ---- agent contracts: what a model is forced to return ----
/** You own this job for its whole life. A step cannot be performed. Decide what now happens to the job, the machine, the customer booking and the parts order. You may be woken days from now, so anything you need later must be written down here. */
export interface ForemanDisposition {
  /** deferred keeps the job open and the machine held. waived requires a named person with standing and releases the machine. impossible seals deficient and files a procedure defect. */
  status: "deferred" | "waived" | "impossible";
  action: "chase" | "reorder" | "escalate" | "revise";
  /** Why this disposition and not the others. This is read by a person in a dispute months later. */
  rationale: string;
  /** ISO 8601 UTC. When to wake and check. Required when action is chase. */
  chase_after?: string | null;
  /** Required when action is reorder. A purchase order is DRAFTED, never sent. */
  reorder_part?: string | null;
  /** Required when action is escalate. The role that must decide, not a person's name. */
  escalate_to_role?: string | null;
  /** Your recommendation. The Gate decides deterministically from the record; you do not hold anything yourself. */
  hold_machine: boolean;
}

/** Return exactly one verdict for the evidence supplied against this step. PASS only if the acceptance rule is satisfied by what you can actually see. ADD_FIELD when the evidence is insufficient but recoverable. ESCALATE when a person must decide. */
export interface InspectorVerdict {
  verdict: "PASS" | "ADD_FIELD" | "ESCALATE";
  /** 0 to 1. Below the strictness threshold you must not return PASS. */
  confidence: number;
  /** One or two sentences citing what in the evidence decided it. Never restate the prompt. */
  rationale: string;
  /** Required when verdict is ADD_FIELD. A new key, not an existing one. */
  add_field_key?: string | null;
  add_field_kind?: "measurement" | "photo" | "video" | "scan" | "choice" | "text" | "signature" | "location" | null;
  /** The specific next ask, e.g. 'the label is out of focus, photograph it again'. Never a generic retry. */
  add_field_prompt?: string | null;
  /** Required when verdict is ESCALATE. The exact unresolved question for the person, not a summary. */
  escalation_question?: string | null;
}

/** A technician has said they cannot complete this step. Turn what they said into a structured reason and recommend the next action for the person standing there right now, knowing the procedure, the machine and its history. */
export interface InstructorRecommendation {
  /** Their reason in one clause, in their terms. Do not sanitise it. */
  reason_summary: string;
  blocker_kind: "part_missing" | "tool_missing" | "access" | "seized_or_damaged" | "unsafe" | "machine_absent" | "procedure_wrong" | "other";
  /** What to do next. Concrete and doable now, or explicitly 'stop and hand off'. */
  recommended_action: string;
  /** A proposal only. The Foreman disposes and a waiver needs a named person with standing. There is no skip. */
  proposed_status: "deferred" | "waived" | "impossible";
  /** Part number or description when blocker_kind is part_missing. */
  blocking_part?: string | null;
  /** True if continuing would put someone at risk. Overrides everything else. */
  safety_flag: boolean;
}

/** You have not seen the Inspector's conclusion and must not guess it. Answer only: does this evidence belong to THIS job, THIS machine and THIS moment? Doubt is your job. If you cannot establish identity, dissent. */
export interface SkepticVerdict {
  /** False dissents. Dissent is a deterministic escalation trigger: the step does not pass and a named person is raised the same day. */
  belongs: boolean;
  /** 0 to 1. */
  confidence: number;
  /** What in the image, the asset history or the embedding distance decided it. */
  rationale: string;
  /** reuse means this evidence appears to have been submitted before. */
  mismatch_kind?: "asset" | "time" | "reuse" | "scene" | "none" | null;
  /** When mismatch_kind is reuse, the earlier capture this resembles. */
  prior_capture_ref?: string | null;
}
