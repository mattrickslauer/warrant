import "server-only";

// Evidence in, decision out.
//
// Called by POST /api/adjudicate today and, if an Eventarc Firestore trigger is added later,
// by that too — which is why it takes a capture REFERENCE and re-reads every fact itself. A
// caller that could hand the Inspector its own copy of the acceptance rule could pass
// anything it liked.
//
// Runs under Admin credentials, which BYPASS firestore.rules. So the tenant must arrive from
// a verified session — the route's job — and never from a request body.

import { randomUUID } from "node:crypto";
import { adminDb } from "@/auth/admin";
import { askFleet, FleetUnreachable, type FleetReply } from "@/server/fleet";
import { decideOutcome, type Effect } from "./outcome";
import { inspectorCase, skepticCase, mediaUri, type CaseSources } from "./cases";

export interface AdjudicateRef {
  tenantId: string;
  jobId: string;
  stepId: string;
  fieldKey: string;
  captureId: string;
}

export interface Deps {
  ask?: typeof askFleet;
  db?: FirebaseFirestore.Firestore;
}

/**
 * Rough, and labelled rough.
 *
 * Gemini 3.5 Flash list pricing, blended across input and output because a decision costing
 * a thousandth of a cent does not need a two-decimal breakdown — it needs to be VISIBLE, so
 * the operator view can total it and a reader of a record can see what the verdict cost.
 */
const USD_PER_1K_TOKENS = 0.0003;

function costOf(reply: FleetReply): number {
  const total = reply.usage?.totalTokenCount ?? 0;
  return Number(((total / 1000) * USD_PER_1K_TOKENS).toFixed(6));
}

const nowIso = () => new Date().toISOString();

export async function adjudicate(
  ref: AdjudicateRef,
  deps: Deps = {},
): Promise<{ decisionIds: string[]; effect: Effect }> {
  const db = deps.db ?? adminDb();
  const ask = deps.ask ?? askFleet;
  const scopedJobId = `${ref.tenantId}/${ref.jobId}`;

  const jobRef = db.doc(`tenants/${ref.tenantId}/jobs/${ref.jobId}`);
  const [jobSnap, capSnap, outSnap] = await Promise.all([
    jobRef.get(),
    jobRef.collection("captures").doc(ref.captureId).get(),
    jobRef.collection("step_outcomes").doc(ref.stepId).get(),
  ]);
  if (!jobSnap.exists) throw new Error(`no such job: ${scopedJobId}`);
  if (!capSnap.exists) throw new Error(`no such capture: ${ref.captureId}`);

  const job = jobSnap.data()!;
  const capture: Record<string, any> = { id: capSnap.id, ...capSnap.data()! };
  const outcome = outSnap.exists ? outSnap.data()! : {};
  const addFieldsUsed = outcome.add_fields_used ?? 0;

  // The PINNED version, never the live procedure. A job is judged against the rules it
  // started under, and this is the line where that promise is kept or quietly broken.
  const versionSnap = await db
    .doc(`tenants/${ref.tenantId}/procedure_versions/${job.procedure_id}`)
    .get();
  const version = versionSnap.exists ? versionSnap.data()! : { steps: [] };
  const step = (version.steps ?? []).find((s: any) => s.id === ref.stepId);
  if (!step) throw new Error(`step ${ref.stepId} is not in the pinned procedure version`);
  const fieldDef = (step.fields ?? []).find((f: any) => f.key === ref.fieldKey);
  if (!fieldDef) throw new Error(`field ${ref.fieldKey} is not declared on step ${ref.stepId}`);

  // A reading, if a paired instrument produced one. Server-written and server-read; a client
  // never gets to claim that a number was measured.
  const readingSnap = await db
    .collection(`tenants/${ref.tenantId}/readings`)
    .where("field_id", "==", `${ref.stepId}__${ref.fieldKey}`)
    .limit(1)
    .get();
  const readingDoc = readingSnap.empty ? null : readingSnap.docs[0].data();

  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";
  const sources: CaseSources = {
    step,
    fieldDef,
    capture,
    job: { ...job, id: scopedJobId, procedure: job.procedure_id },
    strictness: job.strictness ?? 1,
    addFieldsUsed,
    reading: readingDoc
      ? {
          value: readingDoc.value,
          unit: readingDoc.unit,
          // tool_id is what separates a measured number from a typed one, and it can only
          // have been written by POST /api/ingest/reading.
          source: readingDoc.tool_id ? "instrument" : "human",
        }
      : null,
    answer: null,
    mediaUris:
      bucket && capture.kind !== "text"
        ? [mediaUri(bucket, capture as { id: string; kind: string }, ref.tenantId, ref.jobId)]
        : [],
    // Empty for now. Reuse detection needs earlier captures for the same asset, which is a
    // query worth its own task — and an empty list is honest, where a fabricated one is not.
    priorMediaUris: [],
    asset: job.asset_id ? { id: job.asset_id } : null,
  };

  const decisionIds: string[] = [];
  const write = async (
    agent: string,
    verdict: string,
    rationale: string,
    reply: FleetReply | null,
  ): Promise<void> => {
    const id = randomUUID();
    await db.doc(`tenants/${ref.tenantId}/decisions/${id}`).set({
      id,
      job_id: scopedJobId,
      step_id: ref.stepId,
      agent,
      // Which fleet decided. The sealed record stamps this so a dispute months later can
      // say which version of which agent produced the verdict.
      agent_version: process.env.WARRANT_FLEET_ENGINE?.split("/").pop() ?? "unknown",
      model: reply?.model ?? null,
      verdict,
      rationale,
      cost_usd: reply ? costOf(reply) : null,
      at: nowIso(),
    });
    decisionIds.push(id);
  };

  let inspector: FleetReply;
  let skeptic: FleetReply | null = null;
  try {
    // Both questions at once. They are independent: one asks whether the evidence is good
    // enough, the other whether it is evidence of this machine at all.
    [inspector, skeptic] = await Promise.all([
      ask("inspector", inspectorCase(sources)),
      ask("skeptic", skepticCase(sources)),
    ]);
  } catch (error) {
    // Never silent. An unreachable fleet is a fact about this capture, and the identity trap
    // makes a 403 look exactly like a model that does not exist.
    const principal = error instanceof FleetUnreachable ? error.principal : null;
    await write(
      "inspector",
      "engine_unreachable",
      `The fleet could not be reached${principal ? ` as ${principal}` : ""}: ${
        error instanceof Error ? error.message : String(error)}`,
      null,
    );
    // Deliberately NOT marked adjudicated — the sweep must pick this up and try again.
    return { decisionIds, effect: { kind: "hold", why: "the fleet could not be reached" } };
  }

  await write(
    "inspector",
    String(inspector.output.verdict ?? "invalid"),
    String(
      inspector.output.rationale ??
        (inspector.schemaErrors.join("; ") || "no rationale returned"),
    ),
    inspector,
  );
  if (skeptic) {
    await write(
      "skeptic",
      skeptic.output.belongs === true ? "BELONGS" : "DISSENT",
      String(skeptic.output.rationale ?? "no rationale returned"),
      skeptic,
    );
  }

  const effect = decideOutcome({
    inspector: {
      output: inspector.output,
      valid: inspector.valid,
      schemaErrors: inspector.schemaErrors,
    },
    skeptic: skeptic ? { output: skeptic.output, valid: skeptic.valid } : null,
    addFieldsUsed,
    maxAddFields: step.max_add_fields ?? 2,
  });

  await applyEffect(db, ref, step, job.strictness ?? 1, effect);

  // The sweep's flag, set only after the decisions are written. A crash mid-adjudication
  // therefore leaves the capture eligible to be picked up again rather than silently
  // undecided — the failure mode that would make the safety net decorative.
  await jobRef
    .collection("captures")
    .doc(ref.captureId)
    .set({ adjudicated: true, adjudicated_at: nowIso() }, { merge: true });

  return { decisionIds, effect };
}

