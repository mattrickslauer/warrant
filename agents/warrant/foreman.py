"""The Foreman — owns one job for its whole life and disposes of a step nobody could do.

Everything it decides has to survive being read months later by someone in a dispute, and
it may be woken days after the job stalled with nothing but what it wrote down. So the
disposition carries its own wake-up time and its own reason; there is no ambient context to
fall back on.

It recommends holding the machine. It does not hold it. The Gate reads the record and
decides deterministically, because a hold that depends on a model's mood is not a hold.
"""
from __future__ import annotations

from typing import Any

from .base import Agent
from .model import Part


class Foreman(Agent):
    name = "foreman"
    schema_name = "foreman-disposition"

    def parts(self, case: dict[str, Any]) -> list[Part]:
        job = case.get("job", {})
        step = case.get("step", {})
        rec = case.get("recommendation", {})

        body = [
            self.block("The job", {
                "id": job.get("id"), "procedure": job.get("procedure"),
                "opened": job.get("opened_at"), "now": job.get("now"),
                "days open": job.get("days_open"),
                "machine": job.get("asset_id"),
                "customer booking": job.get("booking"),
                "steps outstanding": job.get("steps_outstanding")}),
            self.block("The step that could not be performed", {
                "title": step.get("title"),
                "why it exists": step.get("explanation"),
                "does the machine's safety depend on it": step.get("safety_critical", "unstated")}),
            self.block("What the Instructor made of it", {
                "the technician's reason": rec.get("reason_summary"),
                "blocker": rec.get("blocker_kind"),
                "recommended to the person on the floor": rec.get("recommended_action"),
                "status they proposed": rec.get("proposed_status"),
                "part blocking it": rec.get("blocking_part"),
                "safety flag": rec.get("safety_flag")}),
        ]
        if case.get("history"):
            body.append(self.block("What has already happened on this job", case["history"]))
        if case.get("stock") is not None:
            body.append(self.block("Stock and orders", case["stock"]))
        if case.get("waiver_request"):
            w = case["waiver_request"]
            body.append(self.block("Someone is asking for this to be waived", {
                "who": w.get("by"), "their role": w.get("role"),
                "do they hold waiver standing on this tenant": w.get("has_standing"),
                "what they said": w.get("said"),
                "note": "A waiver requires a NAMED person who holds standing. If they do not "
                        "hold it, you may not waive, however senior they sound."}))
        body.append(self.block("Today", job.get("now", "unstated")))
        return [self.text("\n\n".join(body))]

    def check_conditionals(self, out: dict[str, Any]) -> list[str]:
        errs: list[str] = []
        need = {"chase": "chase_after", "reorder": "reorder_part", "escalate": "escalate_to_role"}
        key = need.get(out.get("action", ""))
        if key and not out.get(key):
            errs.append(f"{key}: required when action is {out['action']}")
        return errs
