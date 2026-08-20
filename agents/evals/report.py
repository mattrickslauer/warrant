"""Turning a run into something you can act on in one glance.

The report is the product here. A suite that prints "12 failed" makes you open twelve
files; a suite that prints which assertion failed, on which field, with what the model
actually said, tells you whether to change the prompt or change the test.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

BOLD, DIM, RED, GREEN, YELLOW, BLUE, RESET = (
    "\033[1m", "\033[2m", "\033[31m", "\033[32m", "\033[33m", "\033[34m", "\033[0m")

MARK = {"pass": f"{GREEN}pass{RESET}", "fail": f"{RED}FAIL{RESET}",
        "invalid": f"{RED}SCHEMA{RESET}", "error": f"{YELLOW}ERROR{RESET}"}


def render(results: list[dict[str, Any]], *, verbose: bool = False) -> str:
    out: list[str] = []
    by_agent: dict[str, list[dict[str, Any]]] = {}
    for r in results:
        by_agent.setdefault(r["agent"], []).append(r)

    for agent, rows in sorted(by_agent.items()):
        passed = sum(1 for r in rows if r["status"] == "pass")
        head = f"{BOLD}{agent}{RESET}  {passed}/{len(rows)}"
        out.append(f"\n{head}  {DIM}{'─' * max(0, 62 - len(agent) - len(str(passed)))}{RESET}")
        for r in sorted(rows, key=lambda x: x["id"]):
            name = r["id"].split("/", 1)[-1]
            cached = f"{DIM}cached{RESET}" if r.get("cached") else f"{r.get('latency_ms', 0)}ms"
            out.append(f"  {MARK[r['status']]}  {name:<34} {DIM}{cached}{RESET}")
            if r["status"] == "error":
                out.append(f"        {YELLOW}{r['error']}{RESET}")
                continue
            if r["status"] == "invalid":
                for e in r["schema_errors"]:
                    out.append(f"        {RED}contract: {e}{RESET}")
            for c in r.get("checks", []):
                if not c["ok"]:
                    out.append(f"        {RED}{c['op']}({c['path']}) {c['detail']}{RESET}")
            if verbose or r["status"] in ("fail", "invalid"):
                out.append(f"        {DIM}why: {r.get('why', '')}{RESET}")
                out.append(f"        {BLUE}said: {_one_line(r.get('output', {}))}{RESET}")
    out.append("")
    out.append(summary(results))
    return "\n".join(out)


def _one_line(output: dict[str, Any]) -> str:
    """The answer, compressed to the fields that carry the decision."""
    keep = ("verdict", "belongs", "mode", "status", "action", "blocker_kind",
            "confidence", "safety_flag", "mismatch_kind", "proposed_status", "hold_machine")
    head = {k: output[k] for k in keep if k in output}
    tail = output.get("rationale") or output.get("recommended_action") \
        or output.get("question") or output.get("reason_summary") or ""
    s = json.dumps(head) + ((" " + str(tail)) if tail else "")
    return s if len(s) <= 200 else s[:197] + "..."


def summary(results: list[dict[str, Any]]) -> str:
    n = len(results)
    counts = {k: sum(1 for r in results if r["status"] == k)
              for k in ("pass", "fail", "invalid", "error")}
    cost = sum(r.get("usage", {}).get("totalTokenCount", 0) or 0 for r in results)
    live = sum(1 for r in results if not r.get("cached") and r["status"] != "error")
    bits = [f"{BOLD}{counts['pass']}/{n} pass{RESET}"]
    if counts["fail"]:
        bits.append(f"{RED}{counts['fail']} fail{RESET}")
    if counts["invalid"]:
        bits.append(f"{RED}{counts['invalid']} off-contract{RESET}")
    if counts["error"]:
        bits.append(f"{YELLOW}{counts['error']} error{RESET}")
    bits.append(f"{DIM}{live} live call{'s' if live != 1 else ''}, {cost} tokens{RESET}")
    return "  ".join(bits)


def diff(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> str:
    """What a change to a prompt actually did. The only question worth asking after an edit."""
    a = {r["id"]: r for r in before}
    b = {r["id"]: r for r in after}
    fixed, broke, still, gone, new = [], [], [], [], []
    for sid, rb in b.items():
        ra = a.get(sid)
        if ra is None:
            new.append(sid)
        elif ra["status"] != "pass" and rb["status"] == "pass":
            fixed.append(sid)
        elif ra["status"] == "pass" and rb["status"] != "pass":
            broke.append((sid, rb["status"]))
        elif rb["status"] != "pass":
            still.append(sid)
    gone = [s for s in a if s not in b]

    out = []
    for label, items, colour in (("fixed", fixed, GREEN), ("BROKE", broke, RED),
                                 ("still failing", still, YELLOW),
                                 ("new", new, BLUE), ("no longer run", gone, DIM)):
        if not items:
            continue
        out.append(f"{colour}{BOLD}{label} ({len(items)}){RESET}")
        for i in items:
            out.append(f"  {i[0] + '  ' + i[1] if isinstance(i, tuple) else i}")
    if not out:
        return f"{DIM}no change{RESET}"
    pa = sum(1 for r in a.values() if r["status"] == "pass")
    pb = sum(1 for r in b.values() if r["status"] == "pass")
    out.append(f"\n{BOLD}{pa}/{len(a)} -> {pb}/{len(b)}{RESET}")
    return "\n".join(out)


def load(path: str | Path) -> list[dict[str, Any]]:
    p = Path(path)
    if p.is_dir():
        p = p / "results.json"
    return json.loads(p.read_text())["results"]
