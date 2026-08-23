// Put the public procedures into a tenant, so a stranger can actually run one.
//
// The five public tasks are bundled on every surface — the picker is the same on the web and
// on the phone deliberately, because a judge who runs the browser task and then installs the
// app must land on the same five. But a bundled PICKER is not a bundled PROCEDURE: a job has
// to be judged against a version frozen in Firestore, and `procedure_versions` is one of the
// collections firestore.rules refuses to every client.
//
// That refusal is correct and is the reason this route exists rather than the client simply
// writing what it already has in its own binary. A client that could write its own frozen
// version could rewrite the acceptance rule it is about to be judged against.
//
// Idempotent, and it will only ever write the PUBLIC catalogue. It is not a general import.

import { NextResponse } from "next/server";
import { callerSession } from "@/auth/bearer";
import { adminDb } from "@/auth/admin";
import { cutABanana, pickUpAnObject, frontBrakeService } from "@/data/fixtures/procedures";
import type { Procedure } from "@/generated/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The public catalogue, by id. Nothing outside this map can be seeded by this route. */
const PUBLIC: Record<string, Procedure> = {
  proc_banana_v1: cutABanana,
  proc_pickup_v1: pickUpAnObject,
  proc_front_brake_v3: frontBrakeService,
};

export async function POST(request: Request) {
  // An anonymous session is fine and is the point: running a public task needs no account.
  const session = await callerSession(request);
  if (!session) return NextResponse.json({ error: "Not authorised." }, { status: 401 });

  const tenantId = session.tenant.id;
  const db = adminDb();
  const seeded: string[] = [];

  for (const [id, source] of Object.entries(PUBLIC)) {
    const procRef = db.doc(`tenants/${tenantId}/procedures/${id}`);
    const versionRef = db.doc(`tenants/${tenantId}/procedure_versions/${id}`);
    // The VERSIONED spelling as well, which is the one a job's pin resolves to.
    // `publishProcedure` freezes `{id}:{n}` and `pinnedVersion` looks there first; writing only
    // the bare document meant the public catalogue was reachable solely through the fallback,
    // and a seeded procedure and an authored one resolved by different rules.
    const pinnedRef = db.doc(
      `tenants/${tenantId}/procedure_versions/${id}:${source.version}`,
    );

    // All three or none. A procedure a client can see but no version to judge it against
    // produces a job that starts and then cannot be adjudicated — which fails later, in a
    // place that says nothing about this one.
    const [proc, version, pinned] = await Promise.all([
      procRef.get(), versionRef.get(), pinnedRef.get(),
    ]);
    if (proc.exists && version.exists && pinned.exists) continue;

    const doc: Procedure = {
      ...source,
      id,
      tenant_id: tenantId,
      status: "published",
      current_version: source.version,
      published_at: new Date().toISOString(),
    };

    await procRef.set(doc, { merge: true });
    // The frozen copy. A job pins this, so publishing a new version mid-job cannot change
    // what a running job is being judged against.
    const frozen = { ...doc, frozen_at: new Date().toISOString(), version: source.version };
    await Promise.all([versionRef.set(frozen, { merge: true }), pinnedRef.set(frozen, { merge: true })]);
    seeded.push(id);
  }

  return NextResponse.json({ tenant: tenantId, seeded, available: Object.keys(PUBLIC) });
}
