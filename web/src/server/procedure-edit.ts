import "server-only";

// Editing a procedure by hand.
//
// Until this file existed a procedure could only be born from a Scoper interview and could
// never be changed afterwards. That is a fine story for the first one and an impossible one
// for the second: a shop that got a bound wrong, or wanted one more photograph, had to sit
// through fourteen turns of conversation again to fix a single number. So there is now a
// second way in — a form — and the interview keeps its place as the way you get a procedure
// when you do not yet know what it should say.
//
// ## What this file may touch, and what it must never touch
//
// Every function here writes to ONE document: `/tenants/{t}/procedures/{id}`, the live draft.
//
// `/tenants/{t}/procedure_versions/{id}:{n}` is not reachable from here, by design and not by
// oversight. A job pins the frozen version it started under, and web/src/server/procedures.ts
// exists to make that pin real. If an edit could reach a frozen version, then editing a
// procedure while a v2 job was being performed would change the steps under the technician's
// hands, and the sealed record would still say `procedure_version: 2` — which is precisely the
// lie the freeze was built to prevent. So editing is always editing the DRAFT, and publishing
// is the separate, audited act that turns a draft into a version somebody can be judged
// against. That act already exists and this file does not duplicate it.
//
// The consequence a reader should hold on to: **saving is safe**. Nothing a person does in the
// editor can affect a job that is already running, a record that is already sealed, or the
// public copy the world is reading. It changes what the NEXT publish will freeze.
//
// ## Two invariants re-established on every single write
//
//   * **`index` equals position.** compile.ts assigns `index: i + 1` once, at compile time, and
//     every surface renders "Step 3 of 7" from it. Insert a step in the middle without
//     re-indexing and the cards silently number 1, 2, 3, 3, 4 — so the numbering is recomputed
//     from the array on every mutation rather than maintained incrementally.
//
//   * **`minimum_tier` is derived.** Same reason compile.ts refuses to accept the client's
//     figure: `surfaceCanRun` uses it to refuse a procedure a surface cannot honestly perform,
//     and adding an instrument field would otherwise leave a procedure that a browser — whose
//     sensors are supplied by the person being checked — is still allowed to run. Deleting the
//     last instrument field has to move it back down for the same reason.
//
// Validity is NOT an invariant here, and that is deliberate. The editor saves half-finished
// drafts: a field whose bound you have not looked up yet, a step whose explanation you are
// still thinking about. `faults()` in compile.ts is the gate, and it runs at publish, which is
// the moment the procedure starts governing anything. A form that refused every incomplete
// keystroke would be a form nobody could author in.

import { adminDb } from "@/auth/admin";
import { getMember } from "@/auth/members";
import { NotAllowed } from "@/server/procedures";
import { unshareProcedure } from "@/server/public-procedures";
import { tierFor } from "@/server/compile";
import type { FieldDef, Procedure, Step } from "@/generated/types";

export { NotAllowed };

/** The level that means never. Strictness tops out at 3, so nothing can reach it. */
export const NEVER_REQUIRED = 4;

const KINDS: FieldDef["kind"][] =
  ["measurement", "photo", "video", "scan", "choice", "text", "signature", "location"];
const SOURCES: FieldDef["source"][] = ["instrument", "camera", "human"];
const RULES: FieldDef["acceptance_rule"][] =
  ["within", "matches", "must_show", "consistent_with", "per_spec", "signed_by"];

const nowIso = () => new Date().toISOString();

/** `Front brake service` -> `front-brake-service`. Must satisfy compile.ts's key pattern. */
export function slugify(raw: string): string {
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "procedure";
}

/** `front-brake-service` -> `proc_front_brake_service`. The same id compile.ts derives. */
export const idForKey = (key: string) => `proc_${key.replace(/-/g, "_")}`;

/**
 * May this person change what a procedure says?
 *
 * A viewer may not, and a disabled account may not — when an employer disables somebody,
 * access ends the same instant, which is the promise members.ts makes everywhere else.
 * Ordinary editing deliberately does NOT require `may_publish_procedures`: a technician who
 * spots a wrong torque figure should be able to correct the draft, and the standing check
 * sits where it belongs, on the act that makes the draft govern anything.
 */
async function requireEditor(tenantId: string, uid: string) {
  const member = await getMember(tenantId, uid);
  if (!member || member.disabled || member.role === "viewer") {
    throw new NotAllowed("You do not have standing to edit procedures.");
  }
  return member;
}

