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
import { askFleet, askScreen, FleetUnreachable, type FleetReply } from "@/server/fleet";
import { decideOutcome, type Effect } from "./outcome";
import { inspectorCase, skepticCase, screenCase, mediaUri, referenceFieldId,
         type CaseSources } from "./cases";
import { actsOnScreen, inspectorVerdictFromScreen } from "./screen";
import { screenEvidence, type ArmorVerdict } from "./armor";
import { verifyIntegrity } from "./attest";
import { getStorage } from "firebase-admin/storage";
import { adminApp } from "@/auth/admin";
import { GoogleAuth } from "google-auth-library";
import { newTrace, withSpan } from "@/server/trace";
import { pinnedVersion } from "@/server/procedures";

export interface AdjudicateRef {
  tenantId: string;
  jobId: string;
  stepId: string;
  fieldKey: string;
  captureId: string;
  /**
   * The device's Play Integrity token, if it had one.
   *
   * Opaque to the client that carries it and verified here, because an attestation the
   * attested party can read is an attestation it can forge. firestore.rules refuses these
   * fields from any client, which is what makes that division real.
   */
  integrityToken?: string | null;
}

export interface Deps {
  ask?: typeof askFleet;
  /** The Gemma screen. A separate seam from `ask` because it is a separate fleet operation,
   *  and because a test needs to be able to disable the screen without stubbing the judge. */
  screen?: typeof askScreen;
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
  const screen = deps.screen ?? askScreen;
  const scopedJobId = `${ref.tenantId}/${ref.jobId}`;
  // One trace per capture. Everything below hangs under it, so the reasoning trace has the
  // shape of what actually happened rather than being a flat list of verdicts.
  const trace = newTrace();

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
  //
  // It WAS quietly broken: this asked for `procedure_versions/{procedure_id}`, with no version
  // segment, while `publishProcedure` freezes `{id}:{n}`. So the job's own `procedure_version`
  // — written at startJob precisely to record what it is pinned to — was never read, published
  // versions were never found, and the only document that resolved was the mutable one the
  // public-catalogue seed wrote. `pinnedVersion` honours the pin and falls back to the bare
  // document rather than stranding a job pinned to a version nobody froze.
  const version = (await pinnedVersion(
    db, ref.tenantId, String(job.procedure_id), job.procedure_version,
  )) ?? { steps: [] as any[] };
  const step = (version.steps ?? []).find((s: any) => s.id === ref.stepId);
  if (!step) throw new Error(`step ${ref.stepId} is not in the pinned procedure version`);
  const fieldDef = (step.fields ?? []).find((f: any) => f.key === ref.fieldKey);
  if (!fieldDef) throw new Error(`field ${ref.fieldKey} is not declared on step ${ref.stepId}`);

