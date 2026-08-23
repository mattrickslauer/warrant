import "server-only";

// Tasks — the things that need a human at a time.
//
// No agent invents a task. Every one is a PROJECTION of a decision the fleet already made:
// the Foreman says chase and names when to wake, or says reorder and a purchase order waits
// for approval, or says escalate and names the role that must decide. The schema was already
// written for this — ForemanDisposition.chase_after is documented as "when to wake and check"
// and is required when the action is chase.
//
// Server-side because a task's cause is server-side. `/tenants/{t}/tasks` is client-WRITABLE,
// though: closing or claiming a task is a legitimate act by the person doing the work.
//
// See specs/2026-08-20-firestore-design.md §8.

import { adminDb } from "@/auth/admin";
import type { Role } from "@/auth/members";

export type TaskKind =
  | "chase" | "approve_order" | "escalation" | "service_due" | "held_machine" | "redo_step";

export interface TaskDoc {
  schema_version: number;
  id: string;
  kind: TaskKind;
  title: string;
  detail: string;
  source: { job_id: string | null; step_id: string | null; decision_id: string | null };
  due_at: string | null;
  assignee_role: Role | null;
  assignee_uid: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  status: "open" | "done" | "dismissed";
  created_by_agent: string | null;
  calendar: { event_id: string; calendar_id: string; synced_at: string } | null;
  /**
   * When this task next wants attention. NEVER null.
   *
   * A single computed clock rather than a pair of conditions: it starts at `due_at`, and each
   * notification pushes it to now + 24h. A task not yet due and a task notified an hour ago
   * are both simply not returned, so the sweep is one equality and one inequality on one
   * field — no null handling, no multi-inequality index, and re-notification of an unclaimed
   * escalation falls out for free instead of being a second mechanism.
   */
  notify_after: string;
  last_notified_at: string | null;
  notify_count: number;
  created_at: string;
  closed_at: string | null;
  closed_by: string | null;
}

export const SCHEMA_VERSION = 1;

/** Long enough not to nag, short enough that an unclaimed escalation cannot be forgotten. */
export const RENOTIFY_MS = 24 * 60 * 60 * 1000;

/** Closed tasks must never come back. Well past any plausible run of this system. */
const NEVER = "9999-12-31T23:59:59.999Z";

const tasksCol = (tenantId: string) =>
  adminDb().collection("tenants").doc(tenantId).collection("tasks");

/**
 * The document id, derived from the cause rather than random.
 *
 * A projection that can be replayed — a retry, a redeploy, a Pub/Sub redelivery — must be
 * idempotent at the point of write. Deduplicating afterwards means there was a window in
 * which a technician saw the same escalation twice.
 */
export function taskIdFor(kind: TaskKind, cause: string): string {
  return `${kind}__${cause.replace(/\//g, "_")}`;
}

export interface RaiseInput {
  tenantId: string;
  kind: TaskKind;
  title: string;
  detail: string;
  cause: string;
  jobId?: string | null;
  stepId?: string | null;
  decisionId?: string | null;
  dueAt?: string | null;
  assigneeUid?: string | null;
  assigneeRole?: Role | null;
  createdByAgent?: string | null;
}

/**
 * Raise a task, or update the one this cause already raised.
 *
 * Deliberately `merge` rather than overwrite: replaying a disposition must not resurrect a
 * task somebody already closed, nor reset the notification clock on one already in flight.
 */
export async function raiseTask(input: RaiseInput): Promise<TaskDoc> {
  const id = taskIdFor(input.kind, input.cause);
  const ref = tasksCol(input.tenantId).doc(id);
  const existing = await ref.get();
  const nowIso = new Date().toISOString();

  if (existing.exists) {
    const patch = { title: input.title, detail: input.detail, due_at: input.dueAt ?? null };
    await ref.set(patch, { merge: true });
    return { ...(existing.data() as TaskDoc), ...patch };
  }

  const task: TaskDoc = {
    schema_version: SCHEMA_VERSION,
    id,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    source: {
      job_id: input.jobId ?? null,
      step_id: input.stepId ?? null,
      decision_id: input.decisionId ?? null,
    },
    due_at: input.dueAt ?? null,
    assignee_role: input.assigneeRole ?? null,
    assignee_uid: input.assigneeUid ?? null,
    claimed_at: null,
    claimed_by: null,
    status: "open",
    created_by_agent: input.createdByAgent ?? null,
    calendar: null,
    // With no due date the task wants attention now — an escalation is not less urgent for
    // having no clock on it.
    notify_after: input.dueAt ?? nowIso,
    last_notified_at: null,
    notify_count: 0,
    created_at: nowIso,
    closed_at: null,
    closed_by: null,
  };

  await ref.set(task);
  return task;
}

