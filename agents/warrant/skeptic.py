"""The Skeptic — does this evidence belong to this job, this machine and this moment?

It never sees the Inspector's verdict, and the prompt never mentions that an Inspector
exists. Two agents shown the same evidence and each other's conclusions agree with each
other, and the second opinion stops being one.
"""
from __future__ import annotations

from typing import Any

from .base import Agent
from .model import Part


class Skeptic(Agent):
    name = "skeptic"
    schema_name = "skeptic-verdict"

    def parts(self, case: dict[str, Any]) -> list[Part]:
        asset = case.get("asset", {})
        job = case.get("job", {})
        cap = case.get("capture", {})

        body = [
            self.block("The machine this evidence is claimed to be of", {
                "asset id": asset.get("id"), "type": asset.get("type"),
                "make and model": asset.get("model"),
                "distinguishing marks": asset.get("marks", []),
                "known history": asset.get("history", [])}),
            self.block("The job this evidence is claimed to belong to", {
                "job id": job.get("id"), "procedure": job.get("procedure"),
                "opened at": job.get("opened_at"), "location": job.get("location")}),
            self.block("The capture as recorded", {
                "kind": cap.get("kind"), "created at": cap.get("created_at"),
                "mode": cap.get("capture_mode"),
                "surface": cap.get("capture_surface"),
                "note": "upload means the file was chosen from storage and its stated time "
                        "and place are unverified"
                        if cap.get("capture_mode") == "upload" else
                        "live means the frame came off an open camera stream on the device"}),
        ]
        if case.get("embedding_distance") is not None:
            body.append(self.block("Perceptual similarity to earlier captures", {
                "nearest prior capture": case.get("nearest_prior"),
                "embedding distance": case["embedding_distance"],
                "note": "0.00 is an identical image. Below 0.05 means the same frame was "
                        "almost certainly submitted before."}))

        parts: list[Part] = [self.text("\n\n".join(body))]

        prior = case.get("prior_media") or []
        if prior:
            parts.append(self.text(
                "## Evidence already on file for this machine\n"
                "These were captured on earlier jobs. They are here so you can tell whether "
                "the new capture is the same machine, and whether it is the same photograph."))
            for ref in prior:
                parts.append(self.media(ref, label=f"prior:{ref}"))

        parts.append(self.text("## The capture in question\nThis is what was just submitted."))
        for ref in (case.get("media") or []):
            parts.append(self.media(ref, label=ref))
        if not case.get("media"):
            parts.append(self.text("Nothing was attached. You cannot establish identity from an absence."))
        return parts

    def check_conditionals(self, out: dict[str, Any]) -> list[str]:
        errs: list[str] = []
        if out.get("mismatch_kind") == "reuse" and not out.get("prior_capture_ref"):
            errs.append("prior_capture_ref: required when mismatch_kind is reuse")
        if out.get("belongs") is False and out.get("mismatch_kind") in (None, "none"):
            errs.append("mismatch_kind: a dissent must name what did not match")
        if out.get("belongs") is True and out.get("mismatch_kind") not in (None, "none"):
            errs.append("mismatch_kind: must be none when the evidence belongs")
        return errs
