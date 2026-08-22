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
        if fd.get("acceptance_target"):
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
