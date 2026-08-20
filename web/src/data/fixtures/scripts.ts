// The demo timeline. THIS is what makes FixtureSource honest.
//
// Beats are indexed by step, then by capture attempt — so attempt 0 on the banana slices
// asks for a better photograph and attempt 1 passes, which is the ADD FIELD behaviour the
// real Inspector has. Edit the numbers here to retune the demo; nothing else changes.
import type { FieldDef } from "@/generated/types";

export type DemoBeat =
  | { at: number; kind: "decision"; agent: string; verdict: string; rationale: string; model?: string | null; cost?: number }
  | { at: number; kind: "add_field"; field: FieldDef }
  | { at: number; kind: "status"; status: "performed" | "deferred" | "waived" | "impossible" }
  | { at: number; kind: "escalate"; question: string };

/** stepId -> attempt index -> beats */
export type DemoScript = Record<string, DemoBeat[][]>;

const gemma = (verdict: string, rationale: string, at: number): DemoBeat =>
  ({ at, kind: "decision", agent: "inspector", verdict, rationale, model: "gemma-3-4b", cost: 0.00002 });
const flash = (verdict: string, rationale: string, at: number): DemoBeat =>
  ({ at, kind: "decision", agent: "inspector", verdict, rationale, model: "gemini-3.5-flash", cost: 0.00081 });
const skeptic = (verdict: string, rationale: string, at: number): DemoBeat =>
  ({ at, kind: "decision", agent: "skeptic", verdict, rationale, model: "multimodalembedding", cost: 0.00011 });

const reframe: FieldDef = {
  key: "slices_reframed",
  kind: "photo",
  prompt: "Photograph the slices again — get them all in frame",
  source: "camera",
  required_at_strictness: 0,
  acceptance_rule: "must_show",
  acceptance_description: "all slices visible, cuts running all the way through",
  acceptance_min: null, acceptance_max: null, acceptance_unit: null, acceptance_target: null,
  guidance: "Step back a little. The point is that every cut is visible, not that the photo is pretty.",
};

export const scripts: Record<string, DemoScript> = {
  proc_banana_v1: {
    s1: [[
      gemma("PASS", "One unpeeled banana, whole and in frame.", 700),
      { at: 1500, kind: "status", status: "performed" },
    ]],
    // The interesting one: the first capture is not good enough, and the form GROWS a field
    // the procedure did not contain when the job started.
    s2: [
      [
        gemma("ESCALATE", "Slices partly out of frame; cannot confirm the cuts run through. Deferring to Flash.", 800),
        flash("ADD_FIELD", "Two slices are cropped at the edge of the frame. Asking for a wider capture.", 2600),
        { at: 2700, kind: "add_field", field: reframe },
      ],
      [
        gemma("PASS", "All slices visible, cuts running fully through.", 900),
        { at: 1900, kind: "status", status: "performed" },
      ],
    ],
    s3: [[
      { at: 500, kind: "decision", agent: "inspector", verdict: "PASS", rationale: "Signed by name. Recorded as asserted — nothing was checked.", model: null, cost: 0 },
      { at: 1100, kind: "status", status: "performed" },
    ]],
  },

  // No escalation, no added field, no signature. Two captures and it is sealed — the banana
  // carries the drama, this one carries the floor.
  proc_pickup_v1: {
    p1: [[
      gemma("PASS", "One object at rest on a surface, no hand on it.", 600),
      { at: 1400, kind: "status", status: "performed" },
    ]],
    // The Inspector can only say something is being held. Whether it is the SAME something is
    // a different question, and a different agent answers it.
    p2: [[
      gemma("PASS", "Object clear of the surface and held.", 800),
      skeptic("BELONGS", "Same object as the opening capture — its markings and the surface behind it both carry over.", 1600),
      { at: 2200, kind: "status", status: "performed" },
    ]],
  },

  proc_front_brake_v3: {
    b1: [[
      gemma("PASS", "Wheel removed, caliper and disc both visible.", 900),
      { at: 1800, kind: "status", status: "performed" },
    ]],
    b2: [[
      flash("PASS", "Label reads 45022-KA; work order expects 45022-KA. Equality, not judgement — measured.", 1400),
      skeptic("BELONGS", "Label wear and background match this job's prior captures.", 2100),
      { at: 2600, kind: "status", status: "performed" },
    ]],
    b3: [[
      { at: 400, kind: "decision", agent: "inspector", verdict: "PASS", rationale: "28.4 Nm from tool #A19, inside 26-30. No model was asked — this is arithmetic.", model: null, cost: 0 },
      { at: 900, kind: "status", status: "performed" },
    ]],
    b4: [[
      flash("PASS", "Lever pulled and fully returned across four seconds.", 1600),
      { at: 2400, kind: "status", status: "performed" },
    ]],
  },
};
