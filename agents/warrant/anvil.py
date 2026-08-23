"""The five gates, and the one client that talks to the thing that runs the code.

`specs/2026-08-19-wright-design.md` §7 settles for plausibility and calls the trade deliberate.
The trade stays. But four of the five gates below are free once the frames are already in hand,
and together they are considerably stronger than plausibility alone:

    1 · Compiles    the anvil returned ok            syntax, types, a class that is not a Driver
    2 · Decodes     every sampled frame yielded a    a decode that works on the one frame it
                    value                            was shown and nothing else
    3 · Plausible   every value inside the driver's  wildly wrong widths and endianness
                    OWN declared range
    4 · Tracks      values move the way the world    wrong offset, wrong width, wrong
                    moved                            endianness, and the battery-level decoy
    5 · Unit named  the unit is a physical unit      a number nobody can name the meaning of

**Gate 4 is where this earns its keep**, and it is the only gate that cannot be computed from
the driver alone: it needs frames captured while a person deliberately moved the quantity and
said which way. That is why `wright-turn` has a `sample_while_changing` probe with a mandatory
`instruction` field — there is somebody holding the device, and they have to be told what to do.

Gates 3 and 5 read the driver's declared unit and range **out of the compiled class**, not out
of the model's JSON. A driver that claims `degC` in its answer and writes `count` in its source
is caught here, and it is the sort of divergence that is otherwise invisible.

Nothing in this module imports the SDK, and the gates are pure functions over numbers — the
anvil client is the only part that touches a socket, and every gate is testable without it.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from .wright import NON_UNITS

ANVIL_URL = os.environ.get("WARRANT_ANVIL", "http://127.0.0.1:8099")

#: How long to wait on the anvil. A cold compile is a couple of seconds; anything past this is
#: the service being unwell, which is a different fact from the driver being wrong.
ANVIL_TIMEOUT = int(os.environ.get("WARRANT_ANVIL_TIMEOUT", "90"))


class AnvilUnreachable(RuntimeError):
    """The anvil is down. NEVER to be confused with a driver that failed to compile.

    A driver that will not compile is a normal outcome of the loop and comes back as a 200.
    If this is raised, no statement about the driver has been made at all, and recording one
    would mark a rejection against code nobody ever ran.
    """


@dataclass
class Gate:
    """One gate, and enough detail that a person reading a rejected driver can see why."""
    name: str
    passed: bool
    detail: str


@dataclass
class Forged:
    """What happened to one candidate driver."""
    ok: bool
    gates: list[Gate] = field(default_factory=list)
    values: list[float] = field(default_factory=list)
    #: `lint` / `compile` / `execute` when the anvil refused it, else None.
    stage: str | None = None
    unit: str | None = None
    declared_min: float | None = None
    declared_max: float | None = None
    ms: int = 0

    @property
    def failed(self) -> list[Gate]:
        return [g for g in self.gates if not g.passed]

    def feedback(self) -> str:
        """What goes back to Wright as the reason this attempt was rejected.

        Written as instructions to whoever wrote the code, because that is who reads it. The
        compiler's own message is passed through verbatim — a real `e: (14, 31): expecting ')'`
        is worth more than any paraphrase of it, and rewording it would be inventing detail
        about code we did not write.
        """
        return "; ".join(f"{g.name}: {g.detail}" for g in self.failed) or "accepted"


# --- the anvil ---------------------------------------------------------------------------
def run_on_anvil(kotlin: str, frames: list[str], *, url: str | None = None) -> dict[str, Any]:
    """Compile and execute one driver. Returns the anvil's answer verbatim.

    A rejected driver comes back `{"ok": false, "stage": ..., "error": ...}` with a 200, and
    that is a normal result, not an exception. Only the anvil itself being unreachable raises.
    """
    body = json.dumps({"kotlin": kotlin, "frames": frames}).encode()
    request = urllib.request.Request(
        (url or ANVIL_URL).rstrip("/") + "/run", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=ANVIL_TIMEOUT) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as e:
        # 5xx is the anvil admitting it is broken. Reporting that as a compile failure would
        # burn Wright's whole retry budget rewriting code that was never the problem.
        raise AnvilUnreachable(f"anvil returned {e.code}: {e.read()[:200]!r}") from e
    except Exception as e:
        raise AnvilUnreachable(f"anvil at {url or ANVIL_URL} is not answering: {e}") from e


# --- the gates ---------------------------------------------------------------------------
def gate_tracks(values: list[float], direction: str) -> Gate:
    """Gate 4. Did the number follow the world?

    Two conditions, and the second is the one that catches the interesting failures:

    * **Net movement matches the direction a person was asked to move it in.** A decoding that
      falls while the probe was being warmed is measuring something else, however smooth it
      looks.
    * **No single step is larger than the whole net movement.** A wrong width or a wrong
      endianness usually still trends the right way — it just lurches, because the byte the
      decode is reading rolls over. Comparing a step against the SPAN would be vacuous, since
      no step can exceed the span by definition; comparing it against the net movement is what
      separates a quantity that drifted from one that jumped.
    """
    if direction not in ("rising", "falling"):
        return Gate("tracks", False,
                    f"no direction was recorded for the tracking capture ({direction!r}), so "
                    "there is nothing to check the values against")
    if len(values) < 3:
        return Gate("tracks", False,
                    f"{len(values)} tracking sample(s); a trend needs at least 3")

    net = values[-1] - values[0]
    if direction == "rising" and net <= 0:
        return Gate("tracks", False,
                    f"the quantity was moved UP and the decoding went {values[0]} to "
                    f"{values[-1]}, which is the wrong way")
    if direction == "falling" and net >= 0:
        return Gate("tracks", False,
                    f"the quantity was moved DOWN and the decoding went {values[0]} to "
                    f"{values[-1]}, which is the wrong way")

    travel = abs(net)
    jumps = [abs(b - a) for a, b in zip(values, values[1:])]
    worst = max(jumps)
    if worst > travel:
        return Gate("tracks", False,
                    f"one step of {worst:g} is larger than the whole movement of {travel:g} — "
                    "the decoding lurches rather than follows, which is what a wrong width or "
                    "endianness looks like even when the trend is right")
    return Gate("tracks", True,
                f"{values[0]:g} to {values[-1]:g}, {direction}, largest step {worst:g}")


def gate_unit(unit: str | None) -> Gate:
    """Gate 5. `count` and `raw` are what gets written when something decoded successfully and
    the writer cannot say what it decoded."""
    name = (unit or "").strip()
    if name.lower() in NON_UNITS:
        return Gate("unit named", False,
                    f"{unit!r} does not name a physical unit; a number whose unit nobody can "
                    "name is not a measurement and must not be filed as one")
    return Gate("unit named", True, name)


def gate_plausible(values: list[float], lo: float | None, hi: float | None) -> Gate:
    """Gate 3, against the range the COMPILED driver declares about itself."""
    if lo is None or hi is None:
        return Gate("plausible", False, "the driver declares no range to be plausible within")
    if lo >= hi:
        return Gate("plausible", False,
                    f"declared range {lo} to {hi} is not a range, and a degenerate range "
                    "passes a plausibility check trivially")
    outside = [v for v in values if not (lo <= v <= hi)]
    if outside:
        return Gate("plausible", False,
                    f"{len(outside)} of {len(values)} decoded values fall outside the driver's "
                    f"own declared {lo} to {hi}: {outside[:4]}")
    return Gate("plausible", True, f"all {len(values)} inside {lo} to {hi}")


def forge(kotlin: str, frames: list[str], *, tracking: list[str] | None = None,
          direction: str | None = None, url: str | None = None) -> Forged:
    """Put one candidate driver through every gate that the evidence in hand supports.

    `frames` are ordinary captures; `tracking` are frames taken while somebody deliberately
    moved the quantity, and `direction` is which way they were asked to move it. Gate 4 runs
    only when both are present — and its absence is recorded as a failed gate rather than
    quietly skipped, because a driver that was never made to track is not a driver that tracked.
    """
    all_frames = list(frames) + list(tracking or [])
    answer = run_on_anvil(kotlin, all_frames, url=url)

    if not answer.get("ok"):
        stage = answer.get("stage", "unknown")
        gate = {"lint": "compiles", "compile": "compiles"}.get(stage, "decodes")
        return Forged(ok=False, stage=stage, ms=int(answer.get("ms", 0)),
                      gates=[Gate(gate, False, str(answer.get("error", "")).strip())])

    values = [float(v) for v in answer.get("values", [])]
    nulls = int(answer.get("nulls", 0))
    unit = answer.get("unit")
    lo, hi = answer.get("min"), answer.get("max")

    gates = [Gate("compiles", True, "compiled against the real Driver interface")]

    if nulls:
        gates.append(Gate("decodes", False,
                          f"{nulls} of {len(all_frames)} frames decoded to null; a decode that "
                          "only works on some frames is not a decode"))
    else:
        gates.append(Gate("decodes", True, f"all {len(all_frames)} frames decoded"))

    gates.append(gate_plausible(values, lo, hi))
    gates.append(gate_unit(unit))

    if tracking:
        # The tracking frames were appended last, so their decoded values are the tail.
        gates.append(gate_tracks(values[-len(tracking):], direction or ""))
    else:
        gates.append(Gate("tracks", False,
                          "no frames were captured while the quantity was deliberately moved, "
                          "so nothing here shows the number follows the world"))

    return Forged(ok=all(g.passed for g in gates), gates=gates, values=values,
                  unit=unit, declared_min=lo, declared_max=hi, ms=int(answer.get("ms", 0)))