/**
 * May this person take a procedure out of service, or destroy it?
 *
 * This one DOES need publishing standing, because archiving is the inverse of publishing:
 * it decides what the shop is allowed to run and what the world can see.
 */
async function requireRetirer(tenantId: string, uid: string) {
  const member = await getMember(tenantId, uid);
  if (!member || member.disabled || !member.standing.may_publish_procedures) {
    throw new NotAllowed("You do not have standing to retire procedures.");
  }
  return member;
}

const proceduresRef = (tenantId: string) =>
  adminDb().collection("tenants").doc(tenantId).collection("procedures");

/**
 * Read, change, write back — atomically.
 *
 * A transaction rather than a read-then-set because the editor fires one op per control as
 * you leave it, so two edits to two different steps genuinely can land together. Both read
 * the whole `steps` array and both write the whole `steps` array, and the loser of that race
 * would silently undo the winner: the person watches their change appear and then vanish on
 * the next reload, which is the worst failure an editor has, because it teaches them not to
 * trust the save.
 */
async function mutate(
  tenantId: string,
  procedureId: string,
  change: (procedure: Procedure) => Procedure,
): Promise<Procedure> {
  const ref = proceduresRef(tenantId).doc(procedureId);
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new NotAllowed(`No such procedure: ${procedureId}`);

    const before = snap.data() as Procedure;
    const after = change(before);

    // Both invariants, in one place, on every path in and out of this file.
    const steps = (after.steps ?? []).map((s, i) => ({ ...s, id: s.id || `s${i + 1}`, index: i + 1 }));
    const next: Procedure = {
      ...after,
      steps,
      minimum_tier: tierFor(steps),
      updated_at: nowIso(),
    };

    tx.set(ref, next);
    return next;
  });
}

/** The step, or a refusal naming the one that was asked for. */
function findStep(procedure: Procedure, stepId: string): Step {
  const step = (procedure.steps ?? []).find((s) => s.id === stepId);
  if (!step) throw new NotAllowed(`No such step: ${stepId}`);
  return step;
}

const replaceStep = (procedure: Procedure, stepId: string, next: Step): Procedure => ({
  ...procedure,
  steps: (procedure.steps ?? []).map((s) => (s.id === stepId ? next : s)),
});

// ---- procedure ------------------------------------------------------------------------

export interface ProcedurePatch {
  title?: string;
  strictness?: number;
  disqualifiers?: string[];
  releases?: string[];
}

/**
 * A new, empty procedure.
 *
 * It starts with one step containing one field, rather than empty. An empty procedure gives a
 * person a page with nothing on it and no clue what a step is supposed to contain, and the
 * blank documents in this product are the ones nobody finishes. Both are placeholders and
 * both will be refused by `faults()` until they say something, which is the correct pressure:
 * you can see the shape immediately and you cannot publish the shape alone.
 */
export async function createProcedure(
  tenantId: string, byUid: string, title: string,
): Promise<Procedure> {
  await requireEditor(tenantId, byUid);

  const clean = (title ?? "").trim() || "Untitled procedure";
  const db = adminDb();
  const collection = proceduresRef(tenantId);

  // The key is the identity compile.ts keys off, so two procedures may not share one. If they
  // did, re-interviewing this job would land on whichever document the query happened to
  // return first and publish a version of the wrong one.
  const base = slugify(clean);
  let key = base;
  for (let n = 2; !(await collection.where("key", "==", key).limit(1).get()).empty; n += 1) {
    key = `${base}-${n}`;
  }

  const now = nowIso();
  const procedure: Procedure = {
    schema_version: 1,
    id: idForKey(key),
    tenant_id: tenantId,
    key,
    title: clean,
    version: 0,
    current_version: 0,
    strictness: 1,
    minimum_tier: "open",
    disqualifiers: [],
    releases: [],
    steps: [blankStep(1, [blankField(1)])],
    created_at: now,
    updated_at: now,
    status: "drafting",
    origin: "authored",
    public_id: null,
  };

  await db.runTransaction(async (tx) => {
    const ref = collection.doc(procedure.id);
    const existing = await tx.get(ref);
    if (existing.exists) throw new NotAllowed(`A procedure already lives at ${procedure.id}.`);
    tx.set(ref, procedure);
  });

  return procedure;
}

/**
 * Title, strictness, disqualifiers, releases.
 *
 * `key` is absent from the patch and cannot be changed, because it is what makes two
 * interviews of the same job the same procedure. Renaming it would fork the shop's brake
 * service into two subtly different brake services and leave every sealed record pointing at
 * a name that no longer exists. Retitling is free; re-keying is not a rename, it is a new
 * procedure, and the editor offers that separately.
 */
