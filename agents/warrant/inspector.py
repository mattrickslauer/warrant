"""The Inspector — PASS, ADD FIELD or ESCALATE on one field's evidence.

It judges one field at a time, not a step and never a job. The narrow frame is deliberate:
an agent shown a whole step will trade a weak photo off against a strong one and pass the
step, and the record then claims something no single piece of evidence supports.
"""
from __future__ import annotations

from typing import Any

from .base import Agent
from .model import Part

#: Confidence a PASS has to clear, by procedure strictness. The contract says "below the
#: strictness threshold you must not return PASS" without naming the numbers; they live
#: here because they are policy, and policy is versioned with the code that applies it.
THRESHOLD = {0: 0.50, 1: 0.60, 2: 0.75, 3: 0.90}

STRICTNESS_NAME = {0: "log", 1: "standard", 2: "assured", 3: "regulated"}


class Inspector(Agent):
    name = "inspector"
    schema_name = "inspector-verdict"

    def parts(self, case: dict[str, Any]) -> list[Part]:
        step = case["step"]
        fd = case["field"]
        strictness = case.get("strictness", 1)
        used = case.get("add_fields_used", 0)
        cap = int(step.get("max_add_fields", 2))

        rule = [f"acceptance_rule: {fd['acceptance_rule']}"]
        if fd.get("acceptance_min") is not None or fd.get("acceptance_max") is not None:
            unit = fd.get("acceptance_unit") or ""
            rule.append(f"accepts {fd.get('acceptance_min')} to {fd.get('acceptance_max')} {unit}".strip())
        if fd.get("acceptance_description"):
            rule.append(f"the media must show: {fd['acceptance_description']}")
        # THE TARGET IS WITHHELD FOR A `matches` RULE, and this is the whole mechanism.
        #
        # Telling an agent what the evidence is supposed to say and then asking whether it says
        # that is not a check; it is an invitation. Shown a label washed out by glare and a
        # target of `X004X2NVXZ`, this agent answered "the part number X004X2NVXZ is legible",
        # from a photograph whose label actually reads ...NVX2.
        #
        # Instructing it not to copy the target DID NOT WORK. Told in as many words to
        # transcribe character by character, to write `?` for anything illegible, and never to
        # copy the expected value, it transcribed `X004X2NVXZ` — the target, exactly, final Z
        # and all. A prompt cannot fix this, because the string is in the context and the model
        # has no way to tell a memory from a reading.
        #
        # So it is not shown the string. It transcribes what it can see, and `outcome.ts`
        # compares. This is the same move that makes the Skeptic worth asking — it never learns
        # the Inspector's verdict, so its agreement means something — applied to transcription:
        # you cannot confirm an answer you were never given.
        if fd.get("acceptance_target") and fd.get("acceptance_rule") != "matches":
            rule.append(f"resolves against: {fd['acceptance_target']}")

        body = [
            self.block("The step", {"title": step["title"],
                                    "why it exists": step.get("explanation", "")}),
            self.block("The field you are judging", {
                "key": fd["key"], "kind": fd["kind"], "asked of the technician": fd["prompt"],
                "source": fd["source"], "what good looks like": fd.get("guidance", ""),
                "acceptance": "; ".join(rule)}),
        ]

        if case.get("reading") is not None:
            r = case["reading"]
            body.append(self.block("The instrument reading", {
                "value": r.get("value"), "unit": r.get("unit"),
                "source": r.get("source", "instrument"),
                "note": "This number was read off a paired instrument, not typed by a person."
                        if r.get("source") == "instrument" else
                        "This number was TYPED BY A PERSON. It is a claim, not a measurement."}))
        if case.get("answer") is not None:
            body.append(self.block("What the technician entered", str(case["answer"])))

        cap_note = (f"{used} of {cap} ADD FIELD requests on this step are already spent."
                    + (" You have none left: if the evidence is still insufficient you must ESCALATE."
                       if used >= cap else ""))

        # What passing this field would actually assert, spelled out for THIS field.
        #
        # The standing instruction can say "the evidence being clear is not a pass" and still
        # lose, because an acceptance description is often written as a photographic
        # requirement rather than a condition — "close enough to judge whether any usable
        # thickness remains" asks for a photograph, and a photograph of ruined pads satisfies
        # it to the letter. Observed: a sharp side-on shot of pads worn through to the metal,
        # rationale "allowing for an accurate assessment of the remaining friction material,
        # which is extremely thin", verdict PASS. The model saw it. It answered the question
        # the words asked instead of the question the step exists to settle.
        #
        # So the assertion is restated as a sentence about the world, next to the reason the
        # step exists, and the answer is demanded before the verdict. This goes in the user
        # turn and not the standing instruction for the same reason the Scoper's coverage
        # block does: it is a fact about THIS field, not a rule about the job.
        if fd.get("acceptance_rule") == "matches":
            # AN AGENT TOLD WHAT IT IS LOOKING FOR WILL FIND IT.
            #
            # Observed, and it is the most dangerous thing this agent does: shown a label
            # washed out by glare and an acceptance target of `X004X2NVXZ`, it answered "the
            # part number X004X2NVXZ is visible and readable", quoting the expected string back
            # verbatim — final Z and all — from a photograph whose label actually reads
            # ...NVX2. It did not read the label. It confirmed the string it had been handed,
            # which is exactly what a verification agent must never do, and the failure is
            # invisible because the rationale reads like a careful observation.
            #
            # So the transcription is demanded separately from the judgement, and the
            # comparison is taken away from the model entirely — `outcome.ts` compares
            # `observed` against the target in ordinary code. The model reads; the code decides.
            body.append(self.block("Transcribe. You have not been told the answer.", (
                "This field's rule is `matches`, and you have DELIBERATELY NOT been shown what "
                "the evidence is supposed to say. Nothing in this prompt contains it.\n\n"
                "Put in `observed` exactly what you can read in the image, character by "
                "character. Where a character is illegible, write `?` for it — a `?` is a "
                "useful answer and a guessed character is a false one, because the comparison "
                "is made in ordinary code from what you write here.\n\n"
                "Your verdict is therefore NOT about whether it matches, which you cannot know. "
                "It is about whether the evidence can be read at all: PASS if you could "
                "transcribe it with confidence, ADD_FIELD if it is unreadable and another "
                "photograph would fix that, ESCALATE if no photograph would."
            )))

        body.append(self.block("What a PASS would assert", (
            f"That this is true of the machine: {fd.get('acceptance_description') or '; '.join(rule)}.\n"
            f"The step exists because: {step.get('explanation', 'unstated')}.\n\n"
            "State what the evidence shows about that assertion BEFORE you choose a verdict, "
            "and put it in your rationale. If what you can see makes the assertion FALSE, the "
            "verdict is not PASS — however sharp, well lit and honest the photograph is. "
            "Asking for another photograph of a condition already visible is not a remedy, so "
            "that case is an ESCALATE, not an ADD FIELD."
        )))
        body.append(self.block("Conditions", {
            "strictness": f"{strictness} ({STRICTNESS_NAME.get(strictness, '?')})",
            "confidence a PASS must clear": THRESHOLD.get(strictness, 0.6),
            "add field budget": cap_note,
            "capture surface": case.get("capture", {}).get("capture_surface", "unknown"),
            "capture mode": case.get("capture", {}).get("capture_mode", "unknown"),
        }))

        parts: list[Part] = [self.text("\n\n".join(body))]

        # What `consistent_with` resolves against, as pixels.
        #
        # The rule line above can say "resolves against: p1.object_before" all it likes; a
        # field key is not an image, and an Inspector shown only the new frame cannot decide
        # consistency with anything. It escalated instead, every single time, which read as
        # the model being cautious when it was the prompt being incomplete.
        #
        # Attached BEFORE the evidence and labelled, because the order is the only thing
        # telling the model which frame the acceptance rule is about. Judging the reference
        # against the rule would fail every correct job in exactly the same way.
        reference = case.get("reference") or {}
        ref_media = reference.get("media") or []
        if ref_media:
            parts.append(self.text(
                f"## The reference\nThe {'image' if len(ref_media) == 1 else str(len(ref_media)) + ' images'} "
                f"below {'is' if len(ref_media) == 1 else 'are'} the earlier capture this field "
                f"resolves against ({reference.get('target') or 'an earlier field'}). It is NOT "
                "what you are judging. It is what the evidence must be consistent WITH — same "
                "object, same machine, same subject, whatever this field's rule asks. Differences "
                "of angle, distance, lighting or a hand entering the frame are expected and are "
                "not inconsistencies; a different object is."))
            parts.extend(self.media(ref, label=f"reference:{ref}") for ref in ref_media)

        media = case.get("media") or []
        if media:
            parts.append(self.text(
                f"## The evidence\nThe {'image' if len(media) == 1 else str(len(media)) + ' images'} "
                "below is what the technician captured for this field. Judge what you can "
                "actually see in it. If you cannot see enough to decide, say what specifically "
                "is missing — never ask for a generic retry."))
            parts.extend(self.media(ref, label=ref) for ref in media)
        else:
            parts.append(self.text("## The evidence\nNo media was captured for this field."))
        return parts

    def check_conditionals(self, out: dict[str, Any]) -> list[str]:
        errs: list[str] = []
        verdict = out.get("verdict")
        if verdict == "ADD_FIELD":
            for k in ("add_field_key", "add_field_kind", "add_field_prompt"):
                if not out.get(k):
                    errs.append(f"{k}: required when verdict is ADD_FIELD")
        if verdict == "ESCALATE" and not out.get("escalation_question"):
            errs.append("escalation_question: required when verdict is ESCALATE")
        if verdict == "PASS":
            for k in ("add_field_key", "add_field_prompt", "escalation_question"):
                if out.get(k):
                    errs.append(f"{k}: must be null when the verdict is PASS")
        return errs

    def check_conditionals_for(self, out: dict[str, Any], field: dict[str, Any]) -> list[str]:
        """The rules that need the FIELD as well as the answer.

        `check_conditionals` sees only what the agent returned, and "required when the rule is
        matches" is a statement about the question rather than the answer. Kept separate rather
        than widening the base signature, which every other agent would then have to ignore.
        """
        errs = self.check_conditionals(out)
        if field.get("acceptance_rule") == "matches" and out.get("verdict") == "PASS" \
                and not (out.get("observed") or "").strip():
            errs.append("observed: required to PASS a `matches` rule — the comparison is made "
                        "from what you transcribed, and nothing was transcribed")
        return errs
