import "server-only";

// A step nobody could perform, disposed of.
//
// This is the fleet's one genuine HANDOFF. Everywhere else an agent answers a question on its
// own: the Inspector judges evidence, the Skeptic judges belonging, and they run in parallel
// precisely because neither needs the other's answer. Here the Instructor turns a sentence a
// technician said out loud into a structured blocker, and the Foreman disposes of the JOB in
// light of it — a different question, at a different timescale, that cannot be asked until the
// first is answered.
//
// The two contracts already fit: `instructor-recommendation` returns exactly the six fields
// `foreman.py` renders as "What the Instructor made of it". That was designed. It was simply
// never connected, and `taskFromDisposition()` sat in tasks.ts with no caller as a result.
//
// Called by the sweep, not by a client. A technician who defers a step is walking away from the
// machine; nothing about what happens next may depend on their phone staying awake.

import { randomUUID } from "node:crypto";
import { adminDb } from "@/auth/admin";
import { askFleet, FleetUnreachable, type FleetReply } from "@/server/fleet";
import { instructorCase, foremanCase, type StallSources } from "./cases";
import { taskFromDisposition } from "@/server/tasks";
import { stockFor } from "@/server/stock";
import type { Role } from "@/auth/members";
import { newTrace, withSpan } from "@/server/trace";
import { pinnedVersion } from "@/server/procedures";
import { screenText } from "./armor";
import { GoogleAuth } from "google-auth-library";
import type { Procedure } from "@/generated/types";

export interface StallRef {
  tenantId: string;
  jobId: string;
  stepId: string;
}

export interface DisposeDeps {
  ask?: typeof askFleet;
  db?: FirebaseFirestore.Firestore;
  now?: () => string;
}

export interface Disposed {
  decisionIds: string[];
  /** What the Foreman decided, or null when it could not be asked. */
  action: "chase" | "reorder" | "escalate" | "revise" | null;
  status: "deferred" | "impossible" | null;
  taskId: string | null;
  /** Set when the disposition was refused by this module rather than by the model. */
  refused?: string;
}

const USD_PER_1K_TOKENS = 0.0003;
const costOf = (r: FleetReply) =>
  Number((((r.usage?.totalTokenCount ?? 0) / 1000) * USD_PER_1K_TOKENS).toFixed(6));

/**
 * Statuses this module will write from a model's answer.
 *
 * `waived` is deliberately absent, and its absence is the point. A waiver seals a record with
 * a named person's standing behind it — `contract/entities/step-outcome.schema.json` requires
 * `waived_by`, and `foreman.py` is told a waiver needs a named person who holds standing on
 * this tenant. An agent reached by a cron has nobody's standing. So a Foreman that answers
 * `waived` is not obeyed; it is escalated to somebody who can actually waive, and the record
 * says that is what happened.
 */
const WRITEABLE_STATUS = new Set(["deferred", "impossible"]);

