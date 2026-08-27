"""The screen in front of the judge, and the reason it is not an agent.

Every capture is looked at twice: once cheaply, by **Gemini 3.5 Flash-Lite**, and then —
usually — by Gemini 3.5 Flash. This module is the first look. It is NOT Gemma, and the note
on SCREENING_MODEL below is the whole account of why it could not be.

WHY THIS IS NOT AN EIGHTH AGENT. An agent here returns a verdict that lands on a record and
that a person can argue with months later. This returns nothing of the kind. It answers one
question — *is this frame so obviously unusable that spending the judgement model on it would
be waste?* — and the only thing it can cause is a technician being asked for another
photograph. It is a filter in the same position as Model Armor, and `REGISTRY` deliberately
does not contain it: `roster()` answers seven because the fleet is seven.

THE ASYMMETRY IS THE WHOLE DESIGN, and it runs one way only.

    UNUSABLE          → the capture is refused and re-asked. Costs a technician a retake.
    NEEDS_JUDGEMENT   → Flash judges it, exactly as it would have anyway.

There is no third answer. **The cheap model cannot pass a step, cannot seal a record and
cannot release a machine**, because no answer it is able to return means "satisfied". That is
not a prompt instruction that a model might ignore — `EvidenceScreen` has no PASS in its
enum, so the strongest possible screen answer still ends with the judge being asked or the
technician being asked. The worst a wrong screen can do is waste twenty seconds of somebody's
time; the worst a wrong judge can do is release a machine that should have been held. Putting
the cheap model only on the side where being wrong is recoverable is the entire reason this is
safe, and it is why the saving is worth taking.

WHAT IT IS NOT SHOWN. Not the acceptance rule, not the acceptance target, not the strictness,
not the reading. Two reasons. It cannot usurp the judgement it is screening for if it was
never told what the judgement is about; and the `matches` trap that made `inspector.py`
withhold the target applies with more force to a smaller model, not less. It sees what the
technician was asked to photograph, and it sees the photograph.
"""
from __future__ import annotations

import os
from typing import Any

from .base import Agent
from .model import Part

#: The screening model, and it is deliberately NOT Gemma.
#:
#: It was going to be. `gemma-3-4b` was in `.env` for days and both README and architecture.md
#: named Gemma in a table. It does not work, and the way it fails is worth writing down: every
#: Gemma spelling — `gemma-3-4b`, `gemma-3-4b-it`, `gemma-3-27b-it`, `gemma-3n-e4b-it`,
#: `google/gemma-3-4b-it` — returns
#:
#:     404 Publisher model `…/publishers/google/models/gemma-…` was not found or your project
#:         does not have access to it
#:
#: in both `global` and `us-central1`. That is not a permissions problem and no amount of
#: enabling fixes it. **Gemma is not a publisher model on Vertex.** It is an open model in
#: Model Garden, and using it means deploying the weights to your own GPU-backed Vertex
#: Endpoint — an endpoint that bills per hour and has to still be running when a judge watches
#: the film. `c.models.list()` on this project returns 23 models and not one of them is a Gemma.
#:
#: So the screen runs on **Flash-Lite**, which is available, is genuinely cheaper than the
#: judgement model, and leaves every architectural claim in this module intact: the screen
#: still cannot pass a step, still sees less than the judge, and still saves the Flash call.
#: What it does NOT do is earn the "additional Google AI model" bonus, because it is the same
#: Gemini family as the judge. That was never a good enough reason to put a claim in a table.
#:
#: Pointing this at a deployed Gemma is one environment variable — `SCREENING_MODEL` takes a
#: full endpoint resource name as happily as a publisher id — so the decision stays open
#: without anything here having to change.
SCREENING_MODEL = os.environ.get("SCREENING_MODEL", "gemini-3.5-flash-lite")

#: How sure an UNUSABLE has to be before it is acted on.
#:
#: High, and deliberately not a function of strictness — this is a claim about the frame, not
#: about the procedure, and a blurred photograph is blurred whether the job is a log or a
#: regulated one. Below this the capture goes to the judge anyway, which is the same thing
#: that would have happened with no screen at all. Mirrored in `web/src/server/adjudicate/
#: screen.ts`; both are tested.
SCREEN_FLOOR = 0.85

#: Defects the screen may act on. A `defect` outside this set is not obeyed — the capture
#: goes to the judge. The enum in the contract already constrains it; this is the second
#: statement, here because the value arrives from a model and `enum` is advice to a sampler
#: rather than a guarantee about bytes.
ACTIONABLE = frozenset({"nothing_in_frame", "too_dark", "too_blurred",
                        "subject_absent", "subject_obstructed",
                        "photograph_of_a_screen"})


