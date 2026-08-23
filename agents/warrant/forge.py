"""The loop. Wright writes a driver, the anvil runs it, the gates judge it, and what they say
goes back into the next turn.

This is the only closed loop in the fleet, and it is closed for a specific reason. Every other
agent returns a verdict that a person reads: an Inspector that is wrong puts a bad verdict on
the record, where it can be argued with. Wright returns a FUNCTION, and a function that is
wrong mints wrong numbers unattended — each one filed as `measured`, the strongest provenance
class the product has. There is nobody in that path to argue with it. So Wright's output is
executed before it is believed, and the thing that decides whether to believe it is not the
model's confidence in its own answer but five gates over the values the code actually produced.

`wright.py` was already built for this. Its prompt renders `history` as *"what you have already
tried on this device, including any driver that was rejected and the gate that rejected it"*,
and `tracking` as frames captured while somebody deliberately moved the quantity. Both blocks
existed and nothing ever filled them. This module fills them.

WHAT THIS LOOP DOES NOT DO. It cannot execute a probe. When Wright asks to subscribe to a
characteristic or to sample while a person warms the sensor, there is hardware and a human in
that path, and the loop stops and says so. Pretending otherwise — fabricating frames to keep
the loop turning — would be manufacturing the evidence the gates exist to weigh.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .anvil import AnvilUnreachable, Forged, forge
from .wright import Wright, _short

#: How many drivers Wright may have rejected before the loop gives up on it. Four, because a
#: model that has not found the encoding in four attempts against the same evidence is not
#: going to find it in a fifth — it is going to start writing more confident prose about the
#: same decoding, which is the observed failure and the reason `history` names the gate.
MAX_ATTEMPTS = 4


@dataclass
class Forging:
    """The whole loop, kept so a person can read what was tried and why each attempt died."""
    #: accepted · abandoned · needs_probe · exhausted · off_contract
    outcome: str
    driver: dict[str, Any] | None = None
    verdict: Forged | None = None
    probe: dict[str, Any] | None = None
    abandon: dict[str, Any] | None = None
    attempts: list[dict[str, Any]] = field(default_factory=list)
    history: list[str] = field(default_factory=list)

    @property
    def accepted(self) -> bool:
        return self.outcome == "accepted"


def frames_for(case: dict[str, Any], characteristic: str) -> list[str] | None:
    """The captured frames for the characteristic a driver actually declares.

    Matched on the 16-bit assigned prefix as well as the full UUID, because SIG characteristics
    are written both ways in the wild and a lookup that only accepted one form would report
    "nobody captured this" about frames sitting right there.

    Returns None when the driver names a characteristic nothing was captured from — which is
    itself a finding, and a common one: it is what emitting from the GATT tree alone looks like.
    """
    frames = case.get("frames") or {}
    if characteristic in frames:
        return list(frames[characteristic])
    want = _short(characteristic)
    for uuid, captured in frames.items():
        if _short(uuid) == want:
            return list(captured)
    return None


def forge_driver(case: dict[str, Any], *, live: bool = False, model: str | None = None,
                 url: str | None = None, max_attempts: int = MAX_ATTEMPTS,
                 agent: Wright | None = None) -> Forging:
    """Run Wright against one device until a driver passes every gate, or until it should not.

    `case` is an ordinary Wright case. The only key this loop writes is `history`, and it
    appends to whatever is already there rather than replacing it, so a device that was worked
    on across two sessions keeps what the first one learned.
    """
    wright = agent or Wright()
    history: list[str] = [str(h) for h in (case.get("history") or [])]
    attempts: list[dict[str, Any]] = []

    tracking = case.get("tracking") or {}
    tracking_frames = list(tracking.get("frames") or [])
    #: Which way a person was asked to move the quantity. It is NOT parsed out of the
    #: instruction: "breathe on the sensor so the humidity climbs" is prose, and a gate that
    #: decided a driver's fate by reading English would be the softest link in the chain.
    #: Absent, gate 4 fails and says it has nothing to check against — which is correct, and
    #: puts the fix where it belongs, on whoever ran the probe.
    direction = tracking.get("direction")

    for attempt in range(1, max_attempts + 1):
        result = wright.run({**case, "history": history}, live=live, model=model)

        if result.schema_errors:
            # Off-contract is terminal here, exactly as it is in the eval report. A driver
            # object we could not trust the shape of is not a driver to compile.
            return Forging(outcome="off_contract", attempts=attempts, history=history,
                           driver=result.output.get("driver"))

        out = result.output
        mode = out.get("mode")

        if mode == "abandon":
            return Forging(outcome="abandoned", abandon=out.get("abandon"),
                           attempts=attempts, history=history)

        if mode == "probe":
            # Hardware and a person. The loop goes no further on its own, and says why.
            return Forging(outcome="needs_probe", probe=out.get("probe"),
                           attempts=attempts, history=history)

        driver = out.get("driver") or {}
        characteristic = driver.get("characteristic") or ""
        captured = frames_for(case, characteristic)

        if captured is None:
            why = (f"emitted a driver for {characteristic}, which nothing was captured from. "
                   "A decoding cannot be checked against frames that do not exist — probe that "
                   "characteristic, or write a driver for one that was captured.")
            attempts.append({"attempt": attempt, "class_name": driver.get("class_name"),
                             "characteristic": characteristic, "outcome": "no frames",
                             "why": why})
            history.append(f"attempt {attempt}: {driver.get('class_name')} — {why}")
            continue

        try:
            verdict = forge(driver.get("kotlin") or "", captured,
                            tracking=tracking_frames or None, direction=direction, url=url)
        except AnvilUnreachable:
            # No statement about this driver was made. Recording a rejection here would mark a
            # failure against code that was never run, so the loop stops rather than guesses.
            raise

        attempts.append({"attempt": attempt, "class_name": driver.get("class_name"),
                         "characteristic": characteristic,
                         "outcome": "accepted" if verdict.ok else "rejected",
                         "gates": [{"name": g.name, "passed": g.passed, "detail": g.detail}
                                   for g in verdict.gates],
                         "values": verdict.values, "ms": verdict.ms})

        if verdict.ok:
            return Forging(outcome="accepted", driver=driver, verdict=verdict,
                           attempts=attempts, history=history)

        # The sentence Wright reads on its next turn. It names the gate, because a gate that
        # failed will not pass because the next attempt is more confident.
        history.append(
            f"attempt {attempt}: emitted {driver.get('class_name')} reading "
            f"{characteristic}. REJECTED by {', '.join(g.name for g in verdict.failed)} — "
            f"{verdict.feedback()}")

    return Forging(outcome="exhausted", attempts=attempts, history=history)
