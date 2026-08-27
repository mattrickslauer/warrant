// A number from an instrument.
//
// THIS IS THE ONLY WRITER OF `readings`, and that is the point of the whole endpoint.
// firestore.rules refuses `readings` from every client, refuses `capture_surface:
// "app_instrument"`, and refuses any `tool_id` on a field. So an instrumented capture cannot be
// a client write — it arrives here and is written under Admin credentials.
//
// TWO SEPARATE QUESTIONS, and they used to be conflated into one shared password:
//
//   MAY YOU WRITE HERE        the technician's verified session, like every other route. The
//                             tenant comes from the session and NEVER from the request.
//   DID A MACHINE MEASURE IT  the device's own HMAC over its own raw bytes, which the handset
//                             relays and cannot forge.
//
// What that replaced: `x-warrant-tool-key`, a shared secret held by the PHONE, with the tenant
// taken from the caller's own `job_id`. Admin credentials bypass firestore.rules, so one leaked
// key wrote `measured` readings into any tenant that existed — and a Workspace tenant id is a
// domain name, so there was nothing to guess. See server/instruments.ts for the full account.
//
// An unsigned reading is recorded WITHOUT a tool_id. It still reaches the form, and it cannot
// make anything `measured`: `classify()` and `earnedTier()` both key on tool_id, which is now
// only ever written when a device signed for the number.

import { NextResponse } from "next/server";
import { adminDb } from "@/auth/admin";
import { callerSession } from "@/auth/bearer";
import { identify, counterIsFresh, type SignedFrame } from "@/server/instruments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  job_id?: string;
  step_id?: string;
  field_key?: string;
  component_id?: string | null;
  key?: string;
  unit?: string;
  /**
   * The number the CALLER says it saw.
   *
   * Used only when nothing was attested — a device that does not sign, or the simulator. It is
   * recorded honestly as an unattested value and can never carry a tool_id, so it cannot make
   * anything `measured`. When a frame verifies, this field is ignored completely and the value
   * is decoded from the signed bytes instead, so a relay cannot carry one figure and report
   * another.
   */
  value?: number;
  /** The signed frame, straight off the instrument. */
  frame?: Partial<SignedFrame>;
}

