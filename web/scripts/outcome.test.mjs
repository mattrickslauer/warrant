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

  test("an answer has no scene, so belonging does not hold it", () => {
    // The failure this pins reached a technician. Every choice, text and signature answer
    // arrives as a `text` capture with no media, the Skeptic was asked anyway, and — being
    // instructed to dissent when it cannot establish identity — it dissented every time. So
    // tapping "Responsive and quiet" on a brake service escalated the step, telling somebody
    // their correct answer might not belong to the job. It also bought a model call to say it.
    const e = decideOutcome({ inspector: pass, skeptic: "not_applicable",
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "accept_field");
  });

  test("`not applicable` and `could not be asked` stay opposite conclusions", () => {
    // The whole reason this is a third state rather than a second use of null. One means
    // there was no question to put; the other means the question went unanswered. Collapsing
    // them either holds every typed answer, or advances a photograph nobody vouched for.
    const notAsked = decideOutcome({ inspector: pass, skeptic: null,
                                     addFieldsUsed: 0, maxAddFields: 2 });
    const noQuestion = decideOutcome({ inspector: pass, skeptic: "not_applicable",
                                       addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(notAsked.kind, "hold");
    assert.equal(noQuestion.kind, "accept_field");
  });

  test("belonging being moot does not rescue a failing answer", () => {
    // `not_applicable` retires ONE of the four questions. Model Armor still screened the
    // string, the Inspector still judged it, and everything the Inspector can refuse it still
    // refuses — otherwise this would be a way to pass a step by typing into it.
    const fail = {
      output: { verdict: "FAIL", confidence: 0.9, rationale: "The answer contradicts the reading." },
      valid: true, schemaErrors: [],
    };
    const e = decideOutcome({ inspector: fail, skeptic: "not_applicable",
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.notEqual(e.kind, "accept_field");
  });

  test("a `matches` rule is compared from the answer itself", () => {
    // No `observed` in the verdict, because there was no image to read one off. Every CHOICE
    // field judged `matches` held on exactly this: the Inspector is told to transcribe what
    // it can see, a tapped answer shows it nothing, and the field then failed for want of a
    // transcription of a string the server already had.
    const read = {
      output: { verdict: "PASS", confidence: 0.9, rationale: "the rider reported it" },
      valid: true, schemaErrors: [],
    };
    const ok = decideOutcome({
      inspector: read, skeptic: "not_applicable",
      addFieldsUsed: 0, maxAddFields: 2,
      answer: "Responsive and quiet",
      acceptance: { rule: "matches", target: "Responsive and quiet" },
    });
    assert.equal(ok.kind, "accept_field");

    // And it is a real comparison, not a wave-through. Choosing the wrong answer escalates.
    const wrong = decideOutcome({
      inspector: read, skeptic: "not_applicable",
      addFieldsUsed: 0, maxAddFields: 2,
      answer: "Scraping or noisy",
      acceptance: { rule: "matches", target: "Responsive and quiet" },
    });
    assert.equal(wrong.kind, "escalate");
  });

  test("a photograph still has to be read, and the answer never stands in for one", () => {
    // The narrowness that keeps this honest. `answer` is set only for a `text` capture, so a
    // photo judged `matches` reaches the same hold it always did when nothing was transcribed.
    const read = {
      output: { verdict: "PASS", confidence: 0.9, rationale: "clear enough" },
      valid: true, schemaErrors: [],
    };
    const e = decideOutcome({
      inspector: read, skeptic: { output: { belongs: true }, valid: true },
      addFieldsUsed: 0, maxAddFields: 2,
      acceptance: { rule: "matches", target: "X004-X2NVXZ" },
    });
    assert.equal(e.kind, "hold");
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

  // A `matches` RULE WITH NO TARGET USED TO PASS, which is the worst way for this to fail.
  //
  // The guard read `if (rule === "matches" && target)`, so an absent or empty target skipped
  // the comparison entirely and the field advanced on the Inspector's confidence alone — on
  // the one rule whose whole design is that the Inspector is blinded and the comparison
  // happens HERE. A procedure with a typo in `acceptance_target` did not fail loudly; it
  // quietly stopped checking, and the record still said the part number was verified.
  for (const target of [null, undefined, ""]) {
    test(`a matches rule with target ${JSON.stringify(target)} holds rather than passing`, () => {
      const e = decideOutcome({
        inspector: {
          output: { verdict: "PASS", confidence: 0.99, observed: "ANYTHINGATALL" },
          valid: true, schemaErrors: [],
        },
        skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2, strictness: 1,
        acceptance: { rule: "matches", target },
      });
      assert.equal(e.kind, "hold",
        "a procedure that names nothing to match against cannot verify anything");
    });
  }
});

// --- `within`, which is the rule the whole product rests on -----------------------------
//
// THE COMPARISON WAS NEVER MADE. `acceptance_min` and `acceptance_max` existed in the
// contract, were rendered into the Inspector's prompt as "accepts 6 to 9 Nm", and were read
// by nothing else in the system — not here, not at ingest, not at the seal. So whether a
// torque of 40 Nm satisfied `within(6, 9)` was decided by a language model's opinion of a
// number a tool had already measured exactly.
//
// That is the precise inversion of the claim this product makes. `must_show` is a judgement
// and belongs to a model; `within` is arithmetic and never did. A measured value that a
// model is allowed to wave through is not measured, it is inferred with extra steps.
describe("decideOutcome — within() is arithmetic, not an opinion", () => {
  const band = { rule: "within", min: 6, max: 9, unit: "Nm" };
  const measured = (value, unit = "Nm") => ({ value, unit, source: "instrument" });

  test("a reading inside the band accepts the field", () => {
    const e = decideOutcome({
      inspector: pass, skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2,
      acceptance: band, reading: measured(7.4),
    });
    assert.equal(e.kind, "accept_field");
  });

  // The one that matters. The Inspector is confident, the Skeptic agrees, and the tool says
  // the bolt is at four times the torque the procedure allows.
  for (const [value, where] of [[2.1, "below"], [40, "above"]]) {
    test(`a confident PASS cannot rescue a reading ${where} the band`, () => {
      const e = decideOutcome({
        inspector: { output: { verdict: "PASS", confidence: 0.99, rationale: "Looks right." },
                     valid: true, schemaErrors: [] },
        skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2,
        acceptance: band, reading: measured(value),
      });
      assert.equal(e.kind, "escalate",
        "the tool answered this; the model does not get a vote on it");
      assert.match(e.question, /6|9|Nm/,
        "the question has to name the band a person is being asked to look at");
    });
  }

  test("an open upper bound still refuses a value under the floor", () => {
    const e = decideOutcome({
      inspector: pass, skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2,
      acceptance: { rule: "within", min: 6, max: null, unit: "Nm" }, reading: measured(3),
    });
    assert.equal(e.kind, "escalate");
  });

  test("an open lower bound still refuses a value over the ceiling", () => {
    const e = decideOutcome({
      inspector: pass, skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2,
      acceptance: { rule: "within", min: null, max: 9, unit: "Nm" }, reading: measured(12),
    });
    assert.equal(e.kind, "escalate");
  });

  // The same argument the `matches`-with-no-target case already makes, one rule over: a
  // procedure that declares a measurement and names no band has not declared a measurement.
  test("a within rule with no bounds at all holds rather than passing", () => {
    const e = decideOutcome({
      inspector: pass, skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2,
      acceptance: { rule: "within", min: null, max: null, unit: "Nm" }, reading: measured(7),
    });
    assert.equal(e.kind, "hold");
  });

  test("a within rule with no reading at all holds — there is nothing to compare", () => {
    const e = decideOutcome({
      inspector: pass, skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2,
      acceptance: band, reading: null,
    });
    assert.equal(e.kind, "hold");
  });

  // Comparing 7 lbf-ft against a band written in Nm is how spacecraft are lost. Two numbers
  // in different units are not comparable, and guessing a conversion here would be inventing
  // a measurement rather than reading one.
  test("a reading in the wrong unit holds rather than being compared", () => {
    const e = decideOutcome({
      inspector: pass, skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2,
      acceptance: band, reading: measured(7, "lbf-ft"),
    });
    assert.equal(e.kind, "hold");
    assert.match(e.why, /unit/i);
  });

  test("a non-numeric reading holds", () => {
    const e = decideOutcome({
      inspector: pass, skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2,
      acceptance: band, reading: { value: Number.NaN, unit: "Nm", source: "instrument" },
    });
    assert.equal(e.kind, "hold");
  });
});

// --- the last pass, when there is nothing left to ask ------------------------------------
//
// `ADD_FIELD` on an exhausted budget already escalates. `PASS` on one did not, and the two
// are not the same risk: on a rule code can check — `within`, `matches` — a wrong PASS is
// caught above by arithmetic. On `must_show`, `per_spec` and `consistent_with` there is
// nothing behind the model at all, so a step that has ALREADY been judged insufficient twice
// advances on the third opinion, with no remaining mechanism to ask for anything better.
//
// The rule is deliberately narrow: the system may still pass such a step, but on its last
// available opinion it has to be as sure as a regulated procedure demands. A genuine recovery
// — the technician supplied the retake and it is plainly good — clears 0.90 and is unaffected.
describe("decideOutcome — a PASS on the last opinion available", () => {
  const unverifiable = { rule: "must_show", target: null };

  test("a PASS below the regulated floor escalates once the budget is spent", () => {
    const e = decideOutcome({
      inspector: { output: { verdict: "PASS", confidence: 0.8, rationale: "Probably fine." },
                   valid: true, schemaErrors: [] },
      skeptic: belongs, addFieldsUsed: 2, maxAddFields: 2, strictness: 1,
      acceptance: unverifiable,
    });
    assert.equal(e.kind, "escalate",
      "nothing further can be asked for, so this is the system's last chance to be right");
  });

  test("a confident PASS on a spent budget still accepts", () => {
    const e = decideOutcome({
      inspector: { output: { verdict: "PASS", confidence: 0.95, rationale: "Clearly seated." },
                   valid: true, schemaErrors: [] },
      skeptic: belongs, addFieldsUsed: 2, maxAddFields: 2, strictness: 1,
      acceptance: unverifiable,
    });
    assert.equal(e.kind, "accept_field", "a real recovery must not be punished");
  });

  test("the same PASS with budget remaining is untouched", () => {
    const e = decideOutcome({
      inspector: { output: { verdict: "PASS", confidence: 0.8, rationale: "Probably fine." },
                   valid: true, schemaErrors: [] },
      skeptic: belongs, addFieldsUsed: 0, maxAddFields: 2, strictness: 1,
      acceptance: unverifiable,
    });
    assert.equal(e.kind, "accept_field", "the ordinary path must not move");
  });
});
