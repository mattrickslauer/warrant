import "server-only";

// Weeks of finished jobs, read as evidence about the PROCEDURE.
//
// Every other agent judges one moment: this field's evidence, this technician's sentence, this
// job's disposition. The Auditor is the only one whose subject is the document everything else
// is measured against, and the only one that closes the loop — a defect it finds becomes an
// interview question, and the interview produces a new version.
//
// It runs from the sweep because its unit of time is a fortnight. Nothing about it can be
// triggered by a person finishing a job, and nothing about it should be: a procedure defect is
// visible only in the aggregate, and the aggregate does not exist until enough jobs have run.
//
// WHAT THIS DOES NOT DO. It does not revise anything. `auditor.py` is explicit that the Auditor
// may say a bound is wrong and may never say what the bound should be — that figure has to come
// from the shop, through an interview, or a fabricated tolerance enters the procedure by the
// back door. So a finding is written down and a task is raised for a person. The revision is
// the Scoper's, and the Scoper's is a conversation.

import { randomUUID } from "node:crypto";
import { adminDb } from "@/auth/admin";
import { askFleet, FleetUnreachable, type FleetReply } from "@/server/fleet";
import { auditorCase, type AuditSources } from "./cases";
import { raiseTask } from "@/server/tasks";
import { pinnedVersion } from "@/server/procedures";

export interface AuditRef {
  tenantId: string;
  procedureId: string;
}

export interface AuditDeps {
  ask?: typeof askFleet;
  db?: FirebaseFirestore.Firestore;
  now?: () => string;
}

export interface Audited {
  decisionId: string | null;
  mode: "revise" | "no_defect" | "insufficient_history" | null;
  findingIds: string[];
  jobsExamined: number;
  taskIds: string[];
}

/**
 * How many jobs go into one prompt.
 *
 * Twenty is a real fortnight for a two-technician shop and it keeps the prompt inside a size
 * the endpoint answers reliably. Above it the window is truncated and SAID to be truncated —
 * see `auditorCase`.
 */
const MAX_JOBS = 20;

/** Below this there is no aggregate to read, and the contract has a mode for saying so. */
const MIN_JOBS = 3;

const USD_PER_1K_TOKENS = 0.0003;
const costOf = (r: FleetReply) =>
  Number((((r.usage?.totalTokenCount ?? 0) / 1000) * USD_PER_1K_TOKENS).toFixed(6));