export async function POST(request: Request) {
  const session = await callerSession(request);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { job_id, step_id, field_key, key, unit } = body;
  if (!job_id || !step_id || !field_key || !key || !unit) {
    return NextResponse.json(
      { error: "job_id, step_id, field_key, key and unit are required." },
      { status: 400 },
    );
  }
  const claimed = typeof body.value === "number" && Number.isFinite(body.value)
    ? body.value : null;
  if (claimed === null && !body.frame) {
    return NextResponse.json(
      { error: "A reading needs either a signed frame or a value." }, { status: 400 });
  }

  // The job id may arrive tenant-scoped (`acme.com/job_9`), which is how ids travel through the
  // DataSource interface. The tenant in it is CHECKED against the session rather than trusted —
  // it names which tenant the caller thinks they are in, and the session says which one they
  // are. Identical to `/api/jobs/seal`, on purpose: this route is no longer special.
  const slash = job_id.indexOf("/");
  const named = slash > 0 ? job_id.slice(0, slash) : null;
  const bareJobId = slash > 0 ? job_id.slice(slash + 1) : job_id;
  if (!bareJobId || bareJobId.includes("/")) {
    return NextResponse.json({ error: "job_id is not a job." }, { status: 400 });
  }
  if (named && named !== session.tenant.id) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const tenantId = session.tenant.id;
  const db = adminDb();
  const tenantRef = db.collection("tenants").doc(tenantId);
  const jobRef = tenantRef.collection("jobs").doc(bareJobId);

  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    return NextResponse.json({ error: "No such job." }, { status: 404 });
  }

  // --- the attestation -------------------------------------------------------------------
  //
  // Two questions, in order, because the second one needs the answer to the first.
  //
  //   WHO SIGNED IT   pure, no I/O. The tool id is derived from whichever registered secret
  //                   verifies, never read off the request — a caller cannot name the
  //                   instrument it wishes to be.
  //   IS IT FRESH     a transaction on that device's counter. "Has this frame been used" is a
  //                   read-then-write on a contended key, and two handsets relaying the same
  //                   broadcast frame is exactly the race.
  //
  // The counter lives in a top-level root, not under the tenant: the recursive read in
  // firestore.rules would otherwise let any tenant member watch their own instrument's counter,
  // and the next counter is precisely the input a forger is missing.
  const signed = identify(tenantId, body.frame);

  let outcome: { attested: true; toolId: string; value: number } | { attested: false; why: string } =
    signed.attested
      ? { attested: true, toolId: signed.toolId, value: signed.value }
      : { attested: false, why: signed.why };

  if (signed.attested) {
    const counterRef = db.collection("instrument_counters").doc(`${tenantId}:${signed.toolId}`);
    outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const stored = Number(snap.data()?.last_counter ?? NaN);
      const last = Number.isFinite(stored) ? stored : null;
      if (!counterIsFresh(last, signed.counter)) {
        return { attested: false as const, why: "This reading has already been used." };
      }
      tx.set(counterRef, {
        last_counter: signed.counter,
        tenant_id: tenantId,
        tool_id: signed.toolId,
        at: new Date().toISOString(),
      }, { merge: true });
      return { attested: true as const, toolId: signed.toolId, value: signed.value };
    });
  }

  // The timestamp is OURS. "When was this measured" is half of what a reading proves, and a
  // device that dated its own measurement could date it whenever suited.
  const at = new Date().toISOString();
  const fieldId = `${step_id}__${field_key}`;

  const readingRef = tenantRef.collection("readings").doc();
  const captureRef = jobRef.collection("captures").doc();
  const fieldRef = jobRef.collection("fields").doc(fieldId);

  const batch = db.batch();

  batch.set(readingRef, {
    schema_version: 1,
    id: readingRef.id,
    // THE JOB. `field_id` is `{stepId}__{fieldKey}`, identical for every job running the same
    // procedure, so without this one job's reading is credited to another job's field.
    job_id: bareJobId,
    field_id: fieldId,
    component_id: body.component_id ?? null,
    key,
    // Decoded from the SIGNED BYTES when a device signed, so the relay cannot alter it.
    // Otherwise the caller's claimed number, recorded because the technician still needs to see
    // it on the form — but with `tool_id` null below, which is the field that decides whether
    // anything may call it measured.
    value: outcome.attested ? outcome.value : claimed,
    unit,
    // THE WHOLE CLAIM. Written if and only if a registered device in THIS TENANT signed for
    // this number with a counter it had not already spent. `classify()` and `earnedTier()` read
    // exactly this field, so an unattested reading cannot reach `measured` or `instrumented`.
    tool_id: outcome.attested ? outcome.toolId : null,
    attested: outcome.attested,
    // Why not, in one line, kept for the record. An admitted gap beats a fabricated pass.
    attestation_detail: outcome.attested ? null : outcome.why,
    at,
  });

  batch.set(captureRef, {
    id: captureRef.id,
    field_id: fieldId,
    kind: "scan",
    media_ref: readingRef.id,
    capture_mode: "live",
    // Only reachable from here, and only for a frame a device actually signed. A client
    // presenting this string is refused by the rules; an unsigned relay must not claim the
    // instrument surface either, because that is the surface the tier is read from.
    capture_surface: outcome.attested ? "app_instrument" : "app",
    attestation_device_id: outcome.attested ? outcome.toolId : null,
    attestation_play_integrity: null,
    redacted: true,
    armor_verdict: null,
    // FALSE, not absent. Firestore cannot query for a missing field, so `where("adjudicated",
    // "==", false)` does not match a document that never had the key — and the sweep exists to
    // catch evidence no client stayed alive to have judged.
    adjudicated: false,
    created_at: at,
  });

  batch.set(fieldRef, {
    id: fieldId,
    step_id,
    key: field_key,
    kind: "measurement",
    value_number: outcome.attested ? outcome.value : claimed,
    unit,
    tool_id: outcome.attested ? outcome.toolId : null,
    captured_at: at,
    media_ref: captureRef.id,
    // Still null. Even here — the only path that CAN produce a measured value — the class is
    // stamped by the Seal, which recomputes it from the readings collection. A writer that
    // stamps its own conclusion is a writer nobody can check.
    provenance_class: null,
  }, { merge: true });

  await batch.commit();

  if (!outcome.attested) {
    // 202, not 400. The number IS on the record and the technician should see it; what it is
    // NOT is measured, and saying so plainly is the whole posture of this system. The Seal
    // recomputes the class from `readings`, finds no tool_id, and stamps `asserted`.
    return NextResponse.json(
      { reading_id: readingRef.id, field_id: fieldId, value: claimed,
        attested: false, why: outcome.why, at },
      { status: 202 },
    );
  }

  return NextResponse.json({
    reading_id: readingRef.id,
    field_id: fieldId,
    tool_id: outcome.toolId,
    value: outcome.value,
    attested: true,
    at,
  });
}