export async function updateProcedure(
  tenantId: string, procedureId: string, byUid: string, patch: ProcedurePatch,
): Promise<Procedure> {
  await requireEditor(tenantId, byUid);
  return mutate(tenantId, procedureId, (p) => ({
    ...p,
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.strictness !== undefined
      ? { strictness: clamp(patch.strictness, 0, 3, p.strictness) } : {}),
    ...(patch.disqualifiers !== undefined
      ? { disqualifiers: cleanList(patch.disqualifiers) } : {}),
    ...(patch.releases !== undefined ? { releases: cleanList(patch.releases) } : {}),
  }));
}

/**
 * Out of service, without destroying the evidence trail.
 *
 * Archiving hides the procedure and stops new jobs, and it does NOT touch
 * `procedure_versions` or any sealed record: what those say happened still happened, and a
 * record that could be blanked by retiring a procedure would be worth nothing.
 *
 * It also takes the public copy down, which is the whole reason this is not a one-line status
 * write. A shop that retires a procedure has decided the world should stop following it, and
 * leaving the published projection up would keep somebody else running the thing this shop
 * just decided was wrong.
 */
export async function archiveProcedure(
  tenantId: string, procedureId: string, byUid: string,
): Promise<Procedure> {
  await requireRetirer(tenantId, byUid);

  const snap = await proceduresRef(tenantId).doc(procedureId).get();
  if (!snap.exists) throw new NotAllowed(`No such procedure: ${procedureId}`);
  if ((snap.data() as Procedure).public_id) {
    await unshareProcedure(tenantId, procedureId, byUid);
  }

  return mutate(tenantId, procedureId, (p) => ({ ...p, status: "archived", public_id: null }));
}

/**
 * Back into service, as a draft.
 *
 * Never straight back to `published`, even if it was published when it was archived. Restoring
 * to published would put a procedure back into the run picker without anybody looking at it
 * again, and the reason it was retired is exactly the thing that ought to be re-read first.
 * The frozen versions are all still there, so publishing again costs one click.
 */
export async function restoreProcedure(
  tenantId: string, procedureId: string, byUid: string,
): Promise<Procedure> {
  await requireRetirer(tenantId, byUid);
  return mutate(tenantId, procedureId, (p) => ({ ...p, status: "drafting" }));
}

/**
 * Actually delete it — and only when there is nothing to betray.
 *
 * Permitted for a draft that was never published and has never been run: nothing points at
 * it, no record names it, so deleting it destroys no evidence and the row is just a mistake
 * somebody made in a form. Everything else is refused and told to archive, because a
 * procedure with a frozen version is the thing sealed records were judged against, and a
 * record whose procedure cannot be read is a record nobody can check.
 */
export async function deleteProcedure(
  tenantId: string, procedureId: string, byUid: string,
): Promise<{ deleted: boolean }> {
  await requireRetirer(tenantId, byUid);

  const db = adminDb();
  const ref = proceduresRef(tenantId).doc(procedureId);
  const snap = await ref.get();
  if (!snap.exists) throw new NotAllowed(`No such procedure: ${procedureId}`);

  const procedure = snap.data() as Procedure;
  if ((procedure.current_version ?? procedure.version ?? 0) > 0) {
    throw new NotAllowed(
      "This procedure has published versions, and records were judged against them. Archive it instead.",
    );
  }

  const jobs = await db.collection("tenants").doc(tenantId).collection("jobs")
    .where("procedure_id", "==", procedureId).limit(1).get();
  if (!jobs.empty) {
    throw new NotAllowed("Jobs have been run against this procedure. Archive it instead.");
  }

  if (procedure.public_id) await unshareProcedure(tenantId, procedureId, byUid);
  await ref.delete();
  return { deleted: true };
}

// ---- steps ----------------------------------------------------------------------------

export interface StepPatch {
  title?: string;
  explanation?: string;
  condition?: string | null;
  max_add_fields?: number;
  required_at_strictness?: number;
}

function blankStep(index: number, fields: FieldDef[]): Step {
  return {
    id: `s${index}`,
    index,
    title: "",
    condition: null,
    explanation: "",
    max_add_fields: 2,
    required_at_strictness: 0,
    fields,
  };
}

/**
 * A new step, at the end or after a named one.
 *
 * The id is minted from a counter that has never been used in this procedure rather than from
 * the length of the array, because a step deleted and another added would otherwise reuse an
 * id that a running job's `step_outcomes` already refers to — and that outcome would then
 * attach to a step nobody performed.
 */
