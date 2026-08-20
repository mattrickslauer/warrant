"""The shop the Scoper interviews, played by a model against a fixed sheet of facts.

This lives in `evals/` and not in `warrant/` on purpose. It is not one of the five agents;
it ships with nothing. It exists because the Scoper cannot be tested by a pre-written
transcript: the whole difficulty of the agent is *which question it decides to ask next*,
and a script can only answer the questions someone already predicted. Replay a fixed
conversation and you have tested that the Scoper can read, not that it can interview.

So the shop is given a sheet — the figures this shop genuinely has — and one line is drawn
through it. About its own practice it is fluent, because a mechanic describing the job they
do every week is not guessing. About *figures* it holds nothing but the sheet, and anything
outside it gets the answer a real shop gives: it is in the manual somewhere, or we go by
feel. That shrug is the point. Every scenario withholds at least one figure the procedure
needs, because the Scoper's load-bearing refusal is declining to invent it, and you cannot
observe a refusal without giving it something to refuse.

Drawing the line at figures rather than at knowledge is what keeps the scenario honest in
both directions. A shop that cannot describe its own work is not a hard interview, it is an
absurd one, and a Scoper tested against it would be tuned for an interviewee that does not
exist. The traceability check below is arithmetic over numbers, so it loses nothing.

The sheet is also the ledger. What the shop said is the complete set of figures the Scoper
was ever legitimately told, so a number in the compiled procedure that is not in the
transcript was not remembered — it was made up. `disclosed_numbers` below is what turns
that from a judgement call into arithmetic.
"""
from __future__ import annotations

import re
from typing import Any

from warrant.model import Call, Part, generate_json

#: Not in `contract/`, deliberately. The contract is the set of promises the product makes
#: about what its agents return; a test double makes no promises to anybody, and putting it
#: there would imply Warrant ships a fake shop.
SHOP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "said": {"type": "string",
                 "description": "Your answer, one or two sentences, the way a mechanic "
                                "actually talks. Not a specification, not a list."},
        "used_facts": {"type": "array", "items": {"type": "string"},
                       "description": "The exact keys from your facts that you drew on. "
                                      "Empty if you did not have the answer."},
        "knew_it": {"type": "boolean",
                    "description": "False if the question asked for something your facts "
                                   "do not contain."},
    },
    "required": ["said", "used_facts", "knew_it"],
}

INSTRUCTION = """You run a workshop and someone is interviewing you about a job you do every week.

Talk about your own work the way you would to another mechanic: what you do, in what order,
what you look at, what worries you. You have done this a thousand times and you are fluent
about it. Describing your own practice is not guessing — it is your trade.

What you do not have is paperwork.

- NEVER state a number, a tolerance, a torque, a part number or a specification that is not
  in your facts. Not an estimate, not a typical value, not a figure you would expect to be
  right. If it is not on your sheet you do not have it: say it would be in the manual, or
  that you go by feel, and set knew_it to false.
- Everything that is not a figure — what you do, why you do it, what you would refuse to
  release — answer plainly, from the job described in your facts.
- One or two sentences, in a mechanic's voice. Not a specification, not a list.
- You are busy and you want to get back to work. You are not trying to be a good interviewee.
"""


def _fact_block(facts: dict[str, str]) -> str:
    return "\n".join(f"- {k}: {v}" for k, v in facts.items())


def answer(shop: dict[str, Any], facts: dict[str, str], conversation: list[dict[str, str]],
           question: str, *, live: bool = False, temperature: float = 0.0,
           model: str | None = None) -> tuple[dict[str, Any], Call]:
    """One reply from the shop. Recorded through the same cassette store as everything else,
    so an interview replays turn for turn without touching the network."""
    parts = [Part(text="\n\n".join([
        f"## Who you are\n{shop.get('trade', 'a workshop')}, "
        f"{shop.get('technicians', 'a few')} technicians, working on "
        f"{shop.get('machines', 'machines')}.\n"
        f"What is at stake if a job is done badly: {shop.get('stakes', 'unstated')}.",
        f"## Your facts\n{_fact_block(facts)}",
        "## The conversation so far\n" + ("\n".join(
            f"{t['who']}: {t['said']}" for t in conversation) or "Nothing yet."),
        f"## What you have just been asked\n{question}",
    ]))]
    call = generate_json(INSTRUCTION, parts, SHOP_SCHEMA, temperature=temperature,
                         live=live, **({"model": model} if model else {}))
    return call.output, call


_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")

#: People say figures out loud. "We bin the pads at two millimetres" states a bound exactly as
#: much as "2 mm" does, and reading only digits would mark a Scoper that correctly wrote 2 as
#: having invented it — a false accusation on the one check this whole suite turns on, and the
#: worst possible direction for it to be wrong in.
_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100,
}
_WORD_RE = re.compile(r"\b(" + "|".join(_WORDS) + r")\b", re.I)


def numbers_in(text: str) -> set[float]:
    """Every figure a piece of text contains, written either way.

    Ranges need no special handling: "27-33 Nm" yields both ends, which is exactly the pair
    a `within` rule is entitled to use.
    """
    out: set[float] = set()
    for m in _NUMBER.finditer(text or ""):
        try:
            out.add(float(m.group()))
        except ValueError:
            pass
    for m in _WORD_RE.finditer(text or ""):
        out.add(float(_WORDS[m.group().lower()]))
    return out


def disclosed_numbers(conversation: list[dict[str, str]],
                      catalogue: str | dict[str, Any] | None = None) -> set[float]:
    """Every figure the Scoper was legitimately given: said aloud by the shop, or present
    in a catalogue it was explicitly told it may look things up in.

    Deliberately generous — it counts numbers from anywhere in the shop's speech, not just
    the answer to the question a bound came from. A traceability check that is too clever
    starts failing on correct behaviour, and a check nobody trusts gets deleted. Generous
    still catches the failure that matters: a figure nobody ever uttered.
    """
    seen: set[float] = set()
    for turn in conversation:
        if turn.get("who") == "shop":
            seen |= numbers_in(turn.get("said", ""))
    if catalogue:
        seen |= numbers_in(catalogue if isinstance(catalogue, str) else str(catalogue))
    return seen
