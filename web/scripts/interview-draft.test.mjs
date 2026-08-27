// The authoring interview, kept somewhere it can be found again.
//
// A 22-minute Scoper interview with a thirty-year technician was lost because nothing wrote
// it down: `/api/scoper/turn` is stateless by design, the transcript lived in a React
// component, and when the turn failed there was nothing to come back to. These are the shape
// rules for the document that fixes that.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/interview-draft.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  toDraftDoc, fromDraftDoc, worthSaving, DRAFT_COLLECTION,
} from "../src/data/interview-draft.ts";

const NOW = "2026-08-26T04:00:00.000Z";

const STATE = {
  shop: { trade: "Residential electrical", machines: "panels", technicians: 1,
          stakes: "bodily injury and death" },
  conversation: [
    { who: "scoper", said: "[scope] Is this a replacement, an installation, or a test?" },
    { who: "shop", said: "This is a replacement." },
  ],
  existingForm: "",
  formRefs: [],
};

describe("the interview draft document", () => {
  test("a transcript survives the round trip", () => {
    const back = fromDraftDoc(toDraftDoc(STATE, NOW));
    assert.deepEqual(back.conversation, STATE.conversation);
    assert.equal(back.shop.trade, "Residential electrical");
  });

  test("it is written open, and never claims to be sealed", () => {
    // `firestore.rules` refuses a client write whose status is 'sealed' — a draft that
    // reached for that word would be refused on every save, silently, forever.
    const doc = toDraftDoc(STATE, NOW);
    assert.equal(doc.status, "open");
    assert.notEqual(doc.status, "sealed");
  });

  test("it carries no field the rules forbid a client to claim", () => {
    // clientMayNotClaim() in firestore.rules. Any of these at the top level and the save is
    // refused — which would look exactly like the bug this document exists to fix.
    const forbidden = ["provenance_class", "capture_surface", "tool_id", "tier",
                       "attestation_play_integrity", "attestation_device_id", "armor_verdict"];
    const doc = toDraftDoc(STATE, NOW);
    for (const key of forbidden) {
      assert.ok(!(key in doc), `draft must not write a top-level '${key}'`);
    }
  });

  test("an interview nobody has answered yet is not worth a document", () => {
    // /author is a public page. Writing a draft for every visitor who lands on it would fill
    // the tenant with empty documents nobody asked for.
    assert.equal(worthSaving([]), false);
    assert.equal(worthSaving([{ who: "scoper", said: "[scope] First question?" }]), false);
  });

  test("an interview with an answer in it is worth keeping", () => {
    assert.equal(worthSaving(STATE.conversation), true);
  });

  test("a draft that cannot be read does not take the screen down with it", () => {
    // A half-written or hand-edited document must not throw on the authoring screen. It is
    // recovery, and recovery that crashes is worse than none.
    assert.equal(fromDraftDoc(null), null);
    assert.equal(fromDraftDoc(undefined), null);
    assert.equal(fromDraftDoc({ conversation: "not an array" }), null);
    assert.equal(fromDraftDoc({}), null);
  });

  test("it lives in a collection the server does not own", () => {
    // serverWritten() in firestore.rules lists the collections a client may not write. The
    // draft is the shop's own words and the CLIENT must write it — a server-side write would
    // share fate with the very call that fails.
    const serverWritten = ["members", "records", "decisions", "readings",
                           "procedure_versions", "findings", "audits"];
    assert.ok(!serverWritten.includes(DRAFT_COLLECTION));
  });
});
