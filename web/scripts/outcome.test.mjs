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
import { decideOutcome, thresholdFor, transcriptionMatches } from "../src/server/adjudicate/outcome.ts";

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

// The threshold the contract states and nothing used to read.
//
// `contract/agents/inspector-verdict.schema.json` says "Below the strictness threshold you must
// not return PASS", and `agents/warrant/inspector.py` renders the number into the prompt. Until
// this block existed, `decideOutcome` never looked at `confidence` at all — so an Inspector that
// ignored that sentence advanced a regulated step on a coin flip. Telling a model a rule and
// never checking it is the one thing this file exists to prevent.
describe("the strictness threshold", () => {
  const at = (confidence, strictness) => decideOutcome({
    inspector: { output: { verdict: "PASS", confidence, rationale: "Looks fine." },
                 valid: true, schemaErrors: [] },
    skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2, strictness,
  });

  test("the table matches agents/warrant/inspector.py", () => {
    assert.equal(thresholdFor(0), 0.5);
    assert.equal(thresholdFor(1), 0.6);
    assert.equal(thresholdFor(2), 0.75);
    assert.equal(thresholdFor(3), 0.9);
    // An unstated strictness is standard, never the most permissive reading.
    assert.equal(thresholdFor(undefined), 0.6);
  });

  test("a regulated procedure refuses a PASS the Inspector was not sure of", () => {
    const e = at(0.41, 3);
    assert.equal(e.kind, "escalate");
    assert.match(e.question, /0\.41/);
    assert.match(e.question, /0\.90/);
  });

  test("the same confidence passes at a strictness that permits it", () => {
    // 0.65 is below `assured` and above `standard`. The number does not change; the procedure
    // it is being judged under does, which is the whole point of having a table.
    assert.equal(at(0.65, 1).kind, "accept_field");
    assert.equal(at(0.65, 2).kind, "escalate");
  });

  test("exactly on the threshold is a pass", () => {
    assert.equal(at(0.75, 2).kind, "accept_field");
  });

  test("escalation, not a hold, because a person can answer this one", () => {
    // A hold waits for nobody. An Inspector that passed at 0.4 has produced a specific question
    // somebody can settle by looking at the same photograph, so it raises them.
    assert.equal(at(0.2, 2).kind, "escalate");
  });

  test("a PASS with no usable confidence advances nothing", () => {
    for (const confidence of [undefined, null, "high", NaN]) {
      const e = decideOutcome({
        inspector: { output: { verdict: "PASS", confidence }, valid: true, schemaErrors: [] },
        skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2, strictness: 1,
      });
      assert.equal(e.kind, "hold", `confidence ${String(confidence)} must not pass`);
    }
  });

  test("the threshold is checked before the Skeptic is consulted", () => {
    // Otherwise an unreachable Skeptic would mask a sub-threshold PASS as a plain hold, and the
    // record would say belonging was unestablished when the real fault was the Inspector's.
    const e = decideOutcome({
      inspector: { output: { verdict: "PASS", confidence: 0.3 }, valid: true, schemaErrors: [] },
      skeptic: null, addFieldsUsed: 0, maxAddFields: 2, strictness: 3,
    });
    assert.equal(e.kind, "escalate");
    assert.match(e.question, /confidence/);
  });

  test("it only applies to a PASS — an ADD_FIELD is not a confidence question", () => {
    const e = decideOutcome({
      inspector: { output: { verdict: "ADD_FIELD", confidence: 0.1, add_field_key: "k",
                             add_field_kind: "photo", add_field_prompt: "p" },
                   valid: true, schemaErrors: [] },
      skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2, strictness: 3,
    });
    assert.equal(e.kind, "add_field");
  });
});

// The comparison the Inspector is not allowed to make.
//
// `inspector.py` withholds `acceptance_target` for a `matches` rule, so the agent transcribes
// what it can see and never learns what it was supposed to see. That is not caution — it is
// the only thing that worked. Shown the target, the agent quoted `X004X2NVXZ` back verbatim
// from a label washed out by glare that actually reads ...NVX2; told in as many words to
// transcribe character by character and never copy the expected value, it transcribed
// `X004X2NVXZ` anyway. Blinded, on the same photograph, it returned ADD_FIELD at 0.1
// confidence — "extremely faint and unreadable" — and on a clear one transcribed correctly.
describe("a matches rule is decided from the transcription, in code", () => {
  const judge = (observed, target = "X004X2NVXZ") => decideOutcome({
    inspector: { output: { verdict: "PASS", confidence: 0.9, observed, rationale: "Legible." },
                 valid: true, schemaErrors: [] },
    skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2, strictness: 1,
    acceptance: { rule: "matches", target },
  });

  test("the right part number is accepted", () => {
    assert.equal(judge("X004X2NVXZ").kind, "accept_field");
  });

  test("an honest misread does NOT pass, however confident the verdict was", () => {
    // The real transcription the blinded agent produced from the glare photograph. Before the
    // comparison moved here, this exact case passed at 0.9 — because the agent was comparing
    // a string against itself.
    const e = judge("X00EX2NVX2");
    assert.equal(e.kind, "escalate");
    assert.match(e.question, /X00EX2NVX2/);
    assert.match(e.question, /X004X2NVXZ/);
  });

  test("an illegible character is never a wildcard", () => {
    // `?` is what the Inspector is told to write where it cannot read. Treating an admitted
    // gap as "could be anything, so call it a match" would undo the reason it is asked for.
    assert.equal(judge("X004X2NVX?").kind, "escalate");
    assert.equal(transcriptionMatches("X004X2NVX?", "X004X2NVXZ"), false);
  });

  test("case and punctuation do not decide a part number", () => {
    // A label reading X004-X2NVXZ and a spec written x004x2nvxz are the same part, and
    // refusing that would teach everyone to ignore the check.
    assert.equal(judge("x004-x2nvxz").kind, "accept_field");
    assert.equal(transcriptionMatches("X004 X2NVXZ", "x004x2nvxz"), true);
  });

  test("a PASS with nothing transcribed advances nothing", () => {
    for (const observed of [undefined, null, "", "   "]) {
      assert.equal(judge(observed).kind, "hold", `observed ${JSON.stringify(observed)}`);
    }
  });

  test("an empty target is not something to match against", () => {
    assert.equal(transcriptionMatches("ABC", ""), false);
  });

  test("the rule only applies to `matches`", () => {
    const e = decideOutcome({
      inspector: { output: { verdict: "PASS", confidence: 0.9 }, valid: true, schemaErrors: [] },
      skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2, strictness: 1,
      acceptance: { rule: "must_show", target: "X004X2NVXZ" },
    });
    assert.equal(e.kind, "accept_field");
  });
});
