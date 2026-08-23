// A number from a paired instrument.
//
// THIS IS THE ONLY WRITER OF `readings`, and that is the point of the whole endpoint.
//
// firestore.rules refuses `capture_surface: "app_instrument"`, any `tool_id` on a field, and
// any write to `readings` from a client. So an instrumented capture cannot be a client write —
// it arrives here, authenticated by the device pairing rather than by the technician's
// session, and this handler writes the reading and the capture under Admin credentials.
//
// That is not a workaround for the rule. It is what makes the rule true. Because this is the
// only path that can create a `reading`, "a reading exists with this field_id and a tool_id"
// is a claim only a paired instrument can cause to be true — which is exactly what the Seal
// checks when it decides whether a field is `measured`. A tool_id that reached a field
// document by any other route resolves to nothing and stamps `asserted`.
//
// The technician's client never asserts that a number was measured. It watches the reading
// appear, which is what SCRIPT.md shot 23c shows: "lands in the record on its own. Nobody
// typed it."

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { adminDb } from "@/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  job_id?: string;
  step_id?: string;
  field_key?: string;
  component_id?: string | null;
  key?: string;
  value?: number;
  unit?: string;
}

/**
 * Device pairing, not user session.
 *
 * A paired instrument has no Google account. It presents a secret issued when it was paired,
 * and the comparison is constant-time because a timing oracle on this check would let someone
 * discover the secret that mints measured values.
 *
 * THE KEY IS PER DEVICE, and it did not used to be. One global `WARRANT_INSTRUMENT_KEY`
 * authenticated every instrument in every tenant, and the caller then NAMED its own tool_id in
 * a header — so the identity of the instrument, which is the only thing separating a measured
 * number from a typed one, was self-asserted by whoever held one shared secret. Pairing means
 * a device has an identity; a shared password is not one.
 *
 * `WARRANT_INSTRUMENT_KEYS` is `toolId:secret` pairs, comma-separated. The tool_id is looked
 * UP from the secret rather than read off the request, so a device can only ever speak as
 * itself. The old single-key variable is still honoured as `tool_id` = `WARRANT_INSTRUMENT_ID`
 * (or `instrument-0`) so an existing deployment keeps working, but it names one device now
 * rather than authorising any.
 */
function pairedDevice(request: Request): string | null {
  const presented = request.headers.get("x-warrant-tool-key");
  if (!presented) return null;

  const pairs: Array<[string, string]> = [];
  for (const entry of (process.env.WARRANT_INSTRUMENT_KEYS ?? "").split(",")) {
    const colon = entry.indexOf(":");
    if (colon <= 0) continue;
    const toolId = entry.slice(0, colon).trim();
    const secret = entry.slice(colon + 1).trim();
    if (toolId && secret) pairs.push([toolId, secret]);
  }
  const legacy = process.env.WARRANT_INSTRUMENT_KEY;
  if (legacy) pairs.push([process.env.WARRANT_INSTRUMENT_ID ?? "instrument-0", legacy]);

  // Hash both sides first so the compared buffers are always the same length — timingSafeEqual
  // throws on a length mismatch, and that throw is itself an oracle. Every candidate is
  // compared even after a match, so the number of configured devices does not leak either.
  const a = createHash("sha256").update(presented).digest();
  let matched: string | null = null;
  for (const [toolId, secret] of pairs) {
    const b = createHash("sha256").update(secret).digest();
    if (timingSafeEqual(a, b)) matched = matched ?? toolId;
  }
  return matched;
}

