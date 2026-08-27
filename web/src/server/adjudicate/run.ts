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
import { decideOutcome, type Effect, type DecidedEffect } from "./outcome";
import { inspectorCase, skepticCase, screenCase, mediaUri, referenceFieldId,
         type CaseSources } from "./cases";
import { actsOnScreen, inspectorVerdictFromScreen } from "./screen";
import { screenEvidence, screenText, type ArmorVerdict } from "./armor";
import { verifyIntegrity } from "./attest";
import { getStorage } from "firebase-admin/storage";
import { adminApp } from "@/auth/admin";
import { GoogleAuth } from "google-auth-library";
import { newTrace, withSpan } from "@/server/trace";
import { pinnedVersion } from "@/server/procedures";
import { sealIfFinished } from "@/server/seal";

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
  /** The screen. A separate seam from `ask` because it is a separate fleet operation,
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

/**
 * How many times one capture may fail to reach a verdict before a person is raised instead.
 *
 * THE SWEEP NEVER GAVE UP, AND THAT IS A COST, NOT A VIRTUE.
 *
 * `undecidedCaptures()` selects `adjudicated == false` oldest-first, and a failed adjudication
 * deliberately leaves the flag false — correctly, for the ordinary case of a fleet that was
 * briefly unreachable. But nothing distinguished "briefly" from "never". A capture that can
 * NEVER be judged — the object is not in the bucket, so Vertex answers 404 for as long as the
 * bucket stays the way it is — came back every sweep, for ever, and each attempt spent Model
 * Armor, a screen, an Inspector and a Skeptic on the same doomed frame. That is a
 * per-minute quota being paid, every ten minutes, to learn the same thing.
 *
 * It also starves the queue it is in. Oldest-first is the fair order for work that drains, and
 * these do not drain: fifty permanently-failing captures at the head of the queue are fifty
 * slots a new capture never reaches, so the safety net stops catching the thing it is for.
 *
 * The ceiling is therefore not a way to drop evidence quietly — `tasks.ts` is explicit that
 * nothing may be — it is the point where an automatic retry is admitted to be the wrong tool
 * and a named person is raised instead. The capture is marked decided so it leaves the queue,
 * and the decision on the record says exactly why, in the words of the last failure.
 */
