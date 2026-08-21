// §5 of specs/2026-08-21-making-it-real-design.md, one test per row.
//
// The claim under test is the one the product rests on: a model's verdict is an INPUT to a
// decision this code makes. Every way a model can be wrong — malformed, over its budget,
// contradicted by the Skeptic, or simply absent — has a defined and conservative outcome,
// and the conservative outcome is always that the step does not advance.
//
//   cd web && node --experimental-strip-types --test scripts/outcome.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideOutcome } from "../src/server/adjudicate/outcome.ts";

const pass = {
  output: { verdict: "PASS", confidence: 0.9, rationale: "Pads clearly visible." },
  valid: true, schemaErrors: [],
};
const belongs = { output: { belongs: true, mismatch_kind: "none" }, valid: true };

describe("decideOutcome", () => {
  test("PASS with the Skeptic agreeing accepts the field", () => {
    const e = decideOutcome({ inspector: pass, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "accept_field");
  });

  test("a Skeptic dissent escalates, and names what did not match", () => {
    // The contract is explicit: "Dissent is a deterministic escalation trigger: the step
    // does not pass and a named person is raised the same day."
    const dissent = {
      output: { belongs: false, mismatch_kind: "asset",
                rationale: "The fork is a different colour from bike-04's history." },
      valid: true,
    };
    const e = decideOutcome({ inspector: pass, skeptic: dissent,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "escalate");
    assert.match(e.question, /asset/);
  });

  test("a reuse dissent escalates even when the Inspector was happy", () => {
    const reuse = {
      output: { belongs: false, mismatch_kind: "reuse", prior_capture_ref: "cap_old",
                rationale: "This is the same frame as cap_old." },
      valid: true,
    };
    const e = decideOutcome({ inspector: pass, skeptic: reuse,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "escalate");
    assert.match(e.question, /reuse|cap_old/);
  });

  test("ADD_FIELD within budget asks for the named field", () => {
    const inspector = {
      output: { verdict: "ADD_FIELD", add_field_key: "pad_edge_retry",
                add_field_kind: "photo",
                add_field_prompt: "Photograph the pad edge again, square on" },
      valid: true, schemaErrors: [],
    };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 1, maxAddFields: 2 });
    assert.equal(e.kind, "add_field");
    assert.equal(e.key, "pad_edge_retry");
    assert.equal(e.fieldKind, "photo");
    assert.equal(e.prompt, "Photograph the pad edge again, square on");
  });

  test("ADD_FIELD with the budget exhausted becomes an escalation", () => {
    // The contract already requires the Inspector to escalate here. The server ENFORCES it
    // rather than trusting it — an agent that ignored its own budget could otherwise ask a
    // technician for one more photograph indefinitely.
    const inspector = {
      output: { verdict: "ADD_FIELD", add_field_key: "again", add_field_kind: "photo",
                add_field_prompt: "once more" },
      valid: true, schemaErrors: [],
    };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 2, maxAddFields: 2 });
    assert.equal(e.kind, "escalate");
    assert.match(e.question, /2 further requests/);
  });

  test("ESCALATE carries the exact question", () => {
    const inspector = {
      output: { verdict: "ESCALATE",
                escalation_question: "Is this disc within service limit?" },
      valid: true, schemaErrors: [],
    };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "escalate");
    assert.equal(e.question, "Is this disc within service limit?");
  });

  test("a schema-invalid verdict transitions nothing", () => {
    const inspector = {
      output: { verdict: "PASS" }, valid: false,
      schemaErrors: ["confidence: required by the contract and absent"],
    };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
    assert.match(e.why, /confidence/);
  });

  test("an unknown verdict string holds rather than guessing", () => {
    const inspector = { output: { verdict: "PROBABLY_FINE" }, valid: true, schemaErrors: [] };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
  });

  test("ADD_FIELD missing the field it wants holds", () => {
    const inspector = { output: { verdict: "ADD_FIELD" }, valid: true, schemaErrors: [] };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
  });

  test("ESCALATE without a question holds rather than escalating emptily", () => {
    const inspector = { output: { verdict: "ESCALATE" }, valid: true, schemaErrors: [] };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
  });

  test("no Skeptic answer is not treated as agreement", () => {
    const e = decideOutcome({ inspector: pass, skeptic: null,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
  });

  test("a schema-invalid Skeptic does not let a PASS through", () => {
    const e = decideOutcome({ inspector: pass, skeptic: { output: {}, valid: false },
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
  });

  test("the Skeptic cannot rescue a failing Inspector", () => {
    // Belonging is not sufficiency. An agreeing Skeptic must never turn ADD_FIELD into a pass.
    const inspector = {
      output: { verdict: "ADD_FIELD", add_field_key: "k", add_field_kind: "photo",
                add_field_prompt: "p" },
      valid: true, schemaErrors: [],
    };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "add_field");
  });
});
