"""The Scoper — interviews a shop until a procedure would run unambiguously, then compiles it.

There is no form builder anywhere in Warrant, and this agent is the reason. A shop describes
the job it already does; the procedure is the transcript of that conversation, compiled.

The hard part is not generating steps — a model will happily produce twelve plausible ones.
It is knowing what it has not yet asked, and refusing to invent a tolerance that nobody
stated. A fabricated bound would propagate into every future record as though a person had
set it, which is the precise failure the whole product exists to prevent.
"""
from __future__ import annotations

from typing import Any

from .base import Agent
from .contract import agent_schema
from .model import Part


class Scoper(Agent):
    name = "scoper"
    schema_name = "scoper-turn"

    def parts(self, case: dict[str, Any]) -> list[Part]:
        shop = case.get("shop", {})
        body = [
            self.block("The shop", {
                "trade": shop.get("trade"), "machines they work on": shop.get("machines"),
                "how many technicians": shop.get("technicians"),
                "what is at stake if a job is done badly": shop.get("stakes")}),
        ]
        if case.get("catalogue"):
            body.append(self.block("Figures you may look up rather than ask for", case["catalogue"]))
        if case.get("existing_form"):
            body.append(self.block(
                "A paper form they use today",
                "Compile from this where it is unambiguous, and ask about every part of it "
                "that is not. A tick box on paper almost never states its own acceptance rule.\n\n"
                + case["existing_form"]))

        turns = case.get("conversation", [])
        if turns:
            body.append(self.block("The conversation so far", "\n".join(
                f"{t['who']}: {t['said']}" for t in turns)))
        else:
            body.append(self.block("The conversation so far",
                                   "Nothing yet. This is your opening question."))

        body.append(self.block("Your turn", {
            "turns used": len(turns),
            "note": "If the last thing they said was vague, do not accept it and move on. "
                    "Vague now is a procedure that two technicians run differently forever."}))
        coverage = self._coverage(case)
        if coverage:
            body.append(coverage)

        parts: list[Part] = [self.text("\n\n".join(body))]

        # The paper form as the shop actually holds it, rather than as somebody typed it up.
        #
        # A form reaches this agent two ways and they are not equivalent. Pasted text has
        # already been through a transcription, and whoever did it silently decided what each
        # tick box meant. A photograph or a PDF has not: the model sees the ruled columns, the
        # unit printed above one of them, the box a technician has been writing "OK" in for a
        # year. Attached rather than described for the same reason the Inspector is shown
        # pixels — a description of a document is somebody's reading of it, and this agent's
        # whole job is to refuse to inherit a reading nobody stated.
        #
        # It is a document, not evidence. Nothing here becomes a capture and nothing here is
        # sealed; the job surface refuses uploads on purpose and that is untouched.
        docs = case.get("existing_form_media") or []
        if docs:
            many = len(docs) > 1
            parts.append(self.text(
                f"## The paper form itself\nThe {str(len(docs)) + ' documents' if many else 'document'} "
                f"below {'are' if many else 'is'} the form this shop fills in today. Compile "
                "from it where it is unambiguous and ask about every part of it that is not. A "
                "tick box on paper almost never states its own acceptance rule, and a column "
                "headed only 'pressure' does not say in what unit or between which figures it "
                "passes. Read no bound into it that is not printed on it."))
            parts.extend(self.media(ref, label=ref) for ref in docs)
        return parts

    @staticmethod
    def _coverage(case: dict[str, Any]) -> str:
        """What this interview has not yet asked about, named class by class.

        The contract asks the Scoper to know what it has not yet covered, and then never shows
        it. Left to reconstruct that from the transcript it does what anyone would: it follows
        the thread in front of it. Observed, that looks like ten turns spent on how you tell
        fork oil from road grime while the pad wear limit — the figure the record is actually
        decided by — is never asked at all.

        So the classes it has used are counted back to it. This goes in the user turn and not
        the standing instruction on purpose: it is a fact about this conversation, not a rule
        about the job, and the instruction is already as long as this endpoint will take.
        """
        asked = case.get("asked_about")
        if asked is None:
            return ""
        classes = agent_schema("scoper-turn")["properties"]["asks_about"]["enum"]
        covered = sorted({a for a in asked if a in classes})
        untouched = [c for c in classes if c not in covered]
        lines = [f"Asked about so far: {', '.join(covered) or 'nothing yet'}.",
                 f"Never asked about: {', '.join(untouched) or 'nothing left'}."]
        if case.get("turns_left") is not None:
            lines.append(f"Turns left before this interview ends: {case['turns_left']}.")
        lines.append(
            "Detail beneath a step can always be pursued one level further and never runs out. "
            "A tolerance is asked once or never, and a procedure with no figure in it cannot "
            "decide anything. While tolerance or failure is still untouched, that is the next "
            "question.")
        # An interview is finite, and a shop that has told you everything it knows will not
        # know more on turn twelve than it did on turn nine. Left without this the Scoper
        # keeps a list of qualitative unknowns the shop cannot close, that list never empties,
        # and it therefore never compiles — the shop is walked through an hour of questions
        # and handed nothing, which is a worse outcome than a procedure with a gap named in it.
        # Five questions in a row that the shop could not answer is the observed failure mode:
        # it asks for a disc spec, then which manual holds it, then that manual's part number,
        # descending a branch the shop was never going to have. The count is a fact about the
        # conversation it cannot read off the transcript on its own, and naming it is what lets
        # it tell "they are being vague" apart from "they do not have this".
        blanks = case.get("unanswered")
        if blanks:
            lines.append(
                f"The shop has been unable to answer {blanks} of your questions. They are not "
                "being evasive; they do not hold these. Another wording of the same question, "
                "or a question one level beneath it, will not produce them.")
        left = case.get("turns_left")
        if left is not None and left <= 2:
            lines.append(
                f"This interview ends in {left} turn{'' if left == 1 else 's'}. Anything the "
                "shop has already said it does not know will not arrive now. Keep in unresolved "
                "only what would change what the record decides, and if what is left would not, "
                "compile.")
        return "## What you have not yet asked\n" + "\n".join(lines)

    def check_conditionals(self, out: dict[str, Any]) -> list[str]:
        errs: list[str] = []
        mode = out.get("mode")
        if mode == "ask":
            if not out.get("question"):
                errs.append("question: required when mode is ask")
            if not out.get("asks_about"):
                errs.append("asks_about: required when mode is ask")
            if out.get("draft"):
                errs.append("draft: must be null while still asking")
        if mode == "compile":
            draft = out.get("draft")
            if not draft:
                errs.append("draft: required when mode is compile")
            if out.get("unresolved"):
                errs.append("unresolved: must be empty to compile; it is not")
            if draft:
                errs.extend(self._check_draft(draft))
        return errs

    @staticmethod
    def _check_draft(draft: dict[str, Any]) -> list[str]:
        """The compiled procedure has to obey the rules the contract states in prose.

        `minimum_tier` in particular is derived, never chosen: a procedure that asks for an
        instrument reading but declares itself runnable on a browser would be refused at run
        time, and the shop would never learn why.
        """
        errs: list[str] = []
        steps = draft.get("steps") or []
        if not steps:
            errs.append("draft.steps: a compiled procedure with no steps")
        fields = [f for s in steps for f in (s.get("fields") or [])]
        if any(f.get("source") == "instrument" for f in fields) \
                and draft.get("minimum_tier") != "instrumented":
            errs.append("draft.minimum_tier: a field with source instrument forces instrumented")
        for f in fields:
            if f.get("acceptance_rule") == "within" and \
                    f.get("acceptance_min") is None and f.get("acceptance_max") is None:
                errs.append(f"draft.{f.get('key')}: acceptance_rule within with no bound")
            if f.get("acceptance_rule") == "must_show" and not f.get("acceptance_description"):
                errs.append(f"draft.{f.get('key')}: must_show with nothing it must show")
            if f.get("kind") == "choice" and len(f.get("choices") or []) < 2:
                # Observed, not hypothetical: asked to compile a brake job whose torque figure
                # nobody had, the Scoper wrote `caliper_tightness_check` with the single choice
                # "Tightened firmly by feel". A field whose only permitted answer is that the
                # work was done cannot record it going wrong — it is the tick in the box this
                # product exists to replace, and it slips past every numeric check because it
                # contains no number to check.
                errs.append(f"draft.{f.get('key')}: a choice with "
                            f"{len(f.get('choices') or [])} option(s) cannot record the job "
                            "going wrong; offer the failing answer too")
        keys = [f.get("key") for f in fields]
        if len(keys) != len(set(keys)):
            errs.append("draft: two fields share a key")
        return errs
