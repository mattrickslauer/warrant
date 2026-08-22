"""Interview the Scoper yourself, at a terminal, and keep what it compiles.

    python3 -m evals talk --key xyber-rear-brake-pads

Everything else in `evals/` runs the Scoper against a shop played by a model. This runs it
against you. The loop is identical — the same agent, the same contract, the same validation —
and the only thing that changes is who answers.

Three things come out of one session, and the third is the point:

  * **A procedure**, written to `procedures/<key>.json`, ready to publish to a tenancy.
  * **A transcript**, so what was said is recoverable rather than remembered.
  * **A scenario**, written to `evals/scenarios/scoper/`, whose facts are the answers YOU gave.

That last one closes a loop the corpus badly needs. Every interview scenario in this repo is
currently a situation somebody invented at a keyboard, which is a weak kind of evidence for an
agent whose whole job is handling what real people actually say. A conversation with a real
mechanic about a real machine is worth more than any number of imagined ones, and this turns
each of them into a permanent regression test at no extra cost.

On figures nobody publishes: if a manufacturer has never stated a torque and never will, the
honest figure is your own house standard, said out loud and attributed to you. That is a
figure that came from the shop, which is exactly what the Scoper is built to accept — what it
refuses is a figure that came from nobody. Answer "I don't know" freely; it is a real answer
and the agent is tested on handling it.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from evals import report as rep
from evals.interview import DEFAULT_MAX_TURNS, _bounds
from evals.shop import disclosed_numbers
from warrant import REGISTRY
from warrant.model import ModelUnavailable

HERE = Path(__file__).resolve().parent
PROCEDURES = HERE.parent / "procedures"
SCENARIOS = HERE / "scenarios" / "scoper"


def _ask(prompt: str) -> str:
    """One line from the person. Ctrl-D or Ctrl-C ends the interview without losing it."""
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return ""


def _profile(args: Any) -> dict[str, str]:
    if args.shop:
        return json.loads(Path(args.shop).read_text())
    print(f"{rep.DIM}A few things about you first. Enter to skip any of them.{rep.RESET}")
    return {
        "trade": _ask("  What kind of outfit is this?          ") or "a workshop",
        "machines": _ask("  What machines do you work on?         ") or "machines",
        "technicians": _ask("  How many of you are there?            ") or "unstated",
        "stakes": _ask("  What happens if a job is done badly?  ") or "unstated",
    }


def _show_draft(draft: dict[str, Any]) -> None:
    print(f"\n{rep.GREEN}It compiled.{rep.RESET} {draft.get('title')}")
    print(f"{rep.DIM}  key {draft.get('key')} · strictness {draft.get('strictness')} · "
          f"tier {draft.get('minimum_tier')}{rep.RESET}")
    for d in draft.get("disqualifiers") or []:
        print(f"  {rep.RED}stops the job:{rep.RESET} {d}")
    for i, step in enumerate(draft.get("steps") or [], 1):
        print(f"\n  {rep.BOLD}{i}. {step.get('title')}{rep.RESET}")
        print(f"     {rep.DIM}{step.get('explanation', '')[:150]}{rep.RESET}")
        for f in step.get("fields") or []:
            bits = [f.get("kind", "?"), f.get("acceptance_rule", "?")]
            if f.get("acceptance_min") is not None or f.get("acceptance_max") is not None:
                bits.append(f"{f.get('acceptance_min')}–{f.get('acceptance_max')} "
                            f"{f.get('acceptance_unit') or ''}".strip())
            if f.get("acceptance_target"):
                bits.append(f"vs {f['acceptance_target']}")
            print(f"     - {f.get('key')}  {rep.DIM}({', '.join(str(b) for b in bits)}){rep.RESET}")


def cmd_talk(args: Any) -> int:
    scoper = REGISTRY["scoper"]()
    shop = _profile(args)
    max_turns = args.max_turns

    print(f"\n{rep.DIM}Answer as you would to another mechanic. \"I don't know\" is a real "
          f"answer.\nEmpty line ends it early. Up to {max_turns} questions.{rep.RESET}\n")

    conversation: list[dict[str, str]] = []
    facts: dict[str, str] = {}
    asked_about: list[str] = []
    transcript: list[dict[str, Any]] = []
    unanswered = 0
    draft: dict[str, Any] | None = None
    last: dict[str, Any] = {}

    for turn in range(1, max_turns + 1):
        case = {"shop": shop, "conversation": conversation, "asked_about": list(asked_about),
                "turns_left": max_turns - turn + 1, "unanswered": unanswered}
        try:
            result = scoper.run(case, live=True, temperature=args.temperature)
        except ModelUnavailable as e:
            print(f"{rep.RED}the model is unreachable: {e}{rep.RESET}", file=sys.stderr)
            return 2
        last = result.output

        if result.schema_errors:
            # Surfaced rather than swallowed: the same rule the suite applies, applied here.
            print(f"{rep.YELLOW}off-contract, stopping:{rep.RESET} "
                  f"{'; '.join(result.schema_errors)}", file=sys.stderr)
            break

        if result.output.get("mode") == "compile":
            draft = result.output.get("draft")
            transcript.append({"turn": turn, "scoper": result.output})
            break

        question = result.output.get("question") or ""
        klass = result.output.get("asks_about") or "?"
        print(f"{rep.BOLD}{turn}.{rep.RESET} {question}")
        print(f"{rep.DIM}   ({klass}; {len(result.output.get('unresolved') or [])} "
              f"still open){rep.RESET}")
        said = _ask("   > ")
        if not said:
            print(f"{rep.DIM}   ending the interview here.{rep.RESET}")
            break

        # Their own words are the fact sheet. Nothing is paraphrased into it, because the
        # scenario this becomes has to replay what was actually said.
        facts[f"turn {turn} — {klass}: {question}"] = said
        if re.search(r"\b(no idea|don'?t know|dunno|not sure|by feel|look it up)\b", said, re.I):
            unanswered += 1
        asked_about.append(klass)
        conversation += [{"who": "scoper", "said": question}, {"who": "shop", "said": said}]
        transcript.append({"turn": turn, "scoper": result.output, "shop": {"said": said}})

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    key = args.key or (draft or {}).get("key") or f"interview-{stamp}"

    if draft:
        _show_draft(draft)
        disclosed = disclosed_numbers(conversation)
        invented = [b for b in _bounds(draft) if b["value"] not in disclosed]
        if invented:
            # The same arithmetic the suite runs, run here, because a procedure authored in a
            # real conversation deserves the check at least as much as an imagined one.
            print(f"\n{rep.RED}WARNING — {len(invented)} figure(s) appear in this procedure "
                  f"that you never said:{rep.RESET}")
            for b in invented:
                print(f"  {b['field']}: {b['value']} {b['unit'] or ''}")
            print(f"{rep.DIM}  Do not publish this until you have checked them.{rep.RESET}")
        else:
            print(f"\n{rep.GREEN}Every figure in it traces back to something you said.{rep.RESET}")
        PROCEDURES.mkdir(parents=True, exist_ok=True)
        out = PROCEDURES / f"{key}.json"
        out.write_text(json.dumps(
            {"key": key, "at": stamp, "shop": shop, "draft": draft,
             "conversation": conversation, "disclosed_numbers": sorted(disclosed),
             "invented_bounds": invented}, indent=2) + "\n")
        print(f"{rep.DIM}procedure written to {out}{rep.RESET}")
    else:
        print(f"\n{rep.YELLOW}No procedure — it still had open questions:{rep.RESET}")
        for u in last.get("unresolved") or []:
            print(f"  · {u}")
        print(f"{rep.DIM}That is a real answer. Run it again when you can close them.{rep.RESET}")

    if args.save_scenario and facts:
        SCENARIOS.mkdir(parents=True, exist_ok=True)
        path = SCENARIOS / f"interview-real-{key}.json"
        path.write_text(json.dumps({
            "agent": "scoper", "kind": "interview",
            "title": f"a real interview about {key.replace('-', ' ')}",
            "why": (f"Recorded from an actual conversation on {stamp} rather than imagined at a "
                    "keyboard. The facts below are what a working mechanic said, in their own "
                    "words, about a machine they own — which is stronger evidence about this "
                    "agent than any invented situation, because the thing being tested is how "
                    "it handles what people actually say."),
            "input": {"shop": shop, "facts": facts, "max_turns": max_turns},
            "expect": {"is_true": ["traceable"], "absent": ["invented_bounds"]},
        }, indent=2) + "\n")
        print(f"{rep.DIM}scenario written to {path}{rep.RESET}")
    return 0