/**
 * A Foreman disposition, projected.
 *
 * This is the whole mapping, and it needs no model: the disposition already carries the
 * action, the wake time, the part and the role. Reading it is arithmetic.
 */
export interface DispositionInput {
  tenantId: string;
  jobId: string;
  stepId: string | null;
  decisionId: string;
  action: "chase" | "reorder" | "escalate" | "revise";
  rationale: string;
  chaseAfter?: string | null;
  reorderPart?: string | null;
  escalateToRole?: Role | null;
  technicianUid?: string | null;
}

export async function taskFromDisposition(d: DispositionInput): Promise<TaskDoc | null> {
  const common = {
    tenantId: d.tenantId,
    cause: d.decisionId,
    jobId: d.jobId,
    stepId: d.stepId,
    decisionId: d.decisionId,
    detail: d.rationale,
    createdByAgent: "foreman",
  };

  switch (d.action) {
    case "chase":
      return raiseTask({
        ...common, kind: "chase",
        title: "Chase this before the job can move",
        dueAt: d.chaseAfter ?? null,
        assigneeUid: d.technicianUid ?? null,
      });

    case "reorder":
      // A purchase order is DRAFTED, never sent. Somebody with standing approves it, and that
      // approval is the task.
      return raiseTask({
        ...common, kind: "approve_order",
        title: `Approve the drafted order${d.reorderPart ? ` — ${d.reorderPart}` : ""}`,
        assigneeRole: "foreman",
      });

    case "escalate":
      // A ROLE, not a person. It becomes a queue: see claimTask().
      return raiseTask({
        ...common, kind: "escalation",
        title: "A person has to decide this",
        assigneeRole: d.escalateToRole ?? "foreman",
      });

    case "revise":
      // A procedure defect is filed against the procedure, not raised at a technician who
      // cannot fix it mid-job.
      return raiseTask({
        ...common, kind: "escalation",
        title: "The procedure is wrong and needs revising",
        assigneeRole: "owner",
      });
  }
}

/**
 * Claiming a queue item.
 *
 * This is what creates a calendar event. A task assigned to a role has no single calendar to
 * write to — three foremen would get three events, each of which somebody has to dismiss, and
 * claiming would become a distributed delete. So the invariant is simply:
 *
 *   a calendar event exists if and only if assignee_uid is set.
 */
export async function claimTask(tenantId: string, taskId: string, uid: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await tasksCol(tenantId).doc(taskId).set(
    { assignee_uid: uid, claimed_at: nowIso, claimed_by: uid },
    { merge: true },
  );
}

export async function closeTask(
  tenantId: string, taskId: string, by: string, status: "done" | "dismissed" = "done",
): Promise<void> {
  await tasksCol(tenantId).doc(taskId).set(
    {
      status,
      closed_at: new Date().toISOString(),
      closed_by: by,
      // Closed tasks must never surface in the sweep again.
      notify_after: NEVER,
    },
    { merge: true },
  );
}

/** Record that a notification went out, and push the clock forward. */
export async function markNotified(tenantId: string, taskId: string, count: number): Promise<void> {
  const nowMs = Date.now();
  await tasksCol(tenantId).doc(taskId).set(
    {
      last_notified_at: new Date(nowMs).toISOString(),
      notify_after: new Date(nowMs + RENOTIFY_MS).toISOString(),
      notify_count: count + 1,
    },
    { merge: true },
  );
}

export async function attachCalendarEvent(
  tenantId: string, taskId: string, eventId: string, calendarId: string,
): Promise<void> {
  await tasksCol(tenantId).doc(taskId).set(
    { calendar: { event_id: eventId, calendar_id: calendarId, synced_at: new Date().toISOString() } },
    { merge: true },
  );
}

export interface DueTask extends TaskDoc {
  /** The collection-group query loses the tenant, so it is recovered from the path. */
  tenant_id: string;
}