class Screener(Agent):
    """Deliberately absent from `REGISTRY`. See the module docstring."""

    name = "screen"
    schema_name = "evidence-screen"

    def parts(self, case: dict[str, Any]) -> list[Part]:
        fd = case.get("field") or {}
        step = case.get("step") or {}

        body = [
            self.block("What the technician was asked to capture", {
                "asked of the technician": fd.get("prompt", ""),
                "kind": fd.get("kind", "photo"),
                "the step this belongs to": step.get("title", ""),
            }),
            self.block("Your question, and the only one", (
                "Is the capture below so obviously unusable that judging it would be waste?\n\n"
                "You have NOT been told what the procedure requires, what value the evidence "
                "is supposed to carry, or how strict this job is. That is on purpose: none of "
                "it is your question, and you cannot be wrong about a rule you were never "
                "shown. Whether the work was done correctly is decided after you, by a model "
                "that is given all of it.\n\n"
                "Return UNUSABLE only for a defect you can point at in the frame. If the "
                "subject is there and legible, return NEEDS_JUDGEMENT — even if what you can "
                "see looks wrong, badly done, or suspicious. Looking wrong is the judge's "
                "business and it is the commonest reason a capture must NOT be short-circuited."
            )),
        ]

        parts: list[Part] = [self.text("\n\n".join(body))]

        media = case.get("media") or []
        if media:
            parts.append(self.text(
                f"## The capture\nThe {'image' if len(media) == 1 else str(len(media)) + ' images'} "
                "below is what the technician captured. Judge only whether it can be used as "
                "evidence at all."))
            parts.extend(self.media(ref, label=ref) for ref in media)
        else:
            # No media is not a screening decision. There is nothing to look at, so there is
            # no frame to find a defect in, and the judge's own "no media was captured" path
            # is the one that should run. Saying `nothing_in_frame` here would be the screen
            # inventing an observation about an image that does not exist.
            parts.append(self.text(
                "## The capture\nNothing was captured for this field. You cannot screen an "
                "absent capture: return NEEDS_JUDGEMENT."))
        return parts

    def check_conditionals(self, out: dict[str, Any]) -> list[str]:
        """`defect` carries an explicit `none`, and that is not cosmetic.

        It was `nullable` with no `none` member for exactly one live run, and the model filled
        it every single time: four captures, four `NEEDS_JUDGEMENT` verdicts, and four stray
        defects — `subject_absent` on a photograph whose own rationale said the subject was
        "clearly visible". Offered a nullable enum, a model picks a member; null is not a value
        it reaches for. Every answer therefore failed this check, and because `acts_on`
        requires `valid`, the screen was safe and completely inert — it never fired, so it
        never saved a call. A screen that silently does nothing is the worst of the three
        outcomes, because it costs a model call to achieve nothing.

        `none` is the same fix `skeptic-verdict` already uses for `mismatch_kind`. Making it
        REQUIRED rather than nullable turns "say nothing" into "say `none`", which is a thing
        a model will actually do.
        """
        errs: list[str] = []
        defect = out.get("defect")
        if out.get("screen") == "UNUSABLE":
            if not defect or defect == "none":
                errs.append("defect: required when the screen is UNUSABLE, and never `none`")
            if not (out.get("retake_prompt") or "").strip():
                errs.append("retake_prompt: required when the screen is UNUSABLE")
        if out.get("screen") == "NEEDS_JUDGEMENT":
            # Still a contradiction, still worth refusing — a screen that names a defect and
            # then declines to act on it is telling you two different things, and `acts_on`
            # reads `screen` alone, so the stray value would be discarded rather than noticed.
            if defect not in (None, "", "none"):
                errs.append(f"defect: must be `none` when the screen is NEEDS_JUDGEMENT, "
                            f"not {defect!r}")
            if (out.get("retake_prompt") or "").strip():
                errs.append("retake_prompt: must be empty when the screen is NEEDS_JUDGEMENT")
        return errs


def acts_on(output: dict[str, Any], *, floor: float = SCREEN_FLOOR) -> bool:
    """Whether this screen answer is allowed to stop the capture before the judge.

    Ordinary code, and every clause is a way for the answer to be unusable itself:
    the wrong verdict, a defect outside the actionable set, no retake to send back, or
    confidence under the floor. A screen that fails any of them is not disobeyed — it is
    simply not acted on, and the capture goes to the judge, which is what would have
    happened had the screen never run.
    """
    if output.get("screen") != "UNUSABLE":
        return False
    if output.get("defect") not in ACTIONABLE:
        return False
    if not (output.get("retake_prompt") or "").strip():
        return False
    confidence = output.get("confidence")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        return False
    return float(confidence) >= floor