export async function addStep(
  tenantId: string, procedureId: string, byUid: string, afterStepId?: string | null,
): Promise<Procedure> {
  await requireEditor(tenantId, byUid);
  return mutate(tenantId, procedureId, (p) => {
    const steps = [...(p.steps ?? [])];
    const step = { ...blankStep(steps.length + 1, [blankField(1)]), id: freshStepId(steps) };
    const at = afterStepId ? steps.findIndex((s) => s.id === afterStepId) : -1;
    if (at >= 0) steps.splice(at + 1, 0, step);
    else steps.push(step);
    return { ...p, steps };
  });
}

export async function updateStep(
  tenantId: string, procedureId: string, byUid: string, stepId: string, patch: StepPatch,
): Promise<Procedure> {
  await requireEditor(tenantId, byUid);
  return mutate(tenantId, procedureId, (p) => {
    const step = findStep(p, stepId);
    return replaceStep(p, stepId, {
      ...step,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.explanation !== undefined ? { explanation: patch.explanation.trim() } : {}),
      // An empty condition is null, not "". "Show only if ''" is a condition that is always
      // false in some readers and always true in others; null is the one that means always.
      ...(patch.condition !== undefined
        ? { condition: (patch.condition ?? "").trim() || null } : {}),
      ...(patch.max_add_fields !== undefined
        ? { max_add_fields: clamp(patch.max_add_fields, 0, 9, step.max_add_fields) } : {}),
      ...(patch.required_at_strictness !== undefined
        ? {
          required_at_strictness: clamp(
            patch.required_at_strictness, 0, NEVER_REQUIRED, step.required_at_strictness ?? 0,
          ),
        }
        : {}),
    });
  });
}

/** Remove it. The last step may go: an empty procedure is refused at publish, not here. */
export async function deleteStep(
  tenantId: string, procedureId: string, byUid: string, stepId: string,
): Promise<Procedure> {
  await requireEditor(tenantId, byUid);
  return mutate(tenantId, procedureId, (p) => {
    findStep(p, stepId);
    return { ...p, steps: (p.steps ?? []).filter((s) => s.id !== stepId) };
  });
}

/** Up or down one place. Order is what `index` renders, so this is a real edit, not a view. */
export async function moveStep(
  tenantId: string, procedureId: string, byUid: string, stepId: string, direction: "up" | "down",
): Promise<Procedure> {
  await requireEditor(tenantId, byUid);
  return mutate(tenantId, procedureId, (p) => {
    const steps = [...(p.steps ?? [])];
    const at = steps.findIndex((s) => s.id === stepId);
    if (at < 0) throw new NotAllowed(`No such step: ${stepId}`);
    const to = direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= steps.length) return p;
    [steps[at], steps[to]] = [steps[to], steps[at]];
    return { ...p, steps };
  });
}

/** An id no step in this procedure has ever held within this edit. See addStep. */
function freshStepId(steps: Step[]): string {
  const used = new Set(steps.map((s) => s.id));
  for (let n = 1; ; n += 1) if (!used.has(`s${n}`)) return `s${n}`;
}

// ---- fields ---------------------------------------------------------------------------

export interface FieldPatch {
  key?: string;
  kind?: string;
  prompt?: string;
  source?: string;
  guidance?: string;
  required_at_strictness?: number;
  choices?: string[];
  acceptance_rule?: string;
  acceptance_min?: number | null;
  acceptance_max?: number | null;
  acceptance_unit?: string | null;
  acceptance_target?: string | null;
  acceptance_description?: string | null;
}

function blankField(n: number): FieldDef {
  return {
    key: `field_${n}`,
    kind: "photo",
    prompt: "",
    source: "camera",
    required_at_strictness: 0,
    choices: [],
    acceptance_rule: "must_show",
    acceptance_min: null,
    acceptance_max: null,
    acceptance_unit: null,
    acceptance_target: null,
    acceptance_description: null,
    guidance: "",
  };
}

export async function addField(
  tenantId: string, procedureId: string, byUid: string, stepId: string,
): Promise<Procedure> {
  await requireEditor(tenantId, byUid);
  return mutate(tenantId, procedureId, (p) => {
    const step = findStep(p, stepId);
    const used = new Set(step.fields.map((f) => f.key));
    let n = step.fields.length + 1;
    while (used.has(`field_${n}`)) n += 1;
    return replaceStep(p, stepId, { ...step, fields: [...step.fields, blankField(n)] });
  });
}

