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
        asset = case.get("asset") or {}
        job = case.get("job", {})
        cap = case.get("capture", {})

        body = [
            self._subject(asset),
            self.block("The job this evidence is claimed to belong to", {
                "job id": job.get("id"), "procedure": job.get("procedure"),
                "opened at": job.get("opened_at"), "location": job.get("location")}),
            *([self._step(case["step"])] if case.get("step") else []),
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
            parts.append(self.text(
                "Nothing was attached. This is the other place an absence decides it: a "
                "capture with no evidence in it cannot be shown to belong to anything, and "
                "there is no frame here for you to point at. Dissent."))
        return parts

    @staticmethod
    def _step(step: dict[str, Any]) -> str:
        """Which part of the job this frame answers.

        THE PROCEDURE NAME IS NOT THE STEP, and this block exists because the agent conflated
        them the first time a two-step procedure was run in front of anyone.

        Observed on the bundled `proc_smile_v1`: step 1 asks for a face that is deliberately
        NOT smiling, because a smile only means something measured against one. The Skeptic was
        told "procedure: proc_smile_v1", shown a neutral face, and dissented with
        mismatch_kind 'scene' — reasoning that the procedure requires a smiling expression and
        the subject was not smiling. Every word of that was true. It was also the correct
        evidence for the step, and the dissent escalated a step the technician had performed
        exactly as asked.

        The failure was structural rather than a bad call. Handed a procedure title and no
        step, "does the scene fit the job" can only be answered against the job as a whole, and
        every before/after procedure in the corpus opens on a frame that contradicts its own
        title by design: the whole banana, the object still on the desk, the face not yet
        smiling. Those opening frames are the ones the comparison rests on, so the one capture
        the procedure cannot do without was the one guaranteed to draw a dissent.

        Title and position only. What a correct frame LOOKS like stays out — that question
        belongs to another agent and this one must not be able to guess its answer.

        `parts` omits this block outright when no step is named, rather than printing one with
        a null subject. Every caller on the adjudication path supplies one, so the empty case
        is a scenario file that forgot rather than a state the product reaches.
        """
        index, of = step.get("index"), step.get("of")
        # Omitted rather than nulled, like every other absent fact in this fleet. "position:
        # null" is a slot the model can fill in, and "None of None" reads as a step standing
        # outside the procedure it belongs to.
        position = {"position": f"{index} of {of}"} if index and of else {}
        return Skeptic.block("The step this capture answers", {
            "step": step.get("title"),
            **position,
            "what this changes about the scene question":
                "A procedure runs several steps and its name describes the whole job, never a "
                "single frame. Steps routinely record a BEFORE state — the machine still "
                "together, the object still where it lay, the work not yet begun — and that "
                "state is the point of the capture rather than evidence against it. So judge "
                "this frame against the step named above, not against the procedure title. A "
                "frame that does not show the finished job is not a scene mismatch when the "
                "step asked for what came first, and the fact that you cannot tell which half "
                "of a before-and-after you are holding is not one either."})

    @staticmethod
    def _subject(asset: dict[str, Any]) -> str:
        """What this evidence is claimed to be OF — which is not always a machine.

        A job that names a registered asset gets the asset. A job that names none gets told
        so, in as many words, and gets the asset question withdrawn.

        That second branch is not a softening. Handed a block headed "the machine" with
        every field null, the honest reading of "if you cannot establish identity, dissent"
        is a dissent — and a dissent on a PASS escalates deterministically. So the public
        procedures, which never name an asset and never will, could not seal a record at
        all: the one path built for a stranger with an empty desk was the one path
        guaranteed to end at a person. The fault was in the question, not the answer.

        What survives is everything an assetless job can actually decide: when the capture
        was made, whether the scene fits the STEP, and whether the frame has been submitted
        before. Reuse is the cheat this demo exists to catch, and it is untouched here.
        """
        if asset.get("id"):
            return Skeptic.block("The machine this evidence is claimed to be of", {
                "asset id": asset.get("id"), "type": asset.get("type"),
                "make and model": asset.get("model"),
                "distinguishing marks": asset.get("marks", []),
                "known history": asset.get("history", []),
                # THE MODEL IS NOT THE UNIT, and this sentence exists because the agent
                # conflated them on camera-quality evidence.
                #
                # Observed 24 Aug: handed a wide workshop photograph with nothing
                # individually identifying in it and no prior capture to compare against,
                # the Skeptic answered `belongs: true` at 0.9 — reasoning that the frame
                # showed "a Segway Xyber e-bike on a lift in a workshop", which is a
                # statement about the MODEL. Every machine in this shop is that model. The
                # answer would have been identical for any of the twelve, which is precisely
                # the substitution the Skeptic exists to refuse.
                #
                # It went unnoticed for as long as the corpus fiction was a Honda while the
                # photographs were of an e-bike: the agent dissented on the make mismatch and
                # scored as correct. Making the fiction match the machine is what exposed it.
                "what recognising the model does NOT establish":
                    "Confirming the make and model is not identifying this unit. The shop "
                    "runs several machines of this exact model and colour, so a frame that "
                    "would look the same photographed on any of them establishes nothing "
                    "about which one this is. Identity comes from the distinguishing marks "
                    "above, from a prior capture of this same unit, or from something in the "
                    "frame unique to it. THIS IS THE ONE PLACE AN ABSENCE DECIDES IT: a job "
                    "that names a specific registered machine is asserting that this frame is "
                    "of that machine, and if none of those marks is present and there is "
                    "nothing to compare against, the assertion is unsupported. Dissent, name "
                    "'asset', and say what was missing. Everywhere else you need something you "
                    "can point at."})
        return Skeptic.block("What this evidence is claimed to be of", {
            "registered asset": None,
            "note": "This job names no registered asset, and the procedure it runs is not "
                    "tied to one — the subject is whatever the technician was asked to "
                    "photograph. Asset identity is therefore not a question you can decide "
                    "here and not one you are being asked: do not dissent on it, and never "
                    "return mismatch_kind 'asset'. Judge only what remains decidable — the "
                    "time the capture was made, whether the scene is consistent with the STEP "
                    "named below, and whether this frame has been submitted before."})

    def check_conditionals(self, out: dict[str, Any]) -> list[str]:
        errs: list[str] = []
        if out.get("mismatch_kind") == "reuse" and not out.get("prior_capture_ref"):
            errs.append("prior_capture_ref: required when mismatch_kind is reuse")
        if out.get("belongs") is False and out.get("mismatch_kind") in (None, "none"):
            errs.append("mismatch_kind: a dissent must name what did not match")
        if out.get("belongs") is True and out.get("mismatch_kind") not in (None, "none"):
            errs.append("mismatch_kind: must be none when the evidence belongs")
        return errs