  // A reading, if a paired instrument produced one. Server-written and server-read; a client
  // never gets to claim that a number was measured.
  //
  // SCOPED TO THIS JOB, and that is not a refinement. `field_id` is `{stepId}__{fieldKey}`,
  // which is identical for every job running the same procedure — so a tenant-wide query with
  // `limit(1)` returned an arbitrary job's reading, and this job's field was credited with a
  // measurement taken on a different machine. Ordered newest-first for the same reason a
  // re-measured field should read as the number the technician actually left behind.
  const readingSnap = await db
    .collection(`tenants/${ref.tenantId}/readings`)
    .where("job_id", "==", ref.jobId)
    .where("field_id", "==", `${ref.stepId}__${ref.fieldKey}`)
    .get();
  const readingDoc = readingSnap.docs
    .map((d) => d.data())
    .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))[0] ?? null;

  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";

  // The earlier capture a `consistent_with` field is judged against.
  //
  // Read here rather than passed in, for the same reason every other fact in this function
  // is: a caller that could nominate the reference frame could nominate one that matches.
  // Newest wins, because a step that was retaken should be compared against what the
  // technician actually left on the record, not against the frame they replaced.
  const referenceId = referenceFieldId(fieldDef.acceptance_target);
  let referenceUris: string[] = [];
  if (referenceId && bucket) {
    const refSnap = await jobRef
      .collection("captures")
      .where("field_id", "==", referenceId)
      .get();
    const newest = refSnap.docs
      .map((d): Record<string, any> => ({ id: d.id, ...d.data() }))
      // Never the frame being judged. A target pointing at its own field is a procedure
      // defect, and comparing a photograph against itself would pass it every time.
      .filter((c) => c.id !== ref.captureId && c.kind !== "text")
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
    if (newest) {
      referenceUris = [
        mediaUri(bucket, newest as { id: string; kind: string }, ref.tenantId, ref.jobId),
      ];
    }
  }
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
    // What the technician typed or chose, when that is what the evidence IS. `text` is the
    // one capture kind with no object: media_ref carries the answer itself rather than a
    // path to it (contract/entities/capture.schema.json). The Inspector already renders this
    // as "What the technician entered" — it was simply never sent, so a typed step was judged
    // on no evidence at all.
    answer: capture.kind === "text" ? ((capture as { media_ref?: string }).media_ref ?? null) : null,
    // Skipped for `text`, which has nothing to point at. This guard was written before the
    // contract had a `text` kind, so it could never fire: the client labelled typed answers
    // `scan`, a URI was built for them, and Gemini was asked for a file nobody uploaded.
    mediaUris:
      bucket && capture.kind !== "text"
        ? [mediaUri(bucket, capture as { id: string; kind: string }, ref.tenantId, ref.jobId)]
        : [],
    // Evidence already on file for this machine.
    //
    // Reuse is the cheat this system exists to catch — the same photograph submitted for a job
    // that was never done — and the Skeptic cannot catch it without something to compare
    // against. This was an empty list for a long time, honestly labelled as one, which meant
    // the whole reuse question was being asked of an agent that had been shown nothing.
    //
    // Read here rather than passed in, like every other fact in this function: a caller that
    // could nominate the prior frames could nominate frames that match.
    priorMediaUris: await priorCaptures(db, ref, job.asset_id, bucket),
    referenceUris,
    asset: job.asset_id ? { id: job.asset_id } : null,
  };

  // Attestation first: it says what this evidence COULD prove, and it is written whether the
  // answer is yes or no. "fixture-device" used to sit in this field, which was a claim about
  // a check nobody had run.
  const attestation = await verifyIntegrity(
    ref.integrityToken ?? null,
    process.env.WARRANT_ANDROID_PACKAGE ?? "ink.warrant",
  );
  await jobRef.collection("captures").doc(ref.captureId).set(
    {
      attestation_play_integrity: attestation.verdict,
      // Null when Google gave none. Never a value the client supplied.
      attestation_device_id: attestation.deviceId,
    },
    { merge: true },
  );

  // Model Armor, BEFORE any model is shown the evidence.
  //
  // The Inspector is a model reading a picture chosen by the person being checked, which is
  // the textbook setting for prompt injection. A match means no model sees the image at all.
  const armor = await withSpan(trace, "armor.screen",
    { capture_id: ref.captureId, tenant: ref.tenantId },
    () => screenCapture(sources.mediaUris[0] ?? null));
  await jobRef
    .collection("captures")
    .doc(ref.captureId)
    .set({ armor_verdict: armor.verdict }, { merge: true });

  if (armor.verdict === "MATCH_FOUND") {
    const id = randomUUID();
    await db.doc(`tenants/${ref.tenantId}/decisions/${id}`).set({
      id, job_id: scopedJobId, step_id: ref.stepId,
      agent: "inspector",
      agent_version: process.env.WARRANT_FLEET_ENGINE?.split("/").pop() ?? "unknown",
      model: null, verdict: "REFUSED_BY_ARMOR", rationale: armor.detail,
      cost_usd: null, at: nowIso(),
    });
    await applyEffect(db, ref, step, job.strictness ?? 1, {
      kind: "escalate",
      question: `This evidence was refused before any model saw it. ${armor.detail}`,
    });
    await jobRef.collection("captures").doc(ref.captureId)
      .set({ adjudicated: true, adjudicated_at: nowIso() }, { merge: true });
    return { decisionIds: [id], effect: { kind: "escalate", question: armor.detail } };
  }

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

  // The Gemma screen, between Model Armor and the judge.
  //
  // ORDER IS NOT NEGOTIABLE: Armor, then the screen, then Flash. Gemma is a model reading a
  // picture chosen by the person being checked, so an image carrying an injection must not
  // reach it either — putting the cheap screen first to "save the Armor call" would hand the
  // untrusted frame straight to a model.
  //
  // What this buys and what it risks. The commonest reason a capture fails is not fraud, it is
  // a frame nobody could judge — dark, blurred, the subject out of shot. Those cost two Flash
  // calls and 40× the tokens to reach a conclusion a small model reaches by looking. So the
  // screen runs first and, when it is confident about a defect in the FRAME, the capture is
  // sent back and Flash is never asked. The risk is bounded by the schema: `EvidenceScreen`
  // has no answer meaning "satisfied", so the worst a wrong screen can do is ask a technician
  // for a photograph that was already good enough. It cannot pass a step.
  //
  // Only when there is something to look at. A field with no media has no frame to find a
  // defect in, and the Inspector's own "no media was captured" path is the one that should run.
  if (sources.mediaUris.length > 0) {
    let screened: FleetReply | null = null;
    try {
      screened = await withSpan(trace, "screen.gemma",
        { model: process.env.SCREENING_MODEL ?? "gemma-3-4b", field: ref.fieldKey,
          step: ref.stepId },
        () => screen(screenCase(sources)));
    } catch {
      // An unreachable screen is not a finding about the capture — unlike an unreachable
      // fleet, which is. Flash is asked exactly as it would have been and the only thing lost
      // is the saving, so this swallows deliberately rather than holding the step.
      screened = null;
    }

    if (screened && actsOnScreen(screened)) {
      await write(
        "screen",
        `UNUSABLE·${String(screened.output.defect ?? "unstated")}`,
        String(screened.output.rationale ?? "no rationale returned"),
        screened,
      );
      // Through the SAME gate as every Inspector verdict. The screen gets no gate of its own,
      // no budget of its own and no escalation path of its own — so a screen firing on a step
      // whose ADD FIELD budget is spent escalates to a person exactly as the Inspector would,
      // and the circuit breaker never has to know the screen exists.
      const screenEffect = decideOutcome({
        inspector: inspectorVerdictFromScreen(
          screened, { key: ref.fieldKey, kind: String(fieldDef.kind ?? "photo") }, addFieldsUsed),
        // Never asked, and it does not matter: `decideOutcome` consults the Skeptic only on a
        // PASS, and this path cannot produce one.
        skeptic: null,
        addFieldsUsed,
        maxAddFields: step.max_add_fields ?? 2,
        strictness: job.strictness ?? 1,
        acceptance: { rule: fieldDef.acceptance_rule, target: fieldDef.acceptance_target },
      });
      await withSpan(trace, "gate.apply",
        { effect: screenEffect.kind, verdict: "ADD_FIELD", screened_by: screened.model },
        () => applyEffect(db, ref, step, job.strictness ?? 1, screenEffect));
      await jobRef
        .collection("captures")
        .doc(ref.captureId)
        .set({ adjudicated: true, adjudicated_at: nowIso(),
               // What the ledger totals to show the saving: this capture was settled without
               // the judgement model being asked at all.
               screened_by: screened.model ?? null }, { merge: true });
      return { decisionIds, effect: screenEffect };
    }
  }

  let inspector: FleetReply;
  let skeptic: FleetReply | null = null;
  try {
    // Both questions at once. They are independent: one asks whether the evidence is good
    // enough, the other whether it is evidence of this machine at all.
    // Two spans, started together and ending independently. A flat audit log cannot show
    // that; a trace can, and "these two agents are asking different questions at the same
    // time" is the whole shape of this system in one picture.
    [inspector, skeptic] = await Promise.all([
      withSpan(trace, "agent.inspector",
        { agent: "inspector", field: ref.fieldKey, step: ref.stepId,
          strictness: job.strictness ?? 1 },
        () => ask("inspector", inspectorCase(sources))),
      withSpan(trace, "agent.skeptic",
        { agent: "skeptic", field: ref.fieldKey, step: ref.stepId,
          prior_media: sources.priorMediaUris.length },
        () => ask("skeptic", skepticCase(sources))),
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
    // Sets the confidence floor a PASS has to clear. The same number the Inspector was shown.
    strictness: job.strictness ?? 1,
    // The target the Inspector was deliberately NOT shown, so the comparison happens in code.
    acceptance: { rule: fieldDef.acceptance_rule, target: fieldDef.acceptance_target },
  });

  await withSpan(trace, "gate.apply",
    { effect: effect.kind, verdict: String(inspector.output.verdict ?? ""),
      confidence: typeof inspector.output.confidence === "number"
        ? inspector.output.confidence : null },
    () => applyEffect(db, ref, step, job.strictness ?? 1, effect));

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

/**
 * Earlier captures for the same machine, newest first.
 *
 * Bounded at four on purpose. Every one is an image the model reads, so this is the difference
 * between a second opinion that costs a fraction of a cent and one that costs real money on
 * every capture — and a technician resubmitting an old photograph reaches for a recent one,
 * not one from eighteen months ago. Four recent frames catch that; forty would mostly cost.
 *
 * Ordered in memory rather than by the query, so no composite index has to be deployed for a
 * safety net to start working.
 *
 * A job with no asset gets nothing, and that is correct rather than a limitation: the public
 * procedures name no machine, the Skeptic is told so, and it withdraws the asset question
 * entirely (see `skeptic.py:_subject`).
 */
async function priorCaptures(
  db: FirebaseFirestore.Firestore,
  ref: AdjudicateRef,
  assetId: string | null | undefined,
  bucket: string,
  limit = 4,
): Promise<string[]> {
  if (!assetId || !bucket) return [];

  const jobs = await db
    .collection(`tenants/${ref.tenantId}/jobs`)
    .where("asset_id", "==", assetId)
    .limit(12)
    .get();

  const earlier = jobs.docs
    .filter((d) => d.id !== ref.jobId)
    .sort((a, b) =>
      String(b.data().started_at ?? "").localeCompare(String(a.data().started_at ?? "")))
    .slice(0, limit);

  const uris: string[] = [];
  for (const jobDoc of earlier) {
    const caps = await jobDoc.ref.collection("captures").limit(limit).get();
    for (const cap of caps.docs) {
      const data = cap.data() as { kind?: string };
      // `text` has no object to point at, and a signature is not evidence of a machine.
      if (!data.kind || data.kind === "text") continue;
      uris.push(mediaUri(bucket, { id: cap.id, kind: data.kind }, ref.tenantId, jobDoc.id));
      if (uris.length >= limit) return uris;
    }
  }
  return uris;
}

/**
 * Download one capture and put it through Model Armor.
 *
 * The bytes have to come down for this — the fleet reads the object by URI and never needs
 * them here, so this is the one place that pays for the transfer. Worth it: it is the only
 * check standing between a photograph chosen by the person being verified and a model that
 * will read any text in it.
 *
 * Every failure path returns NOT_SCREENED. An unscreened capture recorded as clean is a lie
 * the record carries forever.
 */
async function screenCapture(
  gsUri: string | null,
): Promise<{ verdict: ArmorVerdict; detail: string }> {
  if (!gsUri) {
    return { verdict: "NOT_SCREENED", detail: "There was no media to screen." };
  }
  const without = gsUri.replace("gs://", "");
  const slash = without.indexOf("/");
  if (slash <= 0) {
    return { verdict: "NOT_SCREENED", detail: `Unreadable media reference: ${gsUri}` };
  }

  let bytes: Uint8Array;
  try {
    const [buf] = await getStorage(adminApp())
      .bucket(without.slice(0, slash))
      .file(without.slice(slash + 1))
      .download();
    bytes = new Uint8Array(buf);
  } catch (error) {
    return { verdict: "NOT_SCREENED", detail: `Could not read the evidence: ${String(error)}` };
  }

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

  return screenEvidence(bytes, token);
}
