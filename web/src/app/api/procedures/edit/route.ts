// Every edit a person can make to a procedure, through one door.
//
// One route with a discriminated `op` rather than a dozen REST paths, because that is how the
// rest of this API is shaped — `compile`, `publish`, `share`, `seed` are all verbs, and a
// nested resource tree here would be the only one of its kind.
//
// Server-side, though `/tenants/{t}/procedures` is not in firestore.rules' server-written
// list and a signed-in member could in principle write it from the browser. Two reasons it
// goes through here anyway:
//
//   * **The invariants are not client business.** `index` must equal position and
//     `minimum_tier` must be derived from the fields — see web/src/server/procedure-edit.ts.
//     A browser that computed them would be a second implementation of the rules, free to
//     disagree with the first, and the disagreement would surface as a procedure a browser is
//     allowed to run and should not be.
//
//   * **Archiving takes the public copy down**, and `/public_procedures` is nobody-writable
//     from any client, deliberately. Half of that act is unreachable from a browser, so all
//     of it belongs here rather than splitting one decision across two trust boundaries.
//
// Cookie or bearer, like every other authoring route: the phone holds an ID token and has no
// cookie jar, and a promise that holds for the browser and not the handset is not the promise
// that was made.

import { NextResponse } from "next/server";
import { callerSession } from "@/auth/bearer";
import { NotAllowed } from "@/server/procedures";
import {
  addField, addStep, archiveProcedure, createProcedure, deleteField, deleteProcedure,
  deleteStep, moveField, moveStep, restoreProcedure, updateField, updateProcedure, updateStep,
  type FieldPatch, type ProcedurePatch, type StepPatch,
} from "@/server/procedure-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  op?: string;
  procedure_id?: string;
  step_id?: string | null;
  field_key?: string;
  direction?: "up" | "down";
  title?: string;
  patch?: ProcedurePatch & StepPatch & FieldPatch;
}

const bad = (message: string) => NextResponse.json({ error: message }, { status: 400 });

export async function POST(request: Request) {
  const session = await callerSession(request);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Body must be JSON.");
  }

  const tenantId = session.tenant.id;
  const uid = session.uid;
  const { op } = body;
  if (!op) return bad("op is required.");

  // `create` is the one op with no procedure to name, so it is answered before the guard that
  // insists on one. Everything else refers to something that already exists.
  try {
    if (op === "create") {
      const procedure = await createProcedure(tenantId, uid, body.title ?? "");
      return NextResponse.json({ procedure });
    }

    const id = body.procedure_id;
    if (!id) return bad("procedure_id is required.");

    switch (op) {
      case "update_procedure":
        return NextResponse.json({
          procedure: await updateProcedure(tenantId, id, uid, body.patch ?? {}),
        });

      case "archive":
        return NextResponse.json({ procedure: await archiveProcedure(tenantId, id, uid) });

      case "restore":
        return NextResponse.json({ procedure: await restoreProcedure(tenantId, id, uid) });

      case "delete":
        return NextResponse.json(await deleteProcedure(tenantId, id, uid));

      case "add_step":
        return NextResponse.json({
          procedure: await addStep(tenantId, id, uid, body.step_id ?? null),
        });

      case "update_step":
        if (!body.step_id) return bad("step_id is required.");
        return NextResponse.json({
          procedure: await updateStep(tenantId, id, uid, body.step_id, body.patch ?? {}),
        });

      case "delete_step":
        if (!body.step_id) return bad("step_id is required.");
        return NextResponse.json({
          procedure: await deleteStep(tenantId, id, uid, body.step_id),
        });

      case "move_step":
        if (!body.step_id) return bad("step_id is required.");
        if (body.direction !== "up" && body.direction !== "down") {
          return bad("direction must be up or down.");
        }
        return NextResponse.json({
          procedure: await moveStep(tenantId, id, uid, body.step_id, body.direction),
        });

      case "add_field":
        if (!body.step_id) return bad("step_id is required.");
        return NextResponse.json({
          procedure: await addField(tenantId, id, uid, body.step_id),
        });

      case "update_field":
        if (!body.step_id) return bad("step_id is required.");
        if (!body.field_key) return bad("field_key is required.");
        return NextResponse.json({
          procedure: await updateField(
            tenantId, id, uid, body.step_id, body.field_key, body.patch ?? {},
          ),
        });

      case "delete_field":
        if (!body.step_id) return bad("step_id is required.");
        if (!body.field_key) return bad("field_key is required.");
        return NextResponse.json({
          procedure: await deleteField(tenantId, id, uid, body.step_id, body.field_key),
        });

      case "move_field":
        if (!body.step_id) return bad("step_id is required.");
        if (!body.field_key) return bad("field_key is required.");
        if (body.direction !== "up" && body.direction !== "down") {
          return bad("direction must be up or down.");
        }
        return NextResponse.json({
          procedure: await moveField(
            tenantId, id, uid, body.step_id, body.field_key, body.direction,
          ),
        });

      default:
        return bad(`Unknown op: ${op}`);
    }
  } catch (error) {
    // NotAllowed carries a sentence somebody can act on — "archive it instead", "this step
    // already has a field called x". It is shown verbatim in the editor, so it is 403 rather
    // than 500 and it does not get flattened into "something went wrong".
    if (error instanceof NotAllowed) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
