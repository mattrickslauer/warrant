// One turn of the Scoper interview.
//
// There is no form builder in Warrant and there is not going to be one. This conversation IS
// the authoring interface — less to build and better to use, because a conversation can ask
// "what happens if it's seized?" and a drag-and-drop editor cannot.
//
// Both surfaces call this. The phone had a screen that showed the interview and compiled
// nothing, and said so; this is what it was waiting for.

import { NextResponse } from "next/server";
import { getSession } from "@/auth/session";
import { askFleet, FleetUnreachable } from "@/server/fleet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every class the contract lets the Scoper ask about. Used to compute what it has not. */
const CLASSES = [
  "scope", "sequence", "tolerance", "evidence", "failure", "authority", "parts", "safety",
] as const;

/** An interview is finite. A shop that has told you everything will not know more on turn 12. */
const MAX_TURNS = 14;

interface Turn {
  who: string;
  said: string;
}

interface Body {
  shop?: { trade?: string; machines?: string; technicians?: number; stakes?: string };
  conversation?: Turn[];
  existing_form?: string;
  catalogue?: unknown;
}

export async function POST(request: Request) {
  const session = await getSession();
  // Authoring is gated and has to be. Running a public task needs no account, but a procedure
  // governs every job ever run against it, so it belongs to a tenant.
  if (!session) return NextResponse.json({ error: "Not authorised." }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const conversation = Array.isArray(body.conversation) ? body.conversation : [];
  if (conversation.length > MAX_TURNS * 2) {
    return NextResponse.json({ error: "This interview is over its turn budget." },
                             { status: 409 });
  }

  // The coverage list the agent depends on.
  //
  // scoper.py counts the classes back to the model on purpose: left to reconstruct that from
  // the transcript it follows the thread in front of it, and spends ten turns on how you tell
  // fork oil from road grime while the pad wear limit — the figure the record is actually
  // decided by — never comes up. Computing it HERE rather than in the agent keeps the fact
  // about this conversation with the conversation.
  const asked = askedAbout(conversation);

  const kase = {
    shop: body.shop ?? {},
    conversation,
    asked_about: asked,
    turns_left: Math.max(0, MAX_TURNS - conversation.filter((t) => t.who !== "shop").length),
    ...(body.existing_form ? { existing_form: body.existing_form } : {}),
    ...(body.catalogue ? { catalogue: body.catalogue } : {}),
  };

  try {
    const reply = await askFleet("scoper", kase);
    if (!reply.valid) {
      // Returned, not thrown. A malformed turn is a finding about the agent, and an interview
      // that dies with a 500 loses the whole transcript with it.
      return NextResponse.json(
        { error: "The Scoper's answer did not satisfy its contract.",
          schema_errors: reply.schemaErrors },
        { status: 502 },
      );
    }
    return NextResponse.json({
      turn: reply.output,
      model: reply.model,
      asked_about: asked,
      turns_left: kase.turns_left,
    });
  } catch (error) {
    const principal = error instanceof FleetUnreachable ? error.principal : null;
    return NextResponse.json(
      { error: "The Scoper could not be reached.",
        principal, detail: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

/**
 * Which classes this interview has already covered.
 *
 * Read back off the agent's own prior turns rather than inferred from the text: the contract
 * makes the Scoper declare `asks_about` on every question it asks, so the record of what has
 * been covered is something it stated, not something we guessed on its behalf.
 */
function askedAbout(conversation: Turn[]): string[] {
  const seen = new Set<string>();
  for (const turn of conversation) {
    if (turn.who === "shop") continue;
    for (const c of CLASSES) {
      // The class travels in the turn as `[scope]` when a client echoes it back. A turn with
      // no marker contributes nothing, which errs toward asking again rather than toward
      // believing a subject is closed.
      if (turn.said.includes(`[${c}]`)) seen.add(c);
    }
  }
  return [...seen];
}
