"""Drive the Scoper through a whole interview and judge the procedure it compiles.

The other forty-eight scenarios ask an agent one question and check one answer. That is the
right shape for the Inspector, which really does see one field's evidence and decide. It is
the wrong shape for the Scoper, whose entire job is a sequence: knowing what it has not yet
asked, and stopping only when nothing material is unstated. A single-turn scenario can show
that the Scoper asks *a* sensible question. It cannot show that twelve of them converge.

So this runs the loop. The Scoper asks, the shop answers from a fixed sheet, and it repeats
until the Scoper compiles or runs out of turns. What is then judged is the procedure —
because that is the artefact a real shop would be handed, and every defect worth catching is
visible in it.

The check that matters is `traceable`. Every bound in the compiled procedure is compared
against the figures the shop actually said out loud. A number that appears in the procedure
and nowhere in the transcript was invented, and an invented tolerance is the one failure
this product cannot survive: it enters every future record indistinguishable from a figure a
person set, and no one downstream can tell which is which. Every scenario therefore withholds
a figure the procedure needs, so that refusing is something the run can observe rather than
something we hope for.
"""
from __future__ import annotations

from typing import Any

from evals import shop as shopsim
from warrant import REGISTRY

#: Enough turns for a real interview and few enough that a Scoper going in circles is a
#: failure rather than an expense. A scenario may lower it; nothing may raise it far.
DEFAULT_MAX_TURNS = 14


def _bounds(draft: dict[str, Any]) -> list[dict[str, Any]]:
    """Every numeric acceptance bound in a compiled procedure, with where it came from.

    Only `acceptance_min`/`acceptance_max` count. `strictness` and `max_add_fields` are
    integers the Scoper is supposed to choose; a tolerance is a figure it is supposed to be
    told. Conflating the two would make the check fire on correct behaviour.
    """
    found = []
    for step in draft.get("steps") or []:
        for field in step.get("fields") or []:
            for edge in ("acceptance_min", "acceptance_max"):
                value = field.get(edge)
                if isinstance(value, (int, float)):
                    found.append({"step": step.get("title"), "field": field.get("key"),
                                  "bound": edge, "value": float(value),
                                  "unit": field.get("acceptance_unit")})
    return found


def run_interview(case: dict[str, Any], *, live: bool = False, temperature: float = 0.0,
                  model: str | None = None) -> dict[str, Any]:
    """One full interview. Returns the summary the assertion engine judges, plus the
    transcript, which is the part a person actually wants to read."""
    scoper = REGISTRY["scoper"]()
    shop_profile = case.get("shop", {})
    facts: dict[str, str] = case.get("facts", {})
    catalogue = case.get("catalogue")
    max_turns = int(case.get("max_turns", DEFAULT_MAX_TURNS))

    conversation: list[dict[str, str]] = list(case.get("conversation", []))
    transcript: list[dict[str, Any]] = []
    asked_about: list[str] = []
    questions: list[str] = []
    off_contract: list[str] = []
    shrugs = 0
    draft: dict[str, Any] | None = None
    last: dict[str, Any] = {}
    turns = 0

    while turns < max_turns:
        turns += 1
        scoper_case = {"shop": shop_profile, "conversation": conversation,
                       "asked_about": list(asked_about), "turns_left": max_turns - turns + 1,
                       "unanswered": shrugs}
        if catalogue:
            scoper_case["catalogue"] = catalogue
        if case.get("existing_form"):
            scoper_case["existing_form"] = case["existing_form"]

        result = scoper.run(scoper_case, live=live, temperature=temperature, model=model)
        last = result.output
        entry: dict[str, Any] = {
            "turn": turns, "scoper": result.output, "prompt": result.prompt,
            "schema_errors": result.schema_errors, "cassette": result.call.key,
            "model": result.call.model, "latency_ms": result.call.latency_ms,
            "usage": result.call.usage, "cached": result.call.cached,
        }

        if result.schema_errors:
            # Terminal. A Scoper that has stopped obeying its own contract mid-interview is
            # not going to produce a procedure worth judging, and continuing would bury the
            # one failure that explains everything after it.
            off_contract = result.schema_errors
            transcript.append(entry)
            break

        if result.output.get("mode") == "compile":
            draft = result.output.get("draft")
            transcript.append(entry)
            break

        question = result.output.get("question") or ""
        questions.append(question)
        if result.output.get("asks_about"):
            asked_about.append(result.output["asks_about"])
        conversation.append({"who": "scoper", "said": question})

        reply, call = shopsim.answer(shop_profile, facts, conversation, question,
                                     live=live, temperature=temperature, model=model)
        said = reply.get("said", "")
        if not reply.get("knew_it", True):
            shrugs += 1
        conversation.append({"who": "shop", "said": said})
        entry["shop"] = {**reply, "cassette": call.key, "latency_ms": call.latency_ms,
                         "usage": call.usage, "cached": call.cached}
        transcript.append(entry)

    disclosed = shopsim.disclosed_numbers(conversation, catalogue)
    bounds = _bounds(draft) if draft else []
    invented = [b for b in bounds if b["value"] not in disclosed]

    summary = {
        "compiled": draft is not None,
        "turns": turns,
        "draft": draft,
        "asked_about": asked_about,
        "questions": questions,
        "understanding": last.get("understanding", ""),
        "unresolved": last.get("unresolved", []),
        "bounds": bounds,
        "invented_bounds": invented,
        # The headline. False the moment a figure appears that nobody ever said.
        "traceable": not invented,
        "shop_shrugs": shrugs,
        "hit_turn_cap": draft is None and not off_contract and turns >= max_turns,
    }
    return {"output": summary, "transcript": transcript, "conversation": conversation,
            "disclosed_numbers": sorted(disclosed), "schema_errors": off_contract}
