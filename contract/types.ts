// GENERATED from contract/*.schema.json — do not edit.
// Run: node contract/build-types.mjs

// ---- entities ----
/** A piece of evidence. Usually media; `text` is the exception, and it carries the answer itself rather than a pointer to one. capture_surface is what decides the tier ceiling, so it is recorded here and nowhere else. */
export interface Capture {
  id: string;
  field_id: string;
  /** text is an answer a person typed or chose. It has no object, and every surface that reaches for media must skip it — a URI built for a text capture points at a file nobody uploaded. */
  kind: "photo" | "video" | "audio" | "scan" | "text";
  /** Where the evidence is. A storage path for media; for kind text, the answer itself, because there is nowhere else in this shape to put it and a text capture pointing at an object would be a lie about a file. */
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
  /** Model Armor pi_and_jailbreak on the image. NOT_SCREENED when the screen could not be run — an admitted gap, never NO_MATCH_FOUND, because a false clean is worse than a stated one. */
  armor_verdict?: "NO_MATCH_FOUND" | "MATCH_FOUND" | "NOT_SCREENED" | null;
  /** Whether the fleet has ruled on this capture. False, never absent: Firestore cannot query for a missing field, so a capture written without it is invisible to the sweep that exists to catch what a dying client left behind. */
  adjudicated?: boolean;
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

/** One run of one procedure version against one asset. This is the ASSEMBLED read model the DataSource seam returns; storage is decomposed into step_outcomes/ and fields/ subcollections so a capture writes O(1) documents instead of rewriting the whole aggregate. See specs/2026-08-20-firestore-design.md section 7.0. */
export interface Job {
  /** 1. Absent reads as 1. Sealed evidence is upgraded on read, never migrated in place — see specs/2026-08-20-firestore-design.md section 9.1. */
  schema_version?: number;
  id: string;
  tenant_id: string;
  procedure_id: string;
  /** The version that ran, not the current one. */
  procedure_version: number;
  asset_urn?: string | null;
  technician_id?: string | null;
  /** draft is held back from the fleet: NO agent runs on a draft job. finalize() flips draft to open, and that is the human act. */
  status: "draft" | "open" | "waiting" | "held" | "sealed";
  strictness: number;
  /** What the surface performing this job can actually supply. */
  tier: "open" | "attested" | "instrumented";
  started_at: string;
  sealed_at?: string | null;
  steps: StepOutcome[];
  finalized_at?: string | null;
  /** Who said go. The draft gate is a named act, not a timeout. */
  finalized_by?: string | null;
  /** Denormalised so a list view needs one read per job and no subcollection fan-out. */
  step_count?: number;
  performed_count?: number;
  field_count?: number;
}

/** A person inside a tenant. Server-written: role and standing decide who may waive a step, so a client that could write this could grant itself the standing. Membership needs no invite flow — the first person from a Workspace domain creates the tenant and everyone after joins by being from that domain. */
export interface Member {
  /** 1. Absent reads as 1. See specs/2026-08-20-firestore-design.md section 9.1. */
  schema_version?: number;
  /** Firebase uid. Equal to the token sub. */
  uid: string;
  tenant_id: string;
  email?: string | null;
  email_verified: boolean;
  display_name?: string | null;
  /** Google's own URL. Rotates when the user changes their photo and can 404, so it is never the only copy. */
  photo_url?: string | null;
  /** Our copy in Cloud Storage, taken at first sign-in. This is what a sealed record points at, because a record must still render years later. */
  photo_ref?: string | null;
  photo_fetched_at?: string | null;
  /** The first member of a tenant is owner. Everyone after is technician. Promotion is an owner-only server action. */
  role: "owner" | "foreman" | "technician" | "viewer";
  /** What this person may do that a technician may not. StepOutcome.waived_by requires a named person with standing, and standing a person can grant themselves is not standing. */
  standing: {
    may_waive_to_strictness: number;
    may_approve_orders: boolean;
    may_publish_procedures: boolean;
  };
  joined_at: string;
  last_seen_at: string;
  /** When an employer disables an account, access ends the same instant — session verification re-checks revocation on every request. */
  disabled: boolean;
  /** That the account is linked. NEVER the refresh token, which lives in /user_secrets and is unreachable by any client. */
  calendar?: {
    linked: boolean;
    linked_at?: string | null;
    calendar_id: string;
  } | null;
}

/** Compiled from a Scoper conversation. Versioned; a sealed record names the version it ran. */
export interface Procedure {
  /** 1. Absent reads as 1. Sealed evidence is upgraded on read, never migrated in place — see specs/2026-08-20-firestore-design.md section 9.1. */
  schema_version?: number;
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
  /** A procedure mid-Scoper-interview is drafting. Compiling publishes v1. */
  status?: "drafting" | "published" | "archived";
  /** A job pins the frozen version it started under, so publishing v3 mid-job cannot change what a v2 job is running. */
  current_version?: number;
  published_at?: string | null;
  published_by?: string | null;
  updated_at?: string | null;
  origin?: "scoper" | "imported" | "forked" | null;
  /** For catalogue imports. See docs/data-model.md section 8. */
  source_doc_ref?: string | null;
  /** Where the world-readable copy of this procedure lives, at /public_procedures/{public_id}, or null when it is private. A POINTER, never a permission: the tenant subtree is unreachable to outsiders whatever this says, so what makes a procedure public is the existence of that other document and nothing else. Mirrors record.public_id. */
  public_id?: string | null;
}

/** A number from a paired instrument. Never embedded, never consolidated, never in Memory Bank — these are queried exactly and ordered by time, and they are what makes wear rate computable. */
export interface Reading {
  /** 1. Absent reads as 1. Sealed evidence is upgraded on read, never migrated in place — see specs/2026-08-20-firestore-design.md section 9.1. */
  schema_version?: number;
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
  /** 1. Absent reads as 1. Sealed evidence is upgraded on read, never migrated in place — see specs/2026-08-20-firestore-design.md section 9.1. */
  schema_version?: number;
  /** Opaque and unguessable. It is a public URL. */
  id: string;
  job_id: string;
  tenant_id: string;
  /** A public projection exists at /records/{public_id}. Sharing is a deliberate act by any tenant, not a property of demo tenants. */
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
  /** The capability URL id: 22 chars of crypto randomness, NOT derived from the job id, which would be enumerable. Null until shared; unsharing deletes the public document and every media URL dies with it. */
  public_id?: string | null;
  /** Who stands behind this record, denormalised at seal time. */
  issuer?: {
    display_name: string;
  } | null;
  /** The people, as they were AT SEAL TIME. Denormalised deliberately: a record is immutable, so it must not change when someone updates their profile photo or leaves the company. Bare uids render as nothing to a stranger. */
  actors?: ({
    uid: string;
    display_name: string;
    photo_ref?: string | null;
    role?: string;
  })[];
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
  /** How many times an agent has asked for one more field on this step. Bounded by Step.max_add_fields, and enforced server-side rather than trusted to the agent that asks. */
  add_fields_used?: number;
  /** Fields an agent appended because the declared evidence was insufficient. They are as required as the declared ones. */
  added_fields?: FieldDef[];
  /** Field keys whose evidence has been accepted. A step is performed when every required field appears here — never before, and never because one field passed. */
  accepted_fields?: string[];
  /** The unresolved question an agent raised for a person. The step stays pending: an escalation is a decision awaited, not a status of its own, and a step that is escalated has still not been performed. */
  escalation_question?: string | null;
  /** Why the step did not advance. Written when an agent answered but the answer could not be acted on — a malformed verdict, an unreachable fleet, an unestablished belonging. On the record rather than in a log. */
  hold_reason?: string | null;
  /** When the fleet last ruled on this step. */
  adjudicated_at?: string | null;
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

/** Something needing human attention at a time. Every task is a projection of a decision the fleet already produced — no new agent invents them. The id is derived from its cause so a replayed disposition updates one task instead of creating a second. */
export interface Task {
  /** 1. Absent reads as 1. */
  schema_version?: number;
  /** {kind}__{decision_id}. Deterministic, so the projection is idempotent at the point of write. */
  id: string;
  kind: "chase" | "approve_order" | "escalation" | "service_due" | "held_machine" | "redo_step";
  title: string;
  detail: string;
  /** The decision this projects. */
  source?: {
    job_id?: string | null;
    step_id?: string | null;
    decision_id?: string | null;
  };
  /** From ForemanDisposition.chase_after, which is documented as when to wake and check. */
  due_at?: string | null;
  /** A queue nobody owns yet. Pushes to every holder of the role and writes NO calendar event. */
  assignee_role?: string | null;
  /** An owner. A calendar event exists if and only if this is set. */
  assignee_uid?: string | null;
  claimed_at?: string | null;
  claimed_by?: string | null;
  status: "open" | "done" | "dismissed";
  created_by_agent?: string | null;
  calendar?: {
    event_id: string;
    calendar_id: string;
    synced_at: string;
  } | null;
  /** When this task next wants attention. NEVER null: starts at due_at, moves to now+24h after each notification, and goes far future when closed. One inequality on one field is the whole sweep query. */
  notify_after: string;
  last_notified_at?: string | null;
  notify_count: number;
  created_at: string;
  closed_at?: string | null;
  closed_by?: string | null;
}

/** A Workspace domain is an enterprise; a consumer account is a tenant of one; an anonymous visitor is a tenant of one that has not been claimed. */
export interface Tenant {
  /** 1. Absent reads as 1. Sealed evidence is upgraded on read, never migrated in place — see specs/2026-08-20-firestore-design.md section 9.1. */
  schema_version?: number;
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
/** You are reading every job run against one procedure over a window of weeks, looking for defects in the PROCEDURE. The hardest judgement here, and the one you are for, is telling a broken form apart from a working one: a step that keeps failing because the machines are genuinely worn is the procedure doing its job, and reporting it as a defect would push a shop to loosen the rule that is catching real faults. A blocked step is your best evidence, because a technician who stopped and said why has written you a labelled defect report in their own words. Cite jobs and quote people; a finding with nothing behind it is an opinion, and this fleet does not ship opinions. Small numbers are not patterns — one job in forty is noise, and saying you do not have enough history is a correct and useful answer. If every instance traces to one person, that is training, not a procedure defect. Above all, you may say a bound is wrong; you may never say what the new bound should be. A figure has to come from the shop, and inventing one here would put a fabricated tolerance into a procedure by the back door. */
export interface AuditorFinding {
  /** revise when the procedure should change and you can show why. no_defect when you examined enough history and the procedure is behaving. insufficient_history when the window is too thin to distinguish a pattern from noise. */
  mode: "revise" | "no_defect" | "insufficient_history";
  /** What this procedure is and how it has actually been behaving over the window, in two sentences. Written every time so a wrong reading is visible before anyone acts on it. */
  understanding: string;
  /** How many jobs you actually read. The denominator for every claim below. */
  jobs_examined: number;
  /** Defects in the procedure. Empty unless mode is revise. */
  findings: ({
    step_title: string;
    field_key?: string | null;
    defect: "ambiguous_instruction" | "bound_wrong" | "evidence_not_obtainable" | "step_out_of_order" | "step_redundant" | "guidance_missing" | "strictness_too_high" | "strictness_too_low";
    what: string;
    jobs_cited: string[];
    quotes?: string[];
    jobs_affected: number;
    proposed_revision: string;
    needs_the_shop: boolean;
    confidence: number;
  })[];
  /** Patterns you noticed and decided were NOT procedure defects, each with the reason. A step failing often because the machines are worn belongs here, and so does anything traceable to a single technician. This list is how a reader knows you discriminated rather than reported everything that moved. */
  considered_and_rejected: string[];
}

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

/** Return exactly one verdict for the evidence supplied against this step. PASS only if the acceptance rule is satisfied by what you can actually see. THAT THE EVIDENCE IS CLEAR ENOUGH TO JUDGE IS NOT ITSELF A PASS: a sharp, well lit, entirely legitimate photograph showing the acceptance rule is NOT met is the commonest way a step fails, and passing it because the photograph is good is the single worst mistake you can make. Where the acceptance description says what must be visible rather than what must be true, read it as the condition the step exists to establish — the step explanation tells you which. ADD_FIELD when the evidence is insufficient but recoverable, and name what specifically was wrong with it. ESCALATE when a person must decide — INCLUDING when the evidence is entirely sufficient and shows the acceptance rule is not satisfied. Asking for another photograph of a condition you can already see is not a remedy. */
export interface InspectorVerdict {
  verdict: "PASS" | "ADD_FIELD" | "ESCALATE";
  /** 0 to 1: YOUR CONFIDENCE THAT THE ACCEPTANCE RULE IS SATISFIED by this evidence. Not how sure you are of your verdict, and not how good the photograph is — a perfectly clear photograph of a rule being broken is high certainty and LOW confidence, because the rule is not satisfied. Evidence you were never shown cannot make you confident of anything. Below the strictness threshold you must not return PASS, and a threshold in ordinary code enforces that whatever you return. */
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
  /** Required when the acceptance rule is `matches`. TRANSCRIBE, character by character, exactly what you can read in the evidence — not what it ought to say. Never copy the expected value into this field; it is the one field in this answer that must come from the image alone. Where a character is illegible write `?` in its place. The comparison against the expected value is then made in ordinary code, not by you, which is the whole point: an agent told what it is looking for will find it. */
  observed?: string | null;
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

/** You are interviewing a shop about a job they already do, until the procedure is unambiguous enough that two different technicians working alone would produce the same record. Ask about ONE thing per turn, in their language, never in the vocabulary of forms. Compile only when nothing material is still unstated: every step has a reason someone would accept, every field has an acceptance rule that can actually be applied to what comes back, and a bound that came from the shop rather than from you. Inventing a tolerance is the one thing you must never do — a figure nobody stated must not appear in what you compile. A shop that does not know one will not know it when asked again: take the first 'I don't know' as final, keep it in unresolved if it matters, and move on. Your turns are few. Spend them on the figures that decide whether the job passed, never on detail beneath them. */
export interface ScoperTurn {
  /** ask while anything material is unstated. compile once the procedure would run unambiguously. */
  mode: "ask" | "compile";
  /** Required when mode is ask. One question about one thing, phrased for a mechanic, not a form designer. Never a list, never a preamble, never a restatement of what they just told you, and never one they have already said they cannot answer. */
  question?: string | null;
  /** Which class of unknown this question closes. Required when mode is ask. */
  asks_about?: "scope" | "sequence" | "tolerance" | "evidence" | "failure" | "authority" | "parts" | "safety" | null;
  /** Everything you still do not know that would change the compiled procedure. Complete every turn, not only what you just asked about. Empty is the only condition under which you may compile. */
  unresolved: string[];
  /** What you now believe the job is, in two sentences. Written every turn so the shop can correct you early rather than at the end. */
  understanding: string;
  /** Required when mode is compile. The procedure as it would run tomorrow. */
  draft?: {
    key: string;
    title: string;
    strictness: number;
    minimum_tier: "open" | "attested" | "instrumented";
    disqualifiers?: string[];
    releases?: string[];
    steps: ({
    title: string;
    explanation: string;
    condition?: string | null;
    max_add_fields: number;
    fields: ({
    key: string;
    kind: "measurement" | "photo" | "video" | "scan" | "choice" | "text" | "signature" | "location";
    prompt: string;
    source: "instrument" | "camera" | "human";
    required_at_strictness: number;
    choices?: string[];
    acceptance_rule: "within" | "matches" | "must_show" | "consistent_with" | "per_spec" | "signed_by";
    acceptance_min?: number | null;
    acceptance_max?: number | null;
    acceptance_unit?: string | null;
    acceptance_target?: string | null;
    acceptance_description?: string | null;
    guidance: string;
  })[];
  })[];
  } | null;
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

/** You are meeting a Bluetooth Low Energy device nobody has written a driver for, and your job is to work out which characteristic carries a physical reading and exactly how it is encoded. Prefer evidence over inference, in this order: a 0x2904 presentation-format descriptor states the format, exponent and unit outright and must be read rather than guessed; a Bluetooth SIG assigned service or characteristic has a published encoding you already know; only when neither exists may you infer from the bytes. Probe before you commit — a driver emitted from a single frame is a guess wearing a uniform. You must never emit a driver whose unit you cannot name, and you must never emit one for a characteristic that plausibly carries battery level, firmware revision, a sequence counter or a status flag rather than a reading. Abandoning with a clear reason is a correct outcome and is worth more than a driver that decodes something into a believable wrong number. */
export interface WrightTurn {
  /** probe while anything material about the encoding is unknown. emit once a driver would decode correctly. abandon when this device cannot be driven and you can say why. */
  mode: "probe" | "emit" | "abandon";
  /** What you now believe this device is and which characteristic carries the reading, in two sentences. Written every turn so a wrong track is visible early rather than at the end. */
  understanding: string;
  /** What in the GATT tree, the advertisement or the frames supports your current belief. Cite the actual UUID, descriptor or byte offset. An empty list means you are guessing and should be probing instead. */
  evidence: string[];
  /** Everything still unknown that would change the driver. Empty is the only condition under which you may emit. */
  unresolved: string[];
  /** Required when mode is probe. One operation for the phone to perform against the device. */
  probe?: {
    op: "enumerate" | "read" | "subscribe" | "write_then_subscribe" | "sample_while_changing";
    service?: string | null;
    characteristic?: string | null;
    bytes?: string | null;
    samples: number;
    instruction?: string | null;
    why: string;
  } | null;
  /** Required when mode is emit. Kotlin implementing the Driver interface in android/app/src/main/java/ink/warrant/instrument/Driver.kt. */
  driver?: {
    class_name: string;
    label: string;
    service: string;
    characteristic: string;
    unit: string;
    min: number;
    max: number;
    start_write?: string | null;
    kotlin: string;
    rationale: string;
  } | null;
  /** Required when mode is abandon. Saying why is the deliverable. */
  abandon?: {
    reason: "encrypted" | "bonding_required" | "no_readable_characteristic" | "vendor_handshake_unknown" | "no_unit_derivable" | "frames_never_decode" | "probe_budget_exhausted";
    detail: string;
  } | null;
}