/**
 * Every task, in every tenant, that wants attention now.
 *
 * A COLLECTION GROUP query, and that is the whole reason the index in firestore.indexes.json
 * is COLLECTION_GROUP scoped. `/tenants/{t}/tasks` is a subcollection, so a collection-scoped
 * index serves one tenant at a time and this — one cron for the entire system — would not run
 * at all.
 *
 * This runs under Admin credentials, which bypass rules; that is what lets it read across
 * tenants. A client cannot do the same, because enabling a client collection-group query
 * needs a rule matching /{path=**}/tasks/{taskId} and no such rule exists.
 */
export async function dueTasks(limit = 200): Promise<DueTask[]> {
  const snap = await adminDb()
    .collectionGroup("tasks")
    .where("status", "==", "open")
    .where("notify_after", "<=", new Date().toISOString())
    .limit(limit)
    .get();

  return snap.docs.map((d) => ({
    ...(d.data() as TaskDoc),
    // tenants/{tenantId}/tasks/{taskId}
    tenant_id: d.ref.parent.parent?.id ?? "",
  }));
}

/**
 * Captures nobody adjudicated.
 *
 * The cost of letting a client trigger adjudication is that a client which dies between
 * writing the capture and making the call leaves evidence in limbo — accepted, stored, and
 * judged by nobody. This is the net beneath that. It is why the client may trigger at all.
 *
 * Two minutes: long enough that a live client has certainly had its chance, short enough
 * that a technician still standing at the machine gets an answer while it matters.
 *
 * A COLLECTION_GROUP query on `captures`, which needs the matching index deployed — the same
 * requirement and the same misleading failure as `dueTasks()` above.
 */
export interface UndecidedCapture {
  tenantId: string;
  jobId: string;
  stepId: string;
  fieldKey: string;
  captureId: string;
}

export async function undecidedCaptures(
  olderThanMs: number,
  limit = 50,
): Promise<UndecidedCapture[]> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const snap = await adminDb()
    .collectionGroup("captures")
    .where("adjudicated", "==", false)
    .where("created_at", "<", cutoff)
    .limit(limit)
    .get();

  return snap.docs.flatMap((doc) => {
    // tenants/{t}/jobs/{j}/captures/{c}
    const parts = doc.ref.path.split("/");
    if (parts.length !== 6) return [];
    const fieldId = String((doc.data() as { field_id?: string }).field_id ?? "");
    const split = fieldId.indexOf("__");
    // A capture whose field_id is unparseable cannot be adjudicated, and guessing which
    // field it belonged to would put a verdict against the wrong evidence.
    if (split <= 0) return [];
    return [{
      tenantId: parts[1],
      jobId: parts[3],
      stepId: fieldId.slice(0, split),
      fieldKey: fieldId.slice(split + 2),
      captureId: doc.id,
    }];
  });
}

/**
 * Steps a technician walked away from that no Foreman has ruled on.
 *
 * `deferred` keeps the job open and the machine held, and the contract is explicit that a step
 * "can never be silently abandoned". Until something read this, that promise rested on a
 * technician remembering — the step sat deferred, the machine sat held, and nobody was raised.
 *
 * THE QUERY IS ON `reason_kind`, NOT ON STATUS, and that is not a detail.
 * `LiveSource.declareBlocked` deliberately writes no status at all — its comment says why:
 * choosing between deferred, waived and impossible is the Foreman's disposition, and a client
 * writing one would be deciding something it has no standing to decide. So a step a technician
 * walked away from is still `pending`, and a sweep that looked for `deferred` would find only
 * the steps a Foreman had ALREADY ruled on, which is precisely the set that needs nothing.
 * What marks a stall is that somebody gave a reason.
 *
 * One `in` on one field, so the automatic single-field index serves it; no composite to deploy.
 * The two exclusions are applied HERE rather than in the query because a step written before
 * those fields existed has no key for them at all, and Firestore's `== null` matches an
 * explicit null but not an absent field — a query that looked right would silently skip exactly
 * the oldest stalls, which are the ones that most need raising.
 */
export interface StalledStep {
  tenantId: string;
  jobId: string;
  stepId: string;
}

/** The three statuses that finish a step. A settled step is not a stall, whatever was said. */
const SETTLED = new Set(["performed", "waived", "impossible"]);

