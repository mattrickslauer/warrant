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
  tenant_id?: string;
  job_id?: string;
  step_id?: string;
  field_key?: string;
  component_id?: string | null;
  key?: string;
  value?: number;
  unit?: string;
  tool_id?: string;
  at?: string;
}

/**
 * Device pairing, not user session.
 *
 * A paired instrument has no Google account. It presents a secret issued when it was paired,
 * and the comparison is constant-time because a timing oracle on this check would let someone
 * discover the secret that mints measured values.
 */
function pairedDevice(request: Request): string | null {
  const presented = request.headers.get("x-warrant-tool-key");
  const expected = process.env.WARRANT_INSTRUMENT_KEY;
  if (!presented || !expected) return null;

  // Hash both sides first so the compared buffers are always the same length — timingSafeEqual
  // throws on a length mismatch, and that throw is itself an oracle.
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) return null;

  return request.headers.get("x-warrant-tool-id");
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

  const { tenant_id, job_id, step_id, field_key, key, value, unit } = body;
  if (!tenant_id || !job_id || !step_id || !field_key || !key || !unit) {
    return NextResponse.json(
      { error: "tenant_id, job_id, step_id, field_key, key and unit are required." },
      { status: 400 },
    );
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return NextResponse.json({ error: "value must be a finite number." }, { status: 400 });
  }

  const at = body.at ?? new Date().toISOString();
  const fieldId = `${step_id}__${field_key}`;
  const db = adminDb();
  const tenantRef = db.collection("tenants").doc(tenant_id);
  const jobRef = tenantRef.collection("jobs").doc(job_id);

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