export async function dispose(ref: StallRef, deps: DisposeDeps = {}): Promise<Disposed> {
  const db = deps.db ?? adminDb();
  const ask = deps.ask ?? askFleet;
  const nowIso = deps.now ?? (() => new Date().toISOString());
  const now = nowIso();
  const scopedJobId = `${ref.tenantId}/${ref.jobId}`;
  const trace = newTrace();

  const jobRef = db.doc(`tenants/${ref.tenantId}/jobs/${ref.jobId}`);
  const outRef = jobRef.collection("step_outcomes").doc(ref.stepId);
  const [jobSnap, outSnap] = await Promise.all([jobRef.get(), outRef.get()]);
  if (!jobSnap.exists) throw new Error(`no such job: ${scopedJobId}`);
  if (!outSnap.exists) throw new Error(`no step outcome ${ref.stepId} on ${scopedJobId}`);

  const job = jobSnap.data()!;
  const outcome = outSnap.data()!;

  // The PINNED version, for the same reason adjudication reads it: a job is disposed of against
  // the procedure it started under, not the one somebody published this morning.
  const version: Partial<Procedure> & { steps?: any[] } = (await pinnedVersion(
    db, ref.tenantId, String(job.procedure_id), job.procedure_version,
  )) ?? { steps: [] };
  const steps: any[] = version.steps ?? [];
  const index = steps.findIndex((s) => s.id === ref.stepId);
  if (index < 0) throw new Error(`step ${ref.stepId} is not in the pinned procedure version`);

  // Every other step outcome on this job, so "steps outstanding" is counted rather than guessed.
  const allOutcomes = await jobRef.collection("step_outcomes").get();
  const settled = new Set(
    allOutcomes.docs
      .filter((d) => ["performed", "waived", "impossible"].includes(String(d.data().status)))
      .map((d) => d.id),
  );
  const stepsOutstanding = steps.filter((s) => !settled.has(s.id)).length;

  const started = job.started_at ? Date.parse(job.started_at) : NaN;
  const daysOpen = Number.isNaN(started)
    ? null
    : Math.floor((Date.parse(now) - started) / 86_400_000);

  const sources: StallSources = {
    step: steps[index],
    procedure: {
      title: version.title,
      version: version.version,
      strictness: job.strictness ?? 1,
      stepCount: steps.length,
    },
    stepIndex: index + 1,
    job: { ...job, id: scopedJobId, procedure: job.procedure_id },
    outcome,
    remainingSteps: steps.slice(index + 1).map((s) => String(s.title ?? s.id)),
    now,
    // Read once and shown to BOTH agents. The Instructor uses it to say whether the next
    // action is doable now; the Foreman uses it to choose between chasing and reordering.
    stock: await stockFor(ref.tenantId, db),
  };

  const decisionIds: string[] = [];
  const write = async (agent: string, verdict: string, rationale: string,
                       reply: FleetReply | null): Promise<void> => {
    const id = randomUUID();
    await db.doc(`tenants/${ref.tenantId}/decisions/${id}`).set({
      id,
      job_id: scopedJobId,
      step_id: ref.stepId,
      agent,
      agent_version: process.env.WARRANT_FLEET_ENGINE?.split("/").pop() ?? "unknown",
      model: reply?.model ?? null,
      verdict,
      rationale,
      cost_usd: reply ? costOf(reply) : null,
      at: nowIso(),
    });
    decisionIds.push(id);
  };

  // --- Model Armor, on the TRANSCRIPT, before either agent is shown it ------------------
  //
  // The image path has been screened since the beginning and this one had not, which left the
  // wrong half unguarded. The Inspector reads a photograph and can only ACCEPT A FIELD; the
  // Foreman reads this transcript and writes `status: "impossible"` — one of the three statuses
  // that settle a step, which firestore.rules refuses to every client for exactly the reason
  // that the person being checked must not settle their own work. The transcript is written by
  // that same person, in free text, and handed on verbatim.
  //
  // A match means neither agent sees it. The stall is raised for a human instead, which is the
  // conservative direction and the one a refusal should always take: the step does not settle,
  // the machine stays held, and somebody is told why.
  const armor = await withSpan(trace, "armor.transcript",
    { job: scopedJobId, step: ref.stepId },
    () => screenTranscript(String(outcome.reason_transcript ?? "")));

  if (armor.verdict === "MATCH_FOUND") {
    await write("foreman", "REFUSED_BY_ARMOR",
                `This stall was refused before any model saw it. ${armor.detail}`, null);
    await outRef.set({
      // NOT settled. An escalation is a decision awaited, and this one is awaited by a person.
      disposition_action: "escalate",
      disposition_at: now,
      hold_reason: `The stated reason was refused by Model Armor: ${armor.detail}`,
    }, { merge: true });
    const raised = await taskFromDisposition({
      tenantId: ref.tenantId, jobId: ref.jobId, stepId: ref.stepId,
      decisionId: decisionIds[decisionIds.length - 1] ?? randomUUID(),
      action: "escalate",
      rationale: `The stated reason for this stall reads as an instruction to the fleet rather ` +
                 `than an account of a blocker. A person has to read it. ${armor.detail}`,
      chaseAfter: null, reorderPart: null, escalateToRole: "foreman",
      technicianUid: outcome.reason_by ?? null,
    });
    return { decisionIds, action: "escalate", status: null, taskId: raised?.id ?? null,
             refused: armor.detail };
  }

  // --- the Instructor ------------------------------------------------------------------
  //
  // Its failure is survivable and must not stop the chain. The Foreman is then shown the
  // technician's raw sentence and told plainly that there is no recommendation, which is a
  // worse input than a structured blocker and a far better one than an invented blocker.
  let recommendation: Record<string, any> | null = null;
  let recommendationModel: string | null = null;
  try {
    const reply = await withSpan(trace, "agent.instructor",
      { agent: "instructor", job: scopedJobId, step: ref.stepId },
      () => ask("instructor", instructorCase(sources)));
    if (reply.valid) {
      recommendation = reply.output as Record<string, any>;
      recommendationModel = reply.model ?? null;
      await write("instructor", String(recommendation.blocker_kind ?? "unstated"),
                  String(recommendation.recommended_action ?? ""), reply);
    } else {
      await write("instructor", "invalid", reply.schemaErrors.join("; "), reply);
    }
  } catch (error) {
    const principal = error instanceof FleetUnreachable ? error.principal : null;
    await write("instructor", "engine_unreachable",
                `The fleet could not be reached${principal ? ` as ${principal}` : ""}: ` +
                `${error instanceof Error ? error.message : String(error)}`, null);
  }

  // --- the Foreman ---------------------------------------------------------------------
  let foreman: FleetReply;
  try {
    foreman = await withSpan(trace, "agent.foreman",
      { agent: "foreman", job: scopedJobId, step: ref.stepId,
        // The handoff, visible in the trace: whether the Foreman had a structured blocker or
        // only the technician's raw sentence.
        had_recommendation: recommendation !== null },
      () => ask("foreman", foremanCase({
      ...sources,
      recommendation,
      stepsOutstanding,
      daysOpen,
      history: (outcome.history ?? []).map(String),
    })));
  } catch (error) {
    const principal = error instanceof FleetUnreachable ? error.principal : null;
    await write("foreman", "engine_unreachable",
                `The fleet could not be reached${principal ? ` as ${principal}` : ""}: ` +
                `${error instanceof Error ? error.message : String(error)}`, null);
    // Deliberately NOT disposed. The step keeps turning up in the sweep until a Foreman
    // actually rules on it, which is the whole value of the net.
    return { decisionIds, action: null, status: null, taskId: null };
  }

  if (!foreman.valid) {
    await write("foreman", "invalid", foreman.schemaErrors.join("; "), foreman);
    return { decisionIds, action: null, status: null, taskId: null,
             refused: "the Foreman's answer did not satisfy its contract" };
  }

  const out = foreman.output as Record<string, any>;
  await write("foreman", String(out.action ?? "invalid"),
              String(out.rationale ?? "no rationale returned"), foreman);

  const action = out.action as Disposed["action"];
  let status: Disposed["status"] = WRITEABLE_STATUS.has(String(out.status))
    ? (out.status as Disposed["status"])
    : null;
  let refused: string | undefined;
  let escalateTo: Role | null = (out.escalate_to_role ?? null) as Role | null;
  let effectiveAction = action;

  if (!status) {
    // Almost always `waived`. See WRITEABLE_STATUS.
    refused =
      `The Foreman proposed status ${JSON.stringify(out.status)}, which this path may not ` +
      `write. A waiver needs a named person who holds standing on this tenant, and a cron ` +
      `holds nobody's. Raised for a person instead.`;
    status = "deferred";
    effectiveAction = "escalate";
    escalateTo = escalateTo ?? "foreman";
    await write("foreman", "refused_by_gate", refused, null);
  }

  await outRef.set({
    status,
    disposition_action: effectiveAction,
    disposition_at: now,
    // The Instructor's next action for the person standing there, when there was one.
    ...(recommendation
      // The INSTRUCTOR's model, not the Foreman's. `recommendation_text` is the Instructor's
      // sentence, and stamping it with the model that ran afterwards attributes one agent's
      // words to another — in the one field a dispute months later would read to find out
      // which model said this.
      ? { recommendation_text: String(recommendation.recommended_action ?? ""),
          recommendation_model: recommendationModel }
      : {}),
    // A RECOMMENDATION on the record, never an act. The Gate reads the record and holds the
    // machine deterministically; a hold that depended on a model's mood would not be a hold.
    ...(out.hold_machine === true
      ? { hold_reason: String(out.rationale ?? "the Foreman recommended holding this machine") }
      : {}),
  }, { merge: true });

  const task = await taskFromDisposition({
    tenantId: ref.tenantId,
    jobId: ref.jobId,
    stepId: ref.stepId,
    decisionId: decisionIds[decisionIds.length - 1] ?? randomUUID(),
    action: effectiveAction ?? "escalate",
    rationale: refused ?? String(out.rationale ?? ""),
    chaseAfter: out.chase_after ?? null,
    reorderPart: out.reorder_part ?? null,
    escalateToRole: escalateTo,
    technicianUid: outcome.reason_by ?? null,
  });

  return { decisionIds, action: effectiveAction, status, taskId: task?.id ?? null,
           ...(refused ? { refused } : {}) };
}


/**
 * Put one transcript through Model Armor.
 *
 * Every failure path returns NOT_SCREENED, and NOT_SCREENED does not block — the same posture
 * `run.ts` takes on evidence. An admitted gap beats a fabricated pass, and a workshop whose
 * Foreman stopped ruling on stalls because a screening API was unreachable would be a worse
 * failure than the one this guards.
 */
async function screenTranscript(text: string): Promise<{ verdict: string; detail: string }> {
  if (!text.trim()) return { verdict: "NO_MATCH_FOUND", detail: "There was no text to screen." };
  let token: string | null = null;
  try {
    const client = await new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }).getClient();
    const t = await client.getAccessToken();
    token = typeof t === "string" ? t : (t?.token ?? null);
  } catch {
    token = null;
  }
  return screenText(text, token);
}
