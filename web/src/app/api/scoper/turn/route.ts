// One turn of the Scoper interview.
//
// There is no form builder in Warrant and there is not going to be one. This conversation IS
// the authoring interface — less to build and better to use, because a conversation can ask
// "what happens if it's seized?" and a drag-and-drop editor cannot.
//
// Both surfaces call this. The phone had a screen that showed the interview and compiled
// nothing, and said so; this is what it was waiting for.

import { NextResponse } from "next/server";
import { callerSession } from "@/auth/bearer";
import { askFleet, FleetUnreachable, INTERVIEW_TIMEOUT_MS } from "@/server/fleet";
import { take, INTERVIEW_LIMIT } from "@/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every class the contract lets the Scoper ask about. Used to compute what it has not. */
const CLASSES = [
  "scope", "sequence", "tolerance", "evidence", "failure", "authority", "parts", "safety",
] as const;

/** An interview is finite. A shop that has told you everything will not know more on turn 12. */
const MAX_TURNS = 14;

/**
 * And a finite SIZE. Roughly forty pages of transcript.
 *
 * Turn count bounds how many things were said, not how long they were — and the whole
 * transcript is re-sent on every turn, so length is what the bill is actually made of.
 */
const MAX_TRANSCRIPT_CHARS = 120_000;

interface Turn {
  who: string;
  said: string;
}

interface Body {
  shop?: { trade?: string; machines?: string; technicians?: number; stakes?: string };
  conversation?: Turn[];
  existing_form?: string;
  existing_form_media?: unknown;
  catalogue?: unknown;
}

export async function POST(request: Request) {
  const session = await callerSession(request);
  // Authoring is gated and has to be. Running a public task needs no account, but a procedure
  // governs every job ever run against it, so it belongs to a tenant.
  if (!session) return NextResponse.json({ error: "Not authorised." }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  // A ceiling per caller. This route needs no Firestore state at all — a bare POST reaches
  // Gemini — so it is the cheapest thing in the system to abuse and had no limit on it.
  const spend = take(`scoper:${session.uid}`, INTERVIEW_LIMIT);
  if (!spend.allowed) {
    return NextResponse.json(
      { error: "Too many interview turns at once. Give it a moment." },
      { status: 429, headers: { "retry-after": String(spend.retryAfter) } },
    );
  }

  const conversation = Array.isArray(body.conversation) ? body.conversation : [];
  if (conversation.length > MAX_TURNS * 2) {
    return NextResponse.json({ error: "This interview is over its turn budget." },
                             { status: 409 });
  }

  // AND A SIZE CAP, which the turn budget is not.
  //
  // Counting turns bounds how MANY things were said and nothing about how long they were: 28
  // turns of a megabyte each is a legal interview by the check above, and every turn is sent to
  // the model in full, so the cost of the last one grows with everything before it. The limit is
  // on the whole transcript rather than per turn because that is what actually gets billed.
  //
  // Generous on purpose — a shop describing a gnarly procedure should never hit this — and it is
  // a refusal rather than a truncation, because silently dropping the middle of what somebody
  // told you produces a procedure compiled from half an answer.
  const transcript = conversation.reduce((n, t) => n + String(t?.said ?? "").length, 0)
    + String(body.existing_form ?? "").length;
  if (transcript > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json(
      { error: "This interview is longer than the Scoper can read in one go. " +
               "Compile what you have and refine the procedure in the editor." },
      { status: 413 });
  }

  // The coverage list the agent depends on.
  //
  // scoper.py counts the classes back to the model on purpose: left to reconstruct that from
  // the transcript it follows the thread in front of it, and spends ten turns on how you tell
  // fork oil from road grime while the pad wear limit — the figure the record is actually
  // decided by — never comes up. Computing it HERE rather than in the agent keeps the fact
  // about this conversation with the conversation.
  const asked = askedAbout(conversation);

  // Uploaded paper forms, confined to this caller's own prefix.
  //
  // The fleet reads a `gs://` reference under ITS credential, not the caller's, so an
  // unchecked reference here is an instruction to a privileged reader to open any object in
  // the bucket and describe it back — and the references arrive from a browser, which can say
  // anything. `storage.rules` already stops that browser WRITING outside its tenant; this is
  // the other half, and it is the half that matters, because naming an object is not writing
  // one.
  const forms = ownForms(body.existing_form_media, session.tenant.id);

  const kase = {
    shop: body.shop ?? {},
    conversation,
    asked_about: asked,
    unanswered: shrugs(conversation),
    turns_left: Math.max(0, MAX_TURNS - conversation.filter((t) => t.who !== "shop").length),
    ...(body.existing_form ? { existing_form: body.existing_form } : {}),
    ...(forms.length ? { existing_form_media: forms } : {}),
    ...(body.catalogue ? { catalogue: body.catalogue } : {}),
  };

  try {
    // The interview gets a longer budget than a mechanic's step does, and the reason is in
    // `fleet.ts`: the default used to equal the engine's own per-call timeout, so a slow turn
    // was abandoned here at the instant the engine would have retried it. Turns get slower as
    // the transcript grows, which is why it was always the END of a long interview that died.
    const reply = await askFleet("scoper", kase, fetch, { timeoutMs: INTERVIEW_TIMEOUT_MS });
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
 * Which of the references the caller sent are theirs to have.
 *
 * Silently dropped rather than refused, because there is exactly one way a foreign reference
 * gets here and it is not a shop mistyping: the interview only ever sends back what this
 * browser itself uploaded, under its own tenant, moments earlier. An interview must not die
 * over it either — the transcript is the expensive thing on this screen.
 */
function ownForms(refs: unknown, tenantId: string): string[] {
  if (!Array.isArray(refs)) return [];
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucket) return [];
  const prefix = `gs://${bucket}/tenants/${tenantId}/forms/`;
  return refs.filter((r): r is string =>
    typeof r === "string" && r.startsWith(prefix) && !r.slice(prefix.length).includes("/"));
}

/**
 * How many questions this shop has been unable to answer.
 *
 * `scoper.py` reads this and it is doing real work: without it the Scoper cannot tell "they
 * are being vague" from "they do not hold this", so it rewords the same question, then asks
 * one level beneath it, and the unresolved list never empties — the shop is walked through an
 * hour of questions and handed nothing. Absent here until now, which meant the web interview
 * behaved WORSE than the eval harness that was used to tune the agent.
 *
 * The pattern is `agents/evals/talk.py:137` verbatim. Duplicated rather than shared for the
 * same reason `askedAbout` is: this is a fact computed about a conversation, not a prompt, and
 * a prompt is the thing that must never exist in two languages.
 */
const SHRUG = /\b(no idea|don'?t know|dunno|not sure|by feel|look it up)\b/i;

function shrugs(conversation: Turn[]): number {
  return conversation.filter((t) => t.who === "shop" && SHRUG.test(t.said)).length;
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