/**
 * The only place a step moves.
 *
 * Provenance is untouched here and must stay that way. The Seal decides `measured` /
 * `specified` / `inferred` / `asserted`, recomputed from the server-written `readings`
 * collection — so an Inspector PASS on a typed number still seals `asserted`, and nothing in
 * this function can change that.
 *
 * Note what is NOT here: an "escalated" status. The contract's enum is
 * pending/performed/deferred/waived/impossible, and that is right — an escalation is a
 * decision awaited, not a state the step has reached. A step with a question outstanding has
 * still not been performed, so it stays pending and carries the question.
 */
async function applyEffect(
  db: FirebaseFirestore.Firestore,
  ref: AdjudicateRef,
  step: any,
  strictness: number,
  effect: Effect,
): Promise<void> {
  const outRef = db.doc(
    `tenants/${ref.tenantId}/jobs/${ref.jobId}/step_outcomes/${ref.stepId}`,
  );

  if (effect.kind === "accept_field") {
    // One field passing is not a step passing. A step is performed only when EVERY field
    // required at this strictness has been accepted — including the ones an agent appended,
    // which are as required as the declared ones. Getting this wrong would let a seven-field
    // step seal on its first photograph, which is precisely the tick in the box.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(outRef);
      const data = snap.data() ?? {};
      const accepted = new Set<string>([...(data.accepted_fields ?? []), ref.fieldKey]);

      const declared = (step.fields ?? [])
        .filter((f: any) => (f.required_at_strictness ?? 0) <= strictness)
        .map((f: any) => f.key);
      const added = (data.added_fields ?? []).map((f: any) => f.key);
      const required = [...new Set<string>([...declared, ...added])];
      const complete = required.length > 0 && required.every((k) => accepted.has(k));

      tx.set(
        outRef,
        {
          accepted_fields: [...accepted],
          ...(complete ? { status: "performed" } : {}),
          hold_reason: null,
          escalation_question: null,
          adjudicated_at: nowIso(),
        },
        { merge: true },
      );
    });
    return;
  }

  if (effect.kind === "add_field") {
    // A transaction because two captures on one step can land together, and a lost increment
    // here is an add-field budget that never runs out.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(outRef);
      const data = snap.data() ?? {};
      tx.set(
        outRef,
        {
          status: "pending",
          add_fields_used: (data.add_fields_used ?? 0) + 1,
          added_fields: [
            ...(data.added_fields ?? []),
            {
              key: effect.key,
              kind: effect.fieldKind,
              prompt: effect.prompt,
              source: "camera",
              // As required as anything the procedure declared. An agent does not ask for
              // evidence it is willing to do without.
              required_at_strictness: 0,
              acceptance_rule: "must_show",
            },
          ],
          hold_reason: null,
          adjudicated_at: nowIso(),
        },
        { merge: true },
      );
    });
    return;
  }

  if (effect.kind === "escalate") {
    await outRef.set(
      {
        status: "pending",
        escalation_question: effect.question,
        hold_reason: null,
        adjudicated_at: nowIso(),
      },
      { merge: true },
    );
    return;
  }

  // hold — the step does not move, and the reason is on the record rather than in a log.
  await outRef.set({ hold_reason: effect.why, adjudicated_at: nowIso() }, { merge: true });
}