/**
 * Change one field.
 *
 * The key is changeable here, unlike the procedure's, because a field key is scoped to a step
 * and nothing outside the running job refers to it — but it must stay unique within the step,
 * since `accepted_fields` is a list of keys and two fields sharing one would mean accepting
 * either marks both.
 *
 * Every enum is checked against the contract rather than trusted. This arrives from a browser,
 * and a `kind` the renderers do not know is a field that shows a person nothing to do.
 */
export async function updateField(
  tenantId: string, procedureId: string, byUid: string,
  stepId: string, fieldKey: string, patch: FieldPatch,
): Promise<Procedure> {
  await requireEditor(tenantId, byUid);
  return mutate(tenantId, procedureId, (p) => {
    const step = findStep(p, stepId);
    const field = step.fields.find((f) => f.key === fieldKey);
    if (!field) throw new NotAllowed(`No such field: ${fieldKey}`);

    let key = field.key;
    if (patch.key !== undefined) {
      const next = patch.key.trim();
      if (next && next !== field.key) {
        if (step.fields.some((f) => f.key === next)) {
          throw new NotAllowed(`This step already has a field called "${next}".`);
        }
        key = next;
      }
    }

    const kind = pick(patch.kind, KINDS, field.kind);
    const next: FieldDef = {
      ...field,
      key,
      kind,
      source: pick(patch.source, SOURCES, field.source),
      acceptance_rule: pick(patch.acceptance_rule, RULES, field.acceptance_rule),
      ...(patch.prompt !== undefined ? { prompt: patch.prompt.trim() } : {}),
      ...(patch.guidance !== undefined ? { guidance: patch.guidance.trim() } : {}),
      ...(patch.required_at_strictness !== undefined
        ? {
          required_at_strictness: clamp(
            patch.required_at_strictness, 0, NEVER_REQUIRED, field.required_at_strictness,
          ),
        }
        : {}),
      ...(patch.choices !== undefined ? { choices: cleanList(patch.choices) } : {}),
      ...(patch.acceptance_min !== undefined ? { acceptance_min: num(patch.acceptance_min) } : {}),
      ...(patch.acceptance_max !== undefined ? { acceptance_max: num(patch.acceptance_max) } : {}),
      ...(patch.acceptance_unit !== undefined ? { acceptance_unit: str(patch.acceptance_unit) } : {}),
      ...(patch.acceptance_target !== undefined
        ? { acceptance_target: str(patch.acceptance_target) } : {}),
      ...(patch.acceptance_description !== undefined
        ? { acceptance_description: str(patch.acceptance_description) } : {}),
    };

    // Choices belong to `choice` and nowhere else. Left behind on a field somebody switched to
    // a photograph, they are dead data that the next reader has to work out the meaning of.
    if (next.kind !== "choice") next.choices = [];

    return replaceStep(p, stepId, {
      ...step,
      fields: step.fields.map((f) => (f.key === fieldKey ? next : f)),
    });
  });
}

export async function deleteField(
  tenantId: string, procedureId: string, byUid: string, stepId: string, fieldKey: string,
): Promise<Procedure> {
  await requireEditor(tenantId, byUid);
  return mutate(tenantId, procedureId, (p) => {
    const step = findStep(p, stepId);
    if (!step.fields.some((f) => f.key === fieldKey)) {
      throw new NotAllowed(`No such field: ${fieldKey}`);
    }
    return replaceStep(p, stepId, {
      ...step,
      fields: step.fields.filter((f) => f.key !== fieldKey),
    });
  });
}

export async function moveField(
  tenantId: string, procedureId: string, byUid: string,
  stepId: string, fieldKey: string, direction: "up" | "down",
): Promise<Procedure> {
  await requireEditor(tenantId, byUid);
  return mutate(tenantId, procedureId, (p) => {
    const step = findStep(p, stepId);
    const fields = [...step.fields];
    const at = fields.findIndex((f) => f.key === fieldKey);
    if (at < 0) throw new NotAllowed(`No such field: ${fieldKey}`);
    const to = direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= fields.length) return p;
    [fields[at], fields[to]] = [fields[to], fields[at]];
    return replaceStep(p, stepId, { ...step, fields });
  });
}

// ---- coercion -------------------------------------------------------------------------
//
// Small, and here rather than inline, because every one of them is the same decision: what
// arrived came through a browser, so a value that is not what it claims to be falls back to
// what was already stored rather than overwriting good data with a `NaN` or an `undefined`.

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}
