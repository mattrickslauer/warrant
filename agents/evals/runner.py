"""Run the scenario corpus and say what happened.

    python3 -m evals check                     # load every scenario, call nothing
    python3 -m evals media                     # what still needs photographing
    python3 -m evals list --agent inspector
    python3 -m evals run --live                # record cassettes for anything new
    python3 -m evals run                       # replay, free, offline
    python3 -m evals run --agent skeptic --id reuse -v
    python3 -m evals diff runs/<a> runs/<b>

`run` without `--live` replays cassettes and touches no network, so the suite is part of
the smoke test and costs nothing. A prompt edit changes the cassette key, so the scenarios
it affects are exactly the ones that need `--live` again — the rest stay free.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals import report as rep                        # noqa: E402
from evals.assertions import BadAssertion, evaluate, validate_expect  # noqa: E402
from warrant import REGISTRY, MediaMissing             # noqa: E402
from warrant.model import DEFAULT_MODEL, ModelUnavailable  # noqa: E402

HERE = Path(__file__).resolve().parent
SCENARIOS = HERE / "scenarios"
RUNS = HERE / "runs"


class ScenarioError(ValueError):
    pass


def _short(path: Path) -> str:
    """Readable in the report, and never a crash when scenarios live elsewhere
    (tests point SCENARIOS at a temp directory)."""
    try:
        return str(path.relative_to(HERE))
    except ValueError:
        return str(path)


def load_scenarios(agent: str | None = None, needle: str | None = None) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for path in sorted(SCENARIOS.rglob("*.json")):
        try:
            case = json.loads(path.read_text())
        except json.JSONDecodeError as e:
            raise ScenarioError(f"{_short(path)}: {e}") from e
        case["_path"] = _short(path)
        folder = path.parent.name
        case.setdefault("agent", folder)
        case.setdefault("id", f"{folder}/{path.stem}")

        problems = []
        if case["agent"] not in REGISTRY:
            problems.append(f"unknown agent {case['agent']!r}")
        for key in ("why", "input", "expect"):
            if key not in case:
                problems.append(f"missing {key!r}")
        if isinstance(case.get("expect"), dict):
            problems += validate_expect(case["expect"])
        if case.get("kind") == "interview":
            if case["agent"] != "scoper":
                problems.append("kind interview is only defined for the scoper")
            if not (case.get("input") or {}).get("facts"):
                problems.append("an interview needs input.facts for the shop to answer from")
        if problems:
            raise ScenarioError(f"{case['_path']}: " + "; ".join(problems))

        if agent and case["agent"] != agent:
            continue
        if needle and needle not in case["id"]:
            continue
        found.append(case)
    return found


def run_one(case: dict[str, Any], *, live: bool, temperature: float,
            model: str | None = None) -> dict[str, Any]:
    agent = REGISTRY[case["agent"]]()
    row: dict[str, Any] = {"id": case["id"], "agent": case["agent"],
                           "title": case.get("title", ""), "why": case.get("why", ""),
                           "path": case["_path"], "kind": case.get("kind", "turn")}
    if case.get("kind") == "interview":
        return _run_interview(case, row, live=live, temperature=temperature, model=model)
    try:
        result = agent.run(case["input"], live=live, temperature=temperature, model=model)
    except MediaMissing as e:
        # Never scored as a pass or a fail: the agent was not shown what the scenario claims.
        return {**row, "status": "error", "error": f"media: {e}"}
    except ModelUnavailable as e:
        return {**row, "status": "error", "error": str(e)}
    except json.JSONDecodeError as e:
        return {**row, "status": "error", "error": f"model returned unparseable JSON: {e}"}
    except Exception as e:  # a bug in an agent's prompt builder, surfaced not swallowed
        return {**row, "status": "error",
                "error": f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}"}

    row.update(output=result.output, cached=result.call.cached,
               latency_ms=result.call.latency_ms, usage=result.call.usage,
               cassette=result.call.key, schema_errors=result.schema_errors,
               model=result.call.model, prompt=result.prompt)

    if result.schema_errors:
        # Off-contract is terminal: assertions about a field the model never returned would
        # report noise on top of the one failure that actually matters.
        return {**row, "status": "invalid", "checks": []}

    try:
        checks = [asdict(c) for c in evaluate(result.output, case["expect"])]
    except BadAssertion as e:
        return {**row, "status": "error", "error": str(e)}
    return {**row, "status": "pass" if all(c["ok"] for c in checks) else "fail",
            "checks": checks}


def _run_interview(case: dict[str, Any], row: dict[str, Any], *, live: bool,
                   temperature: float, model: str | None) -> dict[str, Any]:
    """A whole conversation scored as one scenario.

    The summary `run_interview` returns is a plain object, so every operator the single-turn
    scenarios already use works on it unchanged — `is_true` on `traceable` reads exactly like
    `equals` on a verdict, and there is one assertion vocabulary rather than two.
    """
    from evals.interview import run_interview
    try:
        outcome = run_interview(case["input"], live=live, temperature=temperature, model=model)
    except MediaMissing as e:
        return {**row, "status": "error", "error": f"media: {e}"}
    except ModelUnavailable as e:
        return {**row, "status": "error", "error": str(e)}
    except json.JSONDecodeError as e:
        return {**row, "status": "error", "error": f"model returned unparseable JSON: {e}"}
    except Exception as e:
        return {**row, "status": "error",
                "error": f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}"}

    turns = outcome["transcript"]
    row.update(output=outcome["output"], transcript=turns,
               conversation=outcome["conversation"],
               disclosed_numbers=outcome["disclosed_numbers"],
               schema_errors=outcome["schema_errors"],
               model=(turns[-1]["model"] if turns else (model or DEFAULT_MODEL)),
               cached=all(t.get("cached") for t in turns) if turns else False,
               latency_ms=sum(t.get("latency_ms", 0) for t in turns),
               usage={"totalTokenCount": sum(
                   (t.get("usage") or {}).get("totalTokenCount", 0) for t in turns)},
               prompt=(turns[-1]["prompt"] if turns else {}),
               cassette=(turns[-1]["cassette"] if turns else ""))

    if outcome["schema_errors"]:
        return {**row, "status": "invalid", "checks": []}
    try:
        checks = [asdict(c) for c in evaluate(outcome["output"], case["expect"])]
    except BadAssertion as e:
        return {**row, "status": "error", "error": str(e)}
    return {**row, "status": "pass" if all(c["ok"] for c in checks) else "fail",
            "checks": checks}


def cmd_run(args: argparse.Namespace) -> int:
    cases = load_scenarios(args.agent, args.id)
    if not cases:
        print("no scenarios matched", file=sys.stderr)
        return 2
    mode = "live" if args.live else "replay"
    print(f"{len(cases)} scenarios, {mode}", file=sys.stderr)

    started = time.time()
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(
            lambda c: run_one(c, live=args.live, temperature=args.temperature,
                              model=args.model), cases))

    print(rep.render(results, verbose=args.verbose))
    print(f"{rep.DIM}{time.time() - started:.1f}s{rep.RESET}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out = Path(args.out) if args.out else RUNS / stamp
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(
        {"at": stamp, "mode": mode, "temperature": args.temperature,
         "model": args.model or DEFAULT_MODEL, "results": results}, indent=2))
    print(f"{rep.DIM}written to {out}{rep.RESET}", file=sys.stderr)

    latest = RUNS / "latest"
    RUNS.mkdir(parents=True, exist_ok=True)
    latest.write_text(str(out))

    failed = sum(1 for r in results if r["status"] != "pass")
    return 1 if failed and not args.allow_fail else 0


def cmd_check(args: argparse.Namespace) -> int:
    """Every scenario loads, every operator exists, every media file is on disk.

    Catches the whole class of mistakes that would otherwise be discovered one model call
    at a time, and costs nothing."""
    cases = load_scenarios(args.agent, args.id)
    missing: list[str] = []
    for case in cases:
        agent = REGISTRY[case["agent"]]()
        try:
            agent.parts(case["input"])
        except MediaMissing as e:
            missing.append(f"  {case['id']}: {e}")
        except Exception as e:
            missing.append(f"  {case['id']}: {type(e).__name__}: {e}")
    print(f"{len(cases)} scenarios load, "
          f"{len(set(c['agent'] for c in cases))} agents, "
          f"{sum(len(c['expect']) for c in cases)} assertion groups")
    if missing:
        print(f"{rep.RED}{len(missing)} cannot be built:{rep.RESET}")
        print("\n".join(missing))
        return 1
    print(f"{rep.GREEN}every scenario builds a prompt{rep.RESET}")
    return 0


def cmd_media(args: argparse.Namespace) -> int:
    """What the corpus still needs photographed, and which scenario is waiting on it."""
    from evals.manifest import MANIFEST, MEDIA, SUPPLIED, status
    present, missing = status()
    for path in sorted(MANIFEST):
        here = path in present
        mark = f"{rep.GREEN}have{rep.RESET}" if here else f"{rep.YELLOW}need{rep.RESET}"
        print(f"  {mark}  {path}")
        if not here or args.verbose:
            what, who = MANIFEST[path]
            print(f"        {what}")
            print(f"        {rep.DIM}for {who}{rep.RESET}")
    for path, note in SUPPLIED.items():
        ok = (MEDIA / path).exists()
        print(f"  {rep.GREEN + 'have' + rep.RESET if ok else rep.RED + 'GONE' + rep.RESET}  "
              f"{path}  {rep.DIM}{note}{rep.RESET}")
    print(f"\n{len(present)}/{len(MANIFEST)} taken — see evals/media/SHOTS.md")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    for case in load_scenarios(args.agent, args.id):
        print(f"{case['id']:<44} {case.get('title', '')}")
        if args.verbose:
            print(f"    {rep.DIM}{case['why']}{rep.RESET}")
    return 0


def cmd_diff(args: argparse.Namespace) -> int:
    print(rep.diff(rep.load(args.before), rep.load(args.after)))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="evals", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--agent", help="only this agent")
        sp.add_argument("--id", help="substring of the scenario id")
        sp.add_argument("-v", "--verbose", action="store_true")
        return sp

    r = common(sub.add_parser("run", help="run the corpus"))
    r.add_argument("--live", action="store_true", help="call Vertex; records cassettes")
    r.add_argument("--temperature", type=float, default=0.0)
    r.add_argument("--model", help=f"override the model (default {DEFAULT_MODEL}); the "
                                   "cassette key includes it, so two models never share a "
                                   "recording and the same scenario can be compared across them")
    r.add_argument("--jobs", type=int, default=6)
    r.add_argument("--out", help="write results here instead of runs/<timestamp>")
    r.add_argument("--allow-fail", action="store_true", help="exit 0 even with failures")
    r.set_defaults(fn=cmd_run)

    common(sub.add_parser("check", help="load and build every prompt, call nothing")).set_defaults(fn=cmd_check)
    common(sub.add_parser("list", help="list scenarios")).set_defaults(fn=cmd_list)
    common(sub.add_parser("media", help="what still needs photographing")).set_defaults(fn=cmd_media)

    d = sub.add_parser("diff", help="compare two runs")
    d.add_argument("before")
    d.add_argument("after")
    d.set_defaults(fn=cmd_diff)

    args = p.parse_args(argv)
    try:
        return args.fn(args)
    except ScenarioError as e:
        print(f"{rep.RED}scenario is malformed{rep.RESET}\n  {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
