// Fixtures are TypeScript, not JSON, on purpose: `tsc --noEmit` then checks every fixture
// against the generated contract exactly, which is a stronger guarantee than a JSON Schema
// validator and costs no dependency. `npm run check` is the contract test.
import type { Procedure } from "@/generated/types";

/** The public, Open-tier task. Nothing to buy, nothing to install, no location, no timer. */
export const cutABanana: Procedure = {
  id: "proc_banana_v1",
  tenant_id: "anon",
  key: "cut-a-banana",
  title: "Cut a banana",
  version: 1,
  strictness: 1,
  minimum_tier: "open",
  disqualifiers: ["no banana visible in the opening capture"],
  releases: ["nothing — this is a demonstration procedure"],
  created_at: "2026-08-18T09:00:00Z",
  steps: [
    {
      id: "s1",
      index: 1,
      title: "Show the banana",
      condition: null,
      explanation:
        "Every record needs a starting state. Without one, a photograph of slices proves somebody cut something, not that they cut this.",
      max_add_fields: 2,
      fields: [
        {
          key: "banana_before",
          kind: "photo",
          prompt: "Photograph the whole, unpeeled banana",
          source: "camera",
          required_at_strictness: 0,
          acceptance_rule: "must_show",
          acceptance_description: "a single unpeeled banana, whole",
          acceptance_min: null, acceptance_max: null, acceptance_unit: null, acceptance_target: null,
          guidance: "The whole banana in frame, reasonably lit. A hand holding it is fine.",
        },
      ],
    },
    {
      id: "s2",
      index: 2,
      title: "Cut it",
      condition: null,
      explanation:
        "This is the work. A model reads the photograph, so what it can conclude is inferred — it can see slices, it cannot measure them.",
      max_add_fields: 2,
      fields: [
        {
          key: "slices",
          kind: "photo",
          prompt: "Photograph the slices",
          source: "camera",
          required_at_strictness: 0,
          acceptance_rule: "must_show",
          acceptance_description: "banana cut into separate slices, cuts running all the way through",
          acceptance_min: null, acceptance_max: null, acceptance_unit: null, acceptance_target: null,
          guidance: "Slices separated so the cuts are visible. Roughly even is enough — nobody is grading your knife work.",
        },
      ],
    },
    {
      id: "s3",
      index: 3,
      title: "Put the knife away",
      condition: null,
      explanation:
        "Nobody can verify this from a photograph, and pretending otherwise would be the exact failure this system exists to prevent. So it is asserted: you say it, by name, and the record says you said it.",
      max_add_fields: 0,
      fields: [
        {
          key: "knife_stored",
          kind: "signature",
          prompt: "Confirm the knife is stored safely",
          source: "human",
          required_at_strictness: 0,
          acceptance_rule: "signed_by",
          acceptance_target: "whoever performed the job",
          acceptance_min: null, acceptance_max: null, acceptance_unit: null, acceptance_description: null,
          guidance: "Type a name. It goes on the record as an assertion, attributed to you — not as something the system checked.",
        },
      ],
    },
  ],
};

/**
 * The floor. Two photographs, no props, no assertion — the shortest path there is from
 * nothing to a sealed record, so a judge with an empty desk can still run one end to end.
 *
 * It is also the only fixture that uses `consistent_with`. Photograph a mug, then photograph
 * a mug in your hand, and neither frame on its own says you lifted THAT mug. The second
 * capture is judged against the first rather than against a description, which is precisely
 * the check the Skeptic exists to make.
 */
export const pickUpAnObject: Procedure = {
  id: "proc_pickup_v1",
  tenant_id: "anon",
  key: "pick-up-an-object",
  title: "Pick up an object",
  version: 1,
  strictness: 1,
  minimum_tier: "open",
  disqualifiers: [
    "no object visible in the opening capture",
    "the object in the second capture is not the one in the first",
  ],
  releases: ["nothing — this is a demonstration procedure"],
  created_at: "2026-08-19T09:00:00Z",
  steps: [
    {
      id: "p1",
      index: 1,
      title: "Show it where it lies",
      condition: null,
      explanation:
        "The claim is that one object moved, so the record needs where it started — and that means a place, not just a thing. A photograph of something already in a hand cannot establish it.",
      max_add_fields: 2,
      fields: [
        {
          key: "object_before",
          kind: "photo",
          prompt: "Photograph the object where it is sitting",
          source: "camera",
          required_at_strictness: 0,
          acceptance_rule: "must_show",
          acceptance_description: "a single object resting on a surface, nobody holding it",
          acceptance_min: null, acceptance_max: null, acceptance_unit: null, acceptance_target: null,
          guidance: "Anything within reach will do. Stand back far enough that the surface under it is in frame too.",
        },
      ],
    },
    {
      id: "p2",
      index: 2,
      title: "Pick it up",
      condition: null,
      explanation:
        "Nothing in this frame is judged on its own. It is judged against the opening capture — same object or the step fails — which is what makes two ordinary photographs into evidence of a lift rather than evidence of two objects.",
      max_add_fields: 2,
      fields: [
        {
          key: "object_held",
          kind: "photo",
          prompt: "Photograph it held clear of the surface",
          source: "camera",
          required_at_strictness: 0,
          acceptance_rule: "consistent_with",
          acceptance_target: "p1.object_before",
          acceptance_min: null, acceptance_max: null, acceptance_unit: null, acceptance_description: null,
          guidance: "Lift it, hold it still, shoot. Same room and same light help — the check is continuity, not composition.",
        },
      ],
    },
  ],
};