const MAX_ADJUDICATION_ATTEMPTS = 4;

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

  // ALREADY DECIDED IS DECIDED.
  //
  // Nothing read this flag before running, so the same capture id could be submitted again and
  // again and each call re-ran Model Armor, the screen, the Inspector and the Skeptic. A
  // client is allowed to trigger adjudication — that is the whole design — which means a client
  // is also allowed to trigger it twice, and a retry after a dropped response is the ordinary
  // case rather than an attack.
  //
  // Safe against the sweep, which is the other caller: `undecidedCaptures()` selects on
  // `adjudicated == false`, and a failed adjudication deliberately leaves the flag false so it
  // is picked up again. Only a capture that reached a verdict is skipped here.
  if (capture.adjudicated === true) {
    const prior = await db
      .collection(`tenants/${ref.tenantId}/decisions`)
      .where("job_id", "==", scopedJobId)
      .where("capture_id", "==", ref.captureId)
      .get();
    return {
      decisionIds: prior.docs.map((d) => d.id),
      effect: { kind: "already_decided" } as const,
    };
  }
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
  // The pinned version AND whatever this job's own adjudication has since added.
  //
  // A field the fleet asked for mid-job lives on the step outcome, not in the frozen
  // procedure — `added_fields` is written a few hundred lines below and was, until now, only
  // ever read back to count it. So this lookup searched the pinned version alone, and every
  // capture answering an added field threw "not declared on step" before it could be judged:
  // the capture stayed `adjudicated: false`, the outcome stayed `pending`, and the job could
  // never reach a performed step however many photographs the technician sent. The fleet asked
  // for one more picture and then could not look at it.
  //
  // Declared first on purpose. An added field can never shadow the procedure's own — the
  // version a job pinned stays the thing it is judged against.
  const fieldDef = ((step.fields ?? []) as any[]).find((f: any) => f.key === ref.fieldKey)
    ?? ((outcome.added_fields ?? []) as any[]).find((f: any) => f.key === ref.fieldKey);
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
  // The Inspector is a model reading evidence chosen by the person being checked, which is the
  // textbook setting for prompt injection. A match means no model sees it at all.
  //
  // BOTH KINDS OF EVIDENCE, and for a while it was only one. `screenCapture` takes a `gs://`
  // URI, and a `text` capture has none — `mediaUris` is empty for it — so the screen returned
  // NOT_SCREENED and waved it through, while `sources.answer` carried the technician's typed
  // string VERBATIM into the Inspector's prompt (cases.ts renders it as "What the technician
  // entered"). So the one capture kind whose content is free-form attacker-chosen text was the
  // one kind that was never screened for attacker-chosen text.
  //
  // That matters more here than anywhere else in the system: the Inspector's verdict is what
  // turns a step `performed`, and `performed` is what releases a machine. firestore.rules
  // refuses `performed` from every client precisely so the person being checked cannot settle
  // their own work — and steering the model that settles it is the same authority by a longer
  // route. `dispose.ts` already screens a blocker transcript for exactly this reason; this is
  // the same argument applied to the evidence itself.
  const armor = await withSpan(trace, "armor.screen",
    { capture_id: ref.captureId, tenant: ref.tenantId, kind: String(capture.kind ?? "") },
    () => (capture.kind === "text"
      ? screenAnswer(sources.answer ?? "")
      : screenCapture(sources.mediaUris[0] ?? null)));
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

  // The screen, between Model Armor and the judge.
  //
  // ORDER IS NOT NEGOTIABLE: Armor, then the screen, then Flash. The screen is a model reading a
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
      screened = await withSpan(trace, "screen",
        { model: process.env.SCREENING_MODEL ?? "gemini-3.5-flash-lite", field: ref.fieldKey,
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
        acceptance: {
          rule: fieldDef.acceptance_rule, target: fieldDef.acceptance_target,
          min: fieldDef.acceptance_min, max: fieldDef.acceptance_max,
          unit: fieldDef.acceptance_unit,
        },
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

  // Whether belonging is a question that can be put about this capture at all.
  //
  // A `text` capture is an ANSWER — a choice tapped, a note typed, a name signed — and it
  // carries no frame, no place and no moment to compare against anything. The Skeptic reasons
  // from image content, capture metadata and perceptual distance to earlier photographs, and
  // is instructed to dissent when it cannot establish identity. Handed an answer it therefore
  // dissented every single time, and escalated steps that had been answered correctly: a
  // technician tapped "Responsive and quiet" and was told the evidence might not belong to
  // the job. It also cost a model call per answer to produce that.
  //
  // The discriminator is the capture KIND and deliberately not "did any media arrive". A
  // photo field whose capture reached us with nothing attached is a real anomaly and the
  // Skeptic must still be asked and must still dissent — there is an eval scenario pinning
  // exactly that. What is excluded here is the kind of evidence that never has a scene, not
  // the occasion where a scene went missing.
  //
  // Same discriminator the Model Armor branch above already uses, for the same reason.
  const isAnswer = capture.kind === "text";

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
      isAnswer
        ? Promise.resolve(null)
        : withSpan(trace, "agent.skeptic",
          { agent: "skeptic", field: ref.fieldKey, step: ref.stepId,
            prior_media: sources.priorMediaUris.length },
          () => ask("skeptic", skepticCase(sources))),
    ]);
  } catch (error) {
    // Never silent. An unreachable fleet is a fact about this capture, and the identity trap
    // makes a 403 look exactly like a model that does not exist.
    const principal = error instanceof FleetUnreachable ? error.principal : null;
    const why = `The fleet could not be reached${principal ? ` as ${principal}` : ""}: ${
      error instanceof Error ? error.message : String(error)}`;
    await write("inspector", "engine_unreachable", why, null);

    // Count it. See MAX_ADJUDICATION_ATTEMPTS for why a retry that never ends is not free.
    const attempts = Number(capture.adjudication_attempts ?? 0) + 1;
    const capRef = jobRef.collection("captures").doc(ref.captureId);

    if (attempts >= MAX_ADJUDICATION_ATTEMPTS) {
      // Out of retries, so this stops being a machine's problem and becomes a person's. The
      // capture leaves the sweep's queue — `adjudicated: true` — but nothing about it is
      // accepted: the step does not pass, the question is on the record, and the reason is
      // the last failure verbatim rather than a tidy summary of it.
      await write(
        "inspector",
        "unjudgeable",
        `This evidence could not be judged after ${attempts} attempts, so it has been raised ` +
          `for a person rather than retried again. Last failure: ${why}`,
        null,
      );
      const question =
        `This capture could not be judged after ${attempts} attempts and needs a person. ${why}`;
      await withSpan(trace, "gate.apply",
        { effect: "escalate", verdict: "unjudgeable", confidence: null },
        () => applyEffect(db, ref, step, job.strictness ?? 1,
          { kind: "escalate", question }));
      await capRef.set(
        { adjudicated: true, adjudicated_at: nowIso(), adjudication_attempts: attempts },
        { merge: true },
      );
      return { decisionIds, effect: { kind: "escalate", question } };
    }

    // Still within budget: NOT marked adjudicated, so the sweep picks this up and tries again.
    await capRef.set({ adjudication_attempts: attempts }, { merge: true });
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
    // "Not applicable" and "could not be asked" are opposite conclusions — the first accepts,
    // the second holds — so an answer must never fall through to the null branch.
    skeptic: isAnswer
      ? "not_applicable"
      : skeptic ? { output: skeptic.output, valid: skeptic.valid } : null,
    addFieldsUsed,
    maxAddFields: step.max_add_fields ?? 2,
    // Sets the confidence floor a PASS has to clear. The same number the Inspector was shown.
    strictness: job.strictness ?? 1,
    // The target the Inspector was deliberately NOT shown, so the comparison happens in code —
    // and the BAND, which it was shown and which nothing ever checked. See the `within` block
    // in outcome.ts: a measured value the model was free to wave through was not measured.
    acceptance: {
      rule: fieldDef.acceptance_rule, target: fieldDef.acceptance_target,
      min: fieldDef.acceptance_min, max: fieldDef.acceptance_max,
      unit: fieldDef.acceptance_unit,
    },
    // What the instrument actually reported, so `within` is settled by arithmetic here rather
    // than by the Inspector's opinion of a number a tool had already answered exactly.
    reading: sources.reading ?? null,
    // Set only for a `text` capture — see `sources.answer`. It is what makes a `matches` rule
    // decidable on an answer at all, without a model being asked to read something that was
    // never a picture.
    answer: sources.answer ?? null,
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
  effect: DecidedEffect,
): Promise<void> {
  const outRef = db.doc(
    `tenants/${ref.tenantId}/jobs/${ref.jobId}/step_outcomes/${ref.stepId}`,
  );

  // Set inside the transaction, read after it commits. A step that just reached `performed`
  // may be the last one the job was waiting for, and the seal that follows is triggered from
  // here rather than from a phone — see `sealIfFinished`.
  let settled = false;

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
      // A step whose fields are ALL optional at this strictness has nothing in `required`, and
      // the old `required.length > 0 &&` made that step impossible to perform: every capture
      // was accepted and the step stayed pending for ever. Inside this branch a field has just
      // been accepted, so the step demonstrably has fields and somebody demonstrably did the
      // work — one accepted capture is the whole of what was asked for, and the step is done.
      const complete = required.length === 0 || required.every((k) => accepted.has(k));
      settled = complete;

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
    // The last step of the job may have just landed. Nothing downstream depends on this
    // returning, and a job with steps still pending is the ordinary answer.
    if (settled) await sealIfFinished(ref.tenantId, ref.jobId, db);
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
/**
 * Screen a TYPED answer, on the same template as a photograph.
 *
 * Same posture as `screenCapture` in every respect that matters: every failure path returns
 * NOT_SCREENED, and NOT_SCREENED is not a pass — it is an admitted gap recorded on the capture.
 * An empty answer is genuinely nothing to screen and says so rather than reporting a gap.
 */
async function screenAnswer(text: string): Promise<{ verdict: ArmorVerdict; detail: string }> {
  if (!text.trim()) {
    return { verdict: "NO_MATCH_FOUND", detail: "There was no answer to screen." };
  }
  return screenText(text, await armorToken());
}

/** The credential Model Armor is reached with. Absent is an ordinary state, not an error. */
async function armorToken(): Promise<string | null> {
  try {
    const client = await new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }).getClient();
    const t = await client.getAccessToken();
    return typeof t === "string" ? t : (t?.token ?? null);
  } catch {
    return null;
  }
}

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

  return screenEvidence(bytes, await armorToken());
}