export async function stalledSteps(limit = 25, scan = 300): Promise<StalledStep[]> {
  const snap = await adminDb()
    .collectionGroup("step_outcomes")
    // NEWEST FIRST, AND THIS IS THE WHOLE FIX.
    //
    // The first version filtered a page of 25 in code. A step a Foreman has already ruled on
    // still carries its reason forever, so it still matched — and once 25 disposed stalls
    // existed anywhere in the system the page came back full of them, every one was filtered
    // out, and NO NEW STALL WAS EVER PROCESSED AGAIN. The Foreman would have gone silent as the
    // product was used, with the sweep reporting a clean run the whole time. Starvation, and
    // the worst shape of it: it gets likelier the more the system works.
    //
    // Ordering by `reason_at` descending puts the newest deferral at the top, so a technician
    // who just walked away from a machine is picked up whatever the history behind them looks
    // like. It also does the filtering the `in` clause used to: a document with no `reason_at`
    // is not returned by an orderBy on that field at all, and "a technician gave a reason" is
    // exactly what having one means.
    //
    // One orderBy on one field, so the automatic single-field index serves it — a composite
    // would have to be deployed before the sweep worked, and a safety net nobody can turn on
    // is not a safety net.
    .orderBy("reason_at", "desc")
    .limit(scan)
    .get();

  const found: StalledStep[] = [];
  for (const doc of snap.docs) {
    if (found.length >= limit) break;
    const data = doc.data();
    if (data.disposition_action) continue;
    if (SETTLED.has(String(data.status))) continue;
    // tenants/{t}/jobs/{j}/step_outcomes/{s}
    const parts = doc.ref.path.split("/");
    if (parts.length !== 6) continue;
    found.push({ tenantId: parts[1], jobId: parts[3], stepId: doc.id });
  }
  return found;
}

/**
 * Procedures with enough finished work behind them to be worth reading, and no recent audit.
 *
 * The cadence is deliberately crude — a procedure is re-read when a week has passed. Auditing
 * on every sweep would ask a model to re-derive the same conclusion from the same forty jobs
 * every ten minutes, and the aggregate does not change that fast.
 *
 * Distinct procedures are found from the jobs rather than from a procedures collection,
 * because a procedure with no finished jobs is not auditable and would only be filtered out
 * again. One equality on one field; no composite index.
 */
export interface AuditDue {
  tenantId: string;
  procedureId: string;
}

const AUDIT_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

export async function proceduresDueAnAudit(limit = 3): Promise<AuditDue[]> {
  const snap = await adminDb()
    .collectionGroup("jobs")
    .where("status", "==", "sealed")
    .limit(300)
    .get();

  const seen = new Map<string, AuditDue>();
  for (const doc of snap.docs) {
    // tenants/{t}/jobs/{j}
    const parts = doc.ref.path.split("/");
    if (parts.length !== 4) continue;
    const procedureId = String(doc.data().procedure_id ?? "");
    if (!procedureId) continue;
    seen.set(`${parts[1]}/${procedureId}`, { tenantId: parts[1], procedureId });
  }

  const cutoff = Date.now() - AUDIT_EVERY_MS;
  const due: AuditDue[] = [];
  for (const candidate of seen.values()) {
    const last = await adminDb()
      .doc(`tenants/${candidate.tenantId}/audits/${candidate.procedureId}`)
      .get();
    const at = last.exists ? Date.parse(String(last.data()?.at ?? "")) : NaN;
    if (!Number.isNaN(at) && at > cutoff) continue;
    due.push(candidate);
    if (due.length >= limit) break;
  }
  return due;
}

/**
 * Jobs whose every step has settled and which nobody sealed.
 *
 * The same net that catches an undecided capture, one level up. A technician finishing the
 * last step and closing the app would otherwise leave a job that is complete, unsealed, and
 * therefore has no record — and the machine stays held by a Gate reading a record that was
 * never written.
 *
 * `status == "open"` and the pending check in memory, for the reason `stalledSteps` explains:
 * an inequality on a second field would need a composite index, and the set is small.
 */
export interface SealableJob {
  tenantId: string;
  jobId: string;
}

export async function sealableJobs(limit = 10): Promise<SealableJob[]> {
  const snap = await adminDb()
    .collectionGroup("jobs")
    .where("status", "==", "open")
    .limit(200)
    .get();

  const out: SealableJob[] = [];
  for (const doc of snap.docs) {
    // tenants/{t}/jobs/{j}
    const parts = doc.ref.path.split("/");
    if (parts.length !== 4) continue;
    const outcomes = await doc.ref.collection("step_outcomes").get();
    if (outcomes.empty) continue;
    if (outcomes.docs.some((o) => String(o.data().status ?? "pending") === "pending")) continue;
    out.push({ tenantId: parts[1], jobId: parts[3] });
    if (out.length >= limit) break;
  }
  return out;
}