/** The real one. Instrumented tier: it cannot run in a browser, and it says so. */
export const frontBrakeService: Procedure = {
  id: "proc_front_brake_v3",
  tenant_id: "demo.warrant.ink",
  key: "front-brake-service",
  title: "Front brake service",
  version: 3,
  strictness: 2,
  minimum_tier: "instrumented",
  disqualifiers: ["step elapsed under 12 min", "part number mismatch"],
  // Nothing consumes stock and there is no below-floor trigger — see server/stock.ts, which is a
  // read path by design. "consume 1x pad set" and "reorder below 2" were advertised here and in
  // README.md and were true in neither.
  releases: ["return to service"],
  created_at: "2026-08-14T11:20:00Z",
  steps: [
    {
      id: "b1", index: 1, title: "Remove the caliper", condition: null,
      explanation: "Establishes the machine is the one on the work order and the pads are actually accessible. The wheel stays on — you unbolt the caliper off its mount and the pads come out of it.",
      max_add_fields: 3,
      fields: [{
        key: "caliper_off", kind: "photo", prompt: "Photograph the caliper off the mount, disc visible",
        source: "camera", required_at_strictness: 0, acceptance_rule: "must_show",
        acceptance_description: "caliper off its mount, disc in frame",
        acceptance_min: null, acceptance_max: null, acceptance_unit: null, acceptance_target: null,
        guidance: "Caliper and disc both in frame.",
      }],
    },
    {
      id: "b2", index: 2, title: "Present the new part", condition: null,
      explanation: "The commonest quiet failure is the right job done with the wrong part. This resolves against the work order, so it is measured — an equality, not an opinion.",
      max_add_fields: 3,
      fields: [{
        key: "part_number", kind: "scan", prompt: "Scan or photograph the part label",
        source: "camera", required_at_strictness: 1, acceptance_rule: "matches",
        acceptance_target: "work_order.part_number",
        acceptance_min: null, acceptance_max: null, acceptance_unit: null, acceptance_description: null,
        guidance: "Label legible and square to the lens. If it is worn, photograph the box instead.",
      }],
    },
    {
      id: "b3", index: 3, title: "Fit and torque", condition: null,
      explanation: "The only step here a photograph cannot answer. A tool reports the number, so nothing about this value passed through a human — which is the entire difference between watching work and measuring it.",
      max_add_fields: 2,
      fields: [{
        key: "pad_torque", kind: "measurement", prompt: "Torque the caliper bolts",
        source: "instrument", required_at_strictness: 1, acceptance_rule: "within",
        acceptance_min: 6, acceptance_max: 9, acceptance_unit: "Nm",
        acceptance_target: null, acceptance_description: null,
        // NOT a manufacturer figure. Segway has published no caliper bolt torque for the Xyber —
        // the whole point of `interview-home-brake-pads-blocked-on-a-figure-nobody-has`. This band
        // is the SHOP'S OWN, stated by the person who does the job and set on their own wrench,
        // which is a bound the Scoper is allowed to accept. Saying "cited from the manufacturer"
        // here put a provenance claim in the guidance text that nothing in the world supports.
        guidance: "6-9 Nm, the figure this shop works to. The reading arrives from the wrench; there is nothing to type.",
      }],
    },
    {
      id: "b4", index: 4, title: "Function check", condition: null,
      explanation: "Catches the failure that only appears once everything is back together.",
      max_add_fields: 2,
      fields: [{
        key: "lever_travel", kind: "video", prompt: "Film lever travel and return",
        source: "camera", required_at_strictness: 1, acceptance_rule: "must_show",
        acceptance_description: "lever pulled and released, returning fully",
        acceptance_min: null, acceptance_max: null, acceptance_unit: null, acceptance_target: null,
        guidance: "Three or four seconds. Pull, hold, release.",
      }],
    },
  ],
};

export const procedures: Procedure[] = [cutABanana, pickUpAnObject, frontBrakeService];
