import "server-only";

// The other half of the interview.
//
// `/api/scoper/turn` runs the conversation; this is what happens when the Scoper finally says
// `compile`. The draft becomes a document under the tenant and then a FROZEN version, because
// a job pins the version it started under and there has to be something to pin. See
// specs/2026-08-20-firestore-design.md §5.
//
// ## The draft arrives through a browser, so none of it is believed on sight
//
// The Scoper's contract is strict and the agent is careful, but what reaches this file came
// back through a client, and a client is not the agent. Two things are therefore
// re-established here rather than trusted:
//
//   * **`minimum_tier` is derived, never accepted.** procedure.schema.json says "Derived from
//     the fields" and it is load-bearing: `surfaceCanRun` refuses a procedure whose tier the
//     surface cannot reach. A tier that arrived understated would let a browser — whose sensors
//     are supplied by the person being checked — run a procedure that needs a paired
//     instrument. So it is computed from the fields and any disagreement is overwritten without
//     comment, because there is no version of this where the client's number is the better one.
//
//   * **A bound nobody stated is refused.** "Inventing a tolerance is the one thing you must
//     never do" is the Scoper's instruction (contract/agents/scoper-turn.schema.json). Here it
//     stops being an instruction and becomes a rule. A field judged `within` with no bound and
//     no unit cannot be applied to anything that comes back, so every capture would file as a
//     pass because nothing contradicted it — a tick box with the box already ticked, which is
//     the exact thing this product exists to abolish.
//
// A refusal is returned with its reasons and the interview stays open. That is the correct
// outcome: the shop is still sitting there and can answer the question that was missed.

import { adminDb } from "@/auth/admin";
import { faults, tierFor, NotCompilable, type Draft } from "@/server/procedure-faults";
import { publishProcedure } from "@/server/procedures";
import type { FieldDef, Procedure, Step } from "@/generated/types";
import type { TenantRef } from "@/auth/tenant";

// The draft shapes, the validator and the tier derivation all live in procedure-faults.ts, so
// that `publishProcedure` can apply the same gate without importing this file back. Re-exported
// because every existing caller and test imports them from here, and moving a file is not a
// reason to make somebody else edit their import.
export {
  NotCompilable, faults, tierFor,
  type Draft, type DraftStep, type DraftField,
} from "@/server/procedure-faults";

/** Ids and ordering, assigned here so that two compiles of the same interview agree. */
function toSteps(draft: Draft): Step[] {
  return (draft.steps ?? []).map((s, i) => ({
    id: `s${i + 1}`,
    index: i + 1,
    title: (s.title ?? "").trim(),
    condition: s.condition ?? null,
    explanation: (s.explanation ?? "").trim(),
    max_add_fields: s.max_add_fields ?? 2,
    // Absent reads as 0: a step that does not say otherwise is required. See step.schema.json.
    required_at_strictness: s.required_at_strictness ?? 0,
    fields: (s.fields ?? []).map((f) => ({
      key: (f.key ?? "").trim(),
      kind: f.kind,
      prompt: (f.prompt ?? "").trim(),
      source: f.source,
      required_at_strictness: f.required_at_strictness,
      choices: f.choices ?? [],
      acceptance_rule: f.acceptance_rule,
      acceptance_min: f.acceptance_min ?? null,
      acceptance_max: f.acceptance_max ?? null,
      acceptance_unit: f.acceptance_unit ?? null,
      acceptance_target: f.acceptance_target ?? null,
      acceptance_description: f.acceptance_description ?? null,
      guidance: (f.guidance ?? "").trim(),
    })) as FieldDef[],
  })) as Step[];
}

/** `front-brake-service` -> `proc_front_brake_service`. Readable in the console, which matters. */
const idForKey = (key: string) => `proc_${key.replace(/-/g, "_")}`;

/**
 * Compile, store, and freeze v1 — or the next version, if this shop has authored this job
 * before.
 *
 * Re-interviewing a job you already have is the ordinary case, not an error: the shop changed
 * how they do it, or the first pass missed a figure. Keying off `key` rather than minting a new
 * procedure means the second interview becomes v2 of the same thing, so the records made under
 * v1 still name the version that actually ran.
 */
export async function compileProcedure(
  tenant: TenantRef, byUid: string, draft: Draft,
): Promise<{ procedureId: string; version: number; tier: string }> {
  const problems = faults(draft);
  if (problems.length) throw new NotCompilable(problems);

  const db = adminDb();
  const key = draft.key!.trim();
  const procedures = db.collection("tenants").doc(tenant.id).collection("procedures");

  // The id is derived from the key, so re-authoring the same job lands on the same document
  // and `publishProcedure` increments rather than forking a second procedure with the same
  // name — which is how a shop ends up running two subtly different brake services.
  const existing = await procedures.where("key", "==", key).limit(1).get();
  const procedureId = existing.empty ? idForKey(key) : existing.docs[0].id;

  const steps = toSteps(draft);
  const tier = tierFor(draft.steps ?? []);
  const now = new Date().toISOString();

  const doc: Partial<Procedure> = {
    schema_version: 1,
    id: procedureId,
    tenant_id: tenant.id,
    key,
    title: draft.title!.trim(),
    strictness: draft.strictness!,
    minimum_tier: tier,
    disqualifiers: draft.disqualifiers ?? [],
    releases: draft.releases ?? [],
    steps,
    status: "drafting",
    origin: "scoper",
    updated_at: now,
    ...(existing.empty ? { created_at: now, version: 0, current_version: 0 } : {}),
  };

  await procedures.doc(procedureId).set(doc, { merge: true });

  // Publishing is a separate, audited act with a standing check on it, and it stays that way
  // here. Compiling writes a draft nobody can run; this is the line the procedure crosses.
  const { version } = await publishProcedure(tenant.id, procedureId, byUid);
  return { procedureId, version, tier };
}
