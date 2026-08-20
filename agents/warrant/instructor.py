"""The Instructor — turns "I can't do this one" into something structured and actionable.

The person is standing at the machine right now, so the recommendation has to be doable
now or say plainly that it is not. The transcript is what they actually said, including the
swearing and the trailing off, and it is not tidied up before the model sees it: the words
someone chooses when a bolt is round are evidence about the blocker.
"""
from __future__ import annotations

from typing import Any

from .base import Agent
from .model import Part


class Instructor(Agent):
    name = "instructor"
    schema_name = "instructor-recommendation"

    def parts(self, case: dict[str, Any]) -> list[Part]:
        step = case.get("step", {})
        machine = case.get("machine", {})
        proc = case.get("procedure", {})

        body = [
            self.block("The procedure", {
                "title": proc.get("title"), "version": proc.get("version"),
                "strictness": proc.get("strictness")}),
            self.block("The step they are stuck on", {
                "title": step.get("title"),
                "why it exists": step.get("explanation"),
                "what it asks for": [f["prompt"] for f in step.get("fields", [])],
                "position": f"step {step.get('index', '?')} of {proc.get('step_count', '?')}"}),
            self.block("The machine", {
                "asset id": machine.get("id"), "model": machine.get("model"),
                "hours or km": machine.get("usage"),
                "history": machine.get("history", [])}),
        ]
        if case.get("stock") is not None:
            body.append(self.block("What is on the shelf right now", case["stock"]))
        if case.get("remaining_steps"):
            body.append(self.block("Steps after this one", case["remaining_steps"]))

        body.append(self.block("What the technician said", {
            "spoken or typed": case.get("reason_kind", "voice"),
            "verbatim": case.get("transcript", "")}))

        return [self.text("\n\n".join(body))]

    def check_conditionals(self, out: dict[str, Any]) -> list[str]:
        errs: list[str] = []
        if out.get("blocker_kind") == "part_missing" and not out.get("blocking_part"):
            errs.append("blocking_part: required when blocker_kind is part_missing")
        return errs