export async function audit(ref: AuditRef, deps: AuditDeps = {}): Promise<Audited> {
  const db = deps.db ?? adminDb();
  const ask = deps.ask ?? askFleet;
  const nowIso = deps.now ?? (() => new Date().toISOString());
  const now = nowIso();

  // The CURRENT published version, which is the document the Auditor's findings are about.
  // Unlike adjudication there is no job to take a pin from — the subject here is the procedure
  // itself — so the version is read off the procedure's own `current_version`.
  const procSnap = await db.doc(`tenants/${ref.tenantId}/procedures/${ref.procedureId}`).get();
  const version = await pinnedVersion(
    db, ref.tenantId, ref.procedureId,
    procSnap.exists ? (procSnap.data()?.current_version as number | undefined) : undefined,
  );
  if (!version) throw new Error(`no pinned version for ${ref.procedureId}`);

  const jobSnap = await db
    .collection(`tenants/${ref.tenantId}/jobs`)
    .where("procedure_id", "==", ref.procedureId)
    .where("status", "==", "sealed")
    .limit(100)
    .get();

  // Newest first, then capped. Sorted here rather than by the query so no composite index has
  // to be deployed before an audit can run at all.
  const finished = jobSnap.docs.sort((a, b) =>
    String(b.data().started_at ?? "").localeCompare(String(a.data().started_at ?? "")));

  if (finished.length < MIN_JOBS) {
    // Not an error and not a finding. "I do not have enough history" is a correct answer and
    // the contract gives it a mode of its own, precisely because an agent with no way to say
    // it will always find something.
    return { decisionId: null, mode: "insufficient_history", findingIds: [],
             jobsExamined: finished.length, taskIds: [] };
  }

  const chosen = finished.slice(0, MAX_JOBS);

  // Each job with its step outcomes. The stated reasons are the strongest evidence in the whole
  // document: somebody stopped work and explained why, which is a defect report written by the
  // person the procedure failed.
  const jobs = await Promise.all(chosen.map(async (jobDoc) => {
    const outcomes = await jobDoc.ref.collection("step_outcomes").get();
    const data = jobDoc.data();
    return {
      id: jobDoc.id,
      started_at: data.started_at ?? null,
      sealed_at: data.sealed_at ?? null,
      asset_id: data.asset_id ?? null,
      steps: outcomes.docs.map((o) => {
        const s = o.data();
        return {
          step_id: s.step_id ?? o.id,
          status: s.status ?? "pending",
          reason: s.reason_transcript ?? null,
          reason_by: s.reason_by ?? null,
          disposition_action: s.disposition_action ?? null,
          add_fields_used: s.add_fields_used ?? 0,
          escalation_question: s.escalation_question ?? null,
        };
      }),
    };
  }));

  const priorSnap = await db
    .collection(`tenants/${ref.tenantId}/findings`)
    .where("procedure_id", "==", ref.procedureId)
    .limit(20)
    .get();
  const priorFindings = priorSnap.docs.map((d) => {
    const f = d.data();
    return { at: f.at, defect: f.defect, step_title: f.step_title, what: f.what };
  });

  const sources: AuditSources = {
    procedure: {
      key: ref.procedureId,
      title: version.title,
      version: version.version,
      strictness: version.strictness,
      inServiceSince: version.published_at ?? null,
    },
    steps: version.steps ?? [],
    window: {
      from: String(chosen[chosen.length - 1].data().started_at ?? ""),
      to: String(chosen[0].data().started_at ?? ""),
    },
    jobs,
    totalInWindow: finished.length,
    priorFindings,
  };

  let reply: FleetReply;
  try {
    reply = await ask("auditor", auditorCase(sources));
  } catch (error) {
    const principal = error instanceof FleetUnreachable ? error.principal : null;
    throw new Error(
      `the Auditor could not be reached${principal ? ` as ${principal}` : ""}: ` +
      `${error instanceof Error ? error.message : String(error)}`);
  }

  const decisionId = randomUUID();
  const out = reply.output as Record<string, any>;
  await db.doc(`tenants/${ref.tenantId}/decisions/${decisionId}`).set({
    id: decisionId,
    job_id: null,
    step_id: null,
    procedure_id: ref.procedureId,
    agent: "auditor",
    agent_version: process.env.WARRANT_FLEET_ENGINE?.split("/").pop() ?? "unknown",
    model: reply.model ?? null,
    verdict: reply.valid ? String(out.mode ?? "invalid") : "invalid",
    rationale: reply.valid
      ? String(out.understanding ?? "")
      : reply.schemaErrors.join("; "),
    cost_usd: costOf(reply),
    at: now,
  });

  // Always written, whatever the answer. An audit that ran and found nothing is a fact about
  // the procedure, and without it "no findings" is indistinguishable from "never audited".
  await db.doc(`tenants/${ref.tenantId}/audits/${ref.procedureId}`).set({
    procedure_id: ref.procedureId,
    at: now,
    jobs_examined: reply.valid ? (out.jobs_examined ?? jobs.length) : jobs.length,
    jobs_available: finished.length,
    mode: reply.valid ? (out.mode ?? null) : "invalid",
    decision_id: decisionId,
  }, { merge: true });

  if (!reply.valid) {
    return { decisionId, mode: null, findingIds: [], jobsExamined: jobs.length, taskIds: [] };
  }

  const findingIds: string[] = [];
  const taskIds: string[] = [];
  for (const f of (out.findings ?? []) as Array<Record<string, any>>) {
    const id = randomUUID();
    await db.doc(`tenants/${ref.tenantId}/findings/${id}`).set({
      id,
      procedure_id: ref.procedureId,
      procedure_version: version.version ?? null,
      decision_id: decisionId,
      step_title: f.step_title ?? null,
      field_key: f.field_key ?? null,
      defect: f.defect ?? null,
      what: f.what ?? null,
      jobs_cited: f.jobs_cited ?? [],
      jobs_affected: f.jobs_affected ?? null,
      proposed_revision: f.proposed_revision ?? null,
      // A wrong bound can only be replaced by a figure the shop states, so it goes back
      // through an interview. auditor.py enforces this on the answer; it is carried onto the
      // record here so the task says which findings a person actually has to talk about.
      needs_the_shop: f.needs_the_shop === true,
      at: now,
      status: "open",
    });
    findingIds.push(id);

    // `escalation`, following taskFromDisposition's `revise` case exactly: a procedure defect
    // is filed against the procedure and raised at somebody who can change it, never at a
    // technician who cannot. A new TaskKind would have to travel through the contract into
    // three languages to say the same thing this already says.
    const task = await raiseTask({
      tenantId: ref.tenantId,
      kind: "escalation",
      title: `The procedure is wrong and needs revising — ${f.step_title ?? ref.procedureId}`,
      detail: String(f.what ?? ""),
      cause: id,
      decisionId,
      assigneeRole: "owner",
      createdByAgent: "auditor",
    });
    if (task) taskIds.push(task.id);
  }

  return { decisionId, mode: out.mode ?? null, findingIds,
           jobsExamined: out.jobs_examined ?? jobs.length, taskIds };
}
