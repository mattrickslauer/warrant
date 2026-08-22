"""The Auditor — reads weeks of finished jobs and finds the defects in the procedure itself.

Every other agent judges one thing at one moment: this field's evidence, this technician's
sentence, this job's disposition. The Auditor is the only one whose subject is the procedure,
and the only one that closes the loop back to the Scoper — a defect it finds becomes an
interview question, and the interview produces a new version.

The judgement it exists for is narrower than "find patterns", and stating it precisely is what
keeps the agent honest: **a step that keeps failing is usually the procedure working.** Pads
worn past the limit on nine jobs out of forty is not a broken acceptance rule, it is a rule
catching real faults, and an agent that reports it as a defect will push a shop to loosen the
one check that was earning its keep. The defect is the *other* case — the step everyone reads
differently, the evidence nobody can physically obtain, the bound that no correctly-done job
has ever satisfied.

Three refusals carry it, and each is a way a fluent answer goes wrong:

  * **Small numbers are not patterns.** One job in forty is noise. "I do not have enough
    history" is a correct answer and the contract gives it a mode of its own, because an agent
    with no way to say that will always find something.
  * **One person is not a procedure.** If every instance traces to the same technician, the
    finding is about training, and revising the procedure would be fixing the wrong thing.
  * **It may say a bound is wrong. It may never say what the bound should be.** That figure has
    to come from the shop. Supplying it here would put a fabricated tolerance into a procedure
    by the back door — precisely the failure the Scoper's hardest scenario exists to prevent,
    arriving through a different door.
"""
from __future__ import annotations

import json
from typing import Any

from .base import Agent
from .model import Part


class Auditor(Agent):
    name = "auditor"
    schema_name = "auditor-finding"

    def parts(self, case: dict[str, Any]) -> list[Part]:
        proc = case.get("procedure", {})
        jobs = case.get("jobs", [])

        body = [
            self.block("The procedure under audit", {
                "key": proc.get("key"), "title": proc.get("title"),
                "version": proc.get("version"), "strictness": proc.get("strictness"),
                "in service since": proc.get("in_service_since")}),
            self.block(
                "Its steps, as written",
                "This is the text technicians are actually shown. Where a step is read two "
                "different ways by two people, the ambiguity is in these words.\n\n"
                + json.dumps(proc.get("steps", []), indent=2)),
        ]

        window = case.get("window", {})
        body.append(self.block("The window you are reading", {
            "from": window.get("from"), "to": window.get("to"),
            "jobs in the window": len(jobs),
            "note": "This is every job run against this procedure in the window, not a sample. "
                    "A count you compute from it is the real count."}))

        # The jobs are handed over whole rather than pre-aggregated. Counting the recurrences is
        # arithmetic the model must do against the evidence in front of it — pre-tallying them
        # here would hand it the conclusion and leave only the wording to generate.
        body.append(self.block(
            "Every job in the window",
            "Each carries its step outcomes. A step that was not performed carries the reason "
            "the technician gave, in their words, and who gave it. Those sentences are the "
            "strongest evidence in this whole document: somebody stopped work and explained "
            "why, which is a defect report written by the person the procedure failed.\n\n"
            + json.dumps(jobs, indent=2)))

        if case.get("prior_findings"):
            body.append(self.block(
                "What a previous audit already reported",
                "Do not re-report these as new. If one has not improved since it was raised, "
                "that is itself worth saying.\n\n"
                + json.dumps(case["prior_findings"], indent=2)))

        return [self.text("\n\n".join(body))]

    def check_conditionals(self, out: dict[str, Any]) -> list[str]:
        errs: list[str] = []
        mode = out.get("mode")
        findings = out.get("findings") or []

        if mode == "revise" and not findings:
            errs.append("findings: mode revise with nothing found")
        if mode in ("no_defect", "insufficient_history") and findings:
            errs.append(f"findings: must be empty when mode is {mode}")

        examined = out.get("jobs_examined")
        for i, f in enumerate(findings):
            where = f"findings.{i}"
            if not f.get("jobs_cited"):
                # An uncited finding is the one output of this agent that cannot be checked by
                # anybody, which makes it the one most worth refusing.
                errs.append(f"{where}.jobs_cited: a finding with no job behind it is an opinion")
            affected = f.get("jobs_affected")
            if isinstance(affected, int) and isinstance(examined, int) and affected > examined:
                errs.append(f"{where}.jobs_affected: {affected} of {examined} examined")
            if isinstance(affected, int) and f.get("jobs_cited"):
                # `jobs_cited` is what the finding is drawn from, not a sample of it, so a
                # count larger than the list is a claim about jobs it cannot name.
                cited = len(f["jobs_cited"])
                if affected > cited:
                    errs.append(f"{where}: claims {affected} jobs affected but names only "
                                f"{cited}")
            if f.get("defect") == "bound_wrong" and f.get("needs_the_shop") is not True:
                # The Scoper's one unbreakable rule, arriving through a different door. A new
                # tolerance can only come from the shop; an audit that hands one over has
                # fabricated a figure that every future record will carry as though a person
                # set it.
                errs.append(f"{where}.needs_the_shop: a wrong bound can only be replaced by a "
                            "figure the shop states, so this must go back through an interview")
        return errs