export async function POST(request: Request) {
  const toolId = pairedDevice(request);
  if (!toolId) {
    return NextResponse.json({ error: "Unpaired device." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { job_id, step_id, field_key, key, value, unit } = body;
  if (!job_id || !step_id || !field_key || !key || !unit) {
    return NextResponse.json(
      { error: "job_id, step_id, field_key, key and unit are required." },
      { status: 400 },
    );
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return NextResponse.json({ error: "value must be a finite number." }, { status: 400 });
  }

  // THE TENANT IS NOT IN THE BODY, and that is the fix this handler most needed.
  //
  // It used to be: `tenant_id` arrived as a field and was used unchecked to address the write.
  // Admin credentials bypass firestore.rules, so anyone holding the instrument key could mint
  // a measured reading into ANY tenant, on any job id — a cross-tenant write behind one shared
  // secret. The tenant now comes from the job id, exactly as `/api/adjudicate` takes it, and
  // the job has to exist before anything is written to it.
  const slash = job_id.indexOf("/");
  if (slash <= 0) {
    return NextResponse.json({ error: "job_id must be tenant-scoped." }, { status: 400 });
  }
  const tenantId = job_id.slice(0, slash);
  const bareJobId = job_id.slice(slash + 1);
  if (!bareJobId || bareJobId.includes("/")) {
    return NextResponse.json({ error: "job_id must be tenant-scoped." }, { status: 400 });
  }

  // The timestamp is OURS. It used to be `body.at ?? now`, which let the device date its own
  // measurement — and "when was this measured" is half of what a reading proves.
  const at = new Date().toISOString();
  const fieldId = `${step_id}__${field_key}`;
  const db = adminDb();
  const tenantRef = db.collection("tenants").doc(tenantId);
  const jobRef = tenantRef.collection("jobs").doc(bareJobId);

  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    // Deliberately the same answer as an unknown tenant. A device probing for which tenants
    // exist learns nothing from the difference.
    return NextResponse.json({ error: "No such job." }, { status: 404 });
  }

  // The reading is FLAT, at /tenants/{t}/readings, not nested under a component. A nested
  // collection binds a {document=**} wildcard to its OUTER name and would escape the
  // server-written list entirely — which would mean any tenant member could POST a fabricated
  // measured value. See specs/2026-08-20-firestore-design.md §14.5.
  const readingRef = tenantRef.collection("readings").doc();
  const captureRef = jobRef.collection("captures").doc();
  const fieldRef = jobRef.collection("fields").doc(fieldId);

  const batch = db.batch();

  batch.set(readingRef, {
    schema_version: 1,
    id: readingRef.id,
    // THE JOB. Without it a reading is addressable only by `field_id`, which is
    // `{stepId}__{fieldKey}` — identical for every job running the same procedure. The Seal
    // and the Inspector both look a reading up by field, so one job's instrument reading was
    // being credited to another job's field. The number that separates `measured` from typed
    // has to know which job it measured.
    job_id: bareJobId,
    field_id: fieldId,
    component_id: body.component_id ?? null,
    key, value, unit,
    tool_id: toolId,
    at,
  });

  batch.set(captureRef, {
    id: captureRef.id,
    field_id: fieldId,
    kind: "scan",
    media_ref: readingRef.id,
    capture_mode: "live",
    // Only reachable from here. A client presenting this string is refused by the rules.
    capture_surface: "app_instrument",
    attestation_device_id: toolId,
    attestation_play_integrity: null,
    redacted: true,
    armor_verdict: null,
    // FALSE, not absent. Firestore cannot query for a missing field, so `where("adjudicated",
    // "==", false)` does not match a document that never had the key — and this route was the
    // one writer that omitted it, which made every instrument capture invisible to the sweep
    // that exists to catch evidence no client stayed alive to have judged.
    adjudicated: false,
    created_at: at,
  });

  batch.set(fieldRef, {
    id: fieldId,
    step_id,
    key: field_key,
    kind: "measurement",
    value_number: value,
    unit,
    tool_id: toolId,
    captured_at: at,
    media_ref: captureRef.id,
    // Still null. Even here — the only path that CAN produce a measured value — the class is
    // stamped by the Seal, which recomputes it from the readings collection. A writer that
    // stamps its own conclusion is a writer nobody can check.
    provenance_class: null,
  }, { merge: true });

  await batch.commit();

  return NextResponse.json({
    reading_id: readingRef.id,
    field_id: fieldId,
    tool_id: toolId,
    at,
  });
}
