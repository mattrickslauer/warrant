/**
 * The authoring interview, written down while it is still happening.
 *
 * WHY THIS EXISTS, precisely. `/api/scoper/turn` keeps nothing between turns — the browser
 * carries the transcript and posts it back each time, and that is a deliberate choice the
 * route documents. It is also why a 22-minute interview with a thirty-year technician
 * evaporated: the Scoper timed out on the last question, the tab was closed, and ten answers
 * that took a person twenty minutes to give were gone. Nothing had ever written them down.
 *
 * So the CLIENT writes the draft, not the server, and that is the load-bearing part of the
 * design rather than a convenience. The thing that failed was the server call. A draft
 * persisted inside `/api/scoper/turn` would share fate with the exact request that dies —
 * saved only when saving was not needed. Written from the browser, before the turn is even
 * sent, it survives the fleet being unreachable, the route 503ing, and the tab being shut.
 *
 * `firestore.rules` already allows this: a signed-in member may create and update documents
 * under their own tenant in any collection `serverWritten()` does not name, subject to
 * `clientMayNotClaim()`. This module's whole job is to produce a document that stays inside
 * that grant, which is what `interview-draft.test.mjs` pins.
 */

import {
  collection, doc, getDocs, limit, orderBy, query, setDoc, where,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";

/**
 * Where drafts live.
 *
 * Not in `procedures` — an interview is not a procedure and must never be mistaken for one by
 * anything that lists them. Not in a `serverWritten()` collection either, or the client whose
 * words these are could not write them.
 */
export const DRAFT_COLLECTION = "interview_drafts";

/** One turn of the interview, as the authoring screen holds it. */
export interface DraftTurn {
  who: string;
  said: string;
}

/** What the authoring screen has, and wants back if it comes back. */
export interface DraftState {
  shop: Record<string, unknown>;
  conversation: DraftTurn[];
  existingForm: string;
  formRefs: string[];
}

/** What Firestore holds. Snake case, because everything else in this database is. */
export interface DraftDoc {
  shop: Record<string, unknown>;
  conversation: DraftTurn[];
  existing_form: string;
  form_refs: string[];
  status: "open" | "published" | "abandoned";
  updated_at: string;
}

/**
 * Is this interview far enough along to be worth a document?
 *
 * `/author` is a public page and most people who open it never answer anything. A draft per
 * visitor would fill the tenant with empty documents and make the resume prompt meaningless —
 * so the bar is one answer FROM THE SHOP. The Scoper's opening question alone is not an
 * interview, it is a page load.
 */
export function worthSaving(conversation: DraftTurn[] | null | undefined): boolean {
  if (!Array.isArray(conversation)) return false;
  return conversation.some((t) => t?.who === "shop" && typeof t.said === "string" && t.said.trim() !== "");
}

/**
 * The document to write.
 *
 * `now` is a parameter rather than read from the clock so this stays a pure function and the
 * test can assert on its output. The ordering key is a plain ISO string, not a server
 * timestamp: `orderBy` has to work on a document the browser wrote moments ago and may be
 * reading back out of the offline cache before the server has stamped anything.
 *
 * NOTHING `clientMayNotClaim()` names may appear at the top level here. A draft carrying, say,
 * a `tier` field would be refused by the rules on every single save — and would fail exactly
 * the way the bug this module fixes failed: silently, with the work disappearing.
 */
export function toDraftDoc(state: DraftState, now: string): DraftDoc {
  return {
    shop: state.shop ?? {},
    conversation: Array.isArray(state.conversation) ? state.conversation : [],
    existing_form: state.existingForm ?? "",
    form_refs: Array.isArray(state.formRefs) ? state.formRefs : [],
    status: "open",
    updated_at: now,
  };
}

/**
 * Read a document back, or decide it cannot be read.
 *
 * Returns null rather than throwing on anything malformed. This is the recovery path: an
 * unreadable draft must cost the shop the draft, never the authoring screen. A resume feature
 * that white-screens `/author` would be worse than having none at all.
 */
export function fromDraftDoc(raw: unknown): DraftState | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<DraftDoc>;
  if (!Array.isArray(d.conversation)) return null;
  const conversation = d.conversation.filter(
    (t): t is DraftTurn => Boolean(t) && typeof t === "object"
      && typeof (t as DraftTurn).who === "string" && typeof (t as DraftTurn).said === "string",
  );
  if (conversation.length === 0) return null;
  return {
    shop: (d.shop && typeof d.shop === "object" ? d.shop : {}) as Record<string, unknown>,
    conversation,
    existingForm: typeof d.existing_form === "string" ? d.existing_form : "",
    formRefs: Array.isArray(d.form_refs) ? d.form_refs.filter((r) => typeof r === "string") : [],
  };
}

const path = (tenantId: string) => `tenants/${tenantId}/${DRAFT_COLLECTION}`;

/**
 * Write the draft. Called before the turn is sent, not after it succeeds.
 *
 * Failure is swallowed on purpose. This is a safety net under the interview; a net that can
 * itself stop the interview is not one. If the write fails the shop is exactly where it was
 * before this module existed, and the turn still goes out.
 */
export async function saveDraft(
  db: Firestore, tenantId: string, id: string, state: DraftState, now: string,
): Promise<void> {
  if (!worthSaving(state.conversation)) return;
  try {
    await setDoc(doc(db, path(tenantId), id), toDraftDoc(state, now), { merge: true });
  } catch {
    // Deliberately silent — see above.
  }
}

/** The most recently touched interview this shop left open, if there is one. */
export async function loadOpenDraft(
  db: Firestore, tenantId: string,
): Promise<{ id: string; state: DraftState } | null> {
  try {
    const snap = await getDocs(query(
      collection(db, path(tenantId)),
      where("status", "==", "open"),
      orderBy("updated_at", "desc"),
      limit(1),
    ));
    const first = snap.docs[0];
    if (!first) return null;
    const state = fromDraftDoc(first.data());
    return state ? { id: first.id, state } : null;
  } catch {
    return null;
  }
}

/**
 * Mark a draft finished. It is not deleted, and that is on purpose twice over.
 *
 * `firestore.rules` leaves delete ungranted for everything but an unsealed job, so the client
 * could not delete this if it wanted to. And it should not want to: the interview is how the
 * procedure came to say what it says. Keeping it means a published procedure can always be
 * asked where its bounds came from, which is the argument this whole product makes.
 */
export async function closeDraft(
  db: Firestore, tenantId: string, id: string,
  status: "published" | "abandoned", now: string,
): Promise<void> {
  try {
    await setDoc(doc(db, path(tenantId), id), { status, updated_at: now }, { merge: true });
  } catch {
    // Same reason as saveDraft: never take the screen down over bookkeeping.
  }
}
