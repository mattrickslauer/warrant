"""Wright — meets an instrument nobody has written a driver for, and works out how it speaks.

Every other agent in this fleet judges evidence. Wright produces an artefact: a Kotlin class
that turns bytes off a radio into a number with a unit on it. That makes its failure mode
different in kind from the others. An Inspector that is wrong returns a bad verdict, and the
verdict is on the record where someone can argue with it. A Wright that is wrong installs a
function that will silently mint wrong measurements for every job on that tenant, for as long
as nobody notices — and each of them is filed as `measured`, which is the strongest provenance
class the product has.

So the whole agent is built around two refusals, and they are the reason it exists at all:

  * **A number without a unit is not a measurement.** Emitting a driver for a characteristic
    whose unit cannot be named produces a plausible integer with nothing behind it. Abandoning
    is the correct outcome, and the contract says so in as many words.
  * **The first readable characteristic is usually the wrong one.** Battery level is `0x2A19`,
    it is present on a great many devices, it reads first, and `87` looks exactly like a good
    reading. A generic GATT driver picks it. If Wright picks it too, Wright has no reason to
    exist.

The evidence order in the instruction is also deliberate. A `0x2904` presentation-format
descriptor states format, exponent and unit outright; a SIG-assigned characteristic has a
published encoding. Inference from bytes is the last resort, not the first idea, because bytes
that look like a rising temperature also look like a rising anything else.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .base import Agent
from .model import Part

#: The seam Wright writes into. Read off disk at prompt-build time rather than transcribed,
#: for the same reason the other six agents read their instruction out of the contract: an
#: interface pasted into a prompt drifts away from the interface that actually has to compile,
#: and the first sign of it is a driver that is rejected for a reason nobody can see.
DRIVER_INTERFACE = (Path(__file__).resolve().parents[2]
                    / "android/app/src/main/java/ink/warrant/instrument/Driver.kt")

#: Every member `Driver` declares. A class missing any of them does not implement the
#: interface and will not compile, however correct its arithmetic is.
REQUIRED_MEMBERS = ("id", "label", "produces", "matches", "characteristicFor", "decode")

#: Characteristics that read cleanly, decode to believable integers, and measure nothing about
#: the world. `0x2A19` is battery level; the rest is Device Information (`0x180A`) — firmware
#: and hardware revisions, serial and model numbers, manufacturer name. A driver pointed at any
#: of these produces a number that will pass a plausibility check forever and mean nothing.
DECOYS = {
    "00002a19": "battery level",
    "00002a23": "system id",
    "00002a24": "model number",
    "00002a25": "serial number",
    "00002a26": "firmware revision",
    "00002a27": "hardware revision",
    "00002a28": "software revision",
    "00002a29": "manufacturer name",
}

#: A unit that is not a unit. `count` and `raw` are the tempting ones: they are what a model
#: writes when it has decoded something successfully and cannot say what it decoded.
NON_UNITS = {"", "unknown", "n/a", "na", "none", "raw", "count", "counts", "units", "value"}


def _short(uuid: str) -> str:
    """The 16-bit assigned-number prefix of a 128-bit UUID, lowercased.

    SIG characteristics are written both ways in the wild — `0x2A19` and the full
    `00002a19-0000-1000-8000-00805f9b34fb` — and a decoy check that only matched one form
    would be trivially evaded by a model that happened to write the other.
    """
    u = (uuid or "").strip().lower().replace("0x", "")
    if len(u) == 4:
        return "0000" + u
    return u.split("-")[0] if "-" in u else u[:8]


class Wright(Agent):
    name = "wright"
    schema_name = "wright-turn"

    def parts(self, case: dict[str, Any]) -> list[Part]:
        body = [
            self.block("What the device advertises", case.get("advertisement", {})),
            self.block("The GATT tree as enumerated", case.get("gatt", [])),
        ]

        frames = case.get("frames") or {}
        if frames:
            body.append(self.block(
                "Frames captured, by characteristic",
                "Hex, in arrival order. A value that never changes across a capture is not "
                "necessarily static — it may simply be a quantity that did not move.\n\n"
                + json.dumps(frames, indent=2)))

        if case.get("tracking"):
            # The honest gate. A driver can decode a rising byte into a rising number and still
            # be measuring the wrong thing; frames captured while a person deliberately moves
            # the quantity are the only evidence that the number follows the world.
            body.append(self.block(
                "Frames captured while the quantity was deliberately moved",
                "Someone was asked to make the reading move, and told which way. If your "
                "decoding does not move with it, your decoding is wrong.\n\n"
                + json.dumps(case["tracking"], indent=2)))

        if case.get("history"):
            body.append(self.block(
                "What you have already tried on this device",
                "Including any driver that was rejected and the gate that rejected it. A gate "
                "that failed will not pass because the next attempt is more confident: change "
                "the decoding, or abandon.\n\n" + json.dumps(case["history"], indent=2)))

        if DRIVER_INTERFACE.exists():
            body.append(self.block(
                "The interface your driver must implement",
                "This is the actual file, read off disk. Your class has to satisfy every member "
                "of it — a class carrying only a decode function does not implement this "
                "interface and will not compile, however correct its arithmetic is. Note where "
                "the UUIDs live: `matches` and `characteristicFor` carry them, so the class "
                "names the device it is for.\n\n```kotlin\n"
                + DRIVER_INTERFACE.read_text() + "\n```"))

        budget = case.get("probe_budget", 6)
        used = case.get("probes_used", 0)
        body.append(self.block("Your budget", {
            "probes used": used,
            "probes left": max(0, budget - used),
            "note": "A driver emitted from a single frame is a guess wearing a uniform. But "
                    "probing forever is also a failure: if the budget runs out, abandon and say "
                    "what a person with the vendor's documentation would need to finish."}))
        return [self.text("\n\n".join(body))]

    def check_conditionals(self, out: dict[str, Any]) -> list[str]:
        """The rules the schema cannot state, exactly as the design spec tabulates them.

        These are not stylistic. Every one of them is a way a fluent, well-formed, entirely
        plausible answer can still install something that mints wrong measurements.
        """
        errs: list[str] = []
        mode = out.get("mode")

        if mode == "probe":
            if not out.get("probe"):
                errs.append("probe: required when mode is probe")
            for absent in ("driver", "abandon"):
                if out.get(absent):
                    errs.append(f"{absent}: must be null while still probing")
            probe = out.get("probe") or {}
            if probe.get("op") == "sample_while_changing" and not probe.get("instruction"):
                errs.append("probe.instruction: required for sample_while_changing; there is a "
                            "person holding the device and they need to be told what to do")

        if mode == "abandon" and not out.get("abandon"):
            errs.append("abandon: required when mode is abandon")

        if mode == "emit":
            driver = out.get("driver")
            if not driver:
                errs.append("driver: required when mode is emit")
            if out.get("unresolved"):
                errs.append("unresolved: must be empty to emit; it is not")
            if not out.get("evidence"):
                errs.append("evidence: emitting with nothing cited is guessing")
            if driver:
                errs.extend(self._check_driver(driver))
        return errs

    @staticmethod
    def _check_driver(driver: dict[str, Any]) -> list[str]:
        errs: list[str] = []

        unit = str(driver.get("unit", "")).strip().lower()
        if unit in NON_UNITS:
            # The single rule that separates Wright from a generic GATT reader. A number whose
            # unit nobody can name is not a measurement, and filing it as one is the exact lie
            # the provenance model exists to make impossible.
            errs.append(f"driver.unit: {driver.get('unit')!r} does not name a physical unit; "
                        "abandon with no_unit_derivable instead of emitting")

        lo, hi = driver.get("min"), driver.get("max")
        if isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and lo >= hi:
            errs.append(f"driver.min/max: {lo} to {hi} is not a range, and a degenerate range "
                        "passes a plausibility check trivially")

        char = driver.get("characteristic", "")
        decoy = DECOYS.get(_short(char))
        if decoy:
            errs.append(f"driver.characteristic: {char} is {decoy}, which decodes to a "
                        "believable number and measures nothing about the world")

        kotlin = driver.get("kotlin") or ""
        missing = [m for m in REQUIRED_MEMBERS if m not in kotlin]
        if missing:
            # Not a style note. `Driver` declares six members and the anvil compiles against
            # the real interface, so a class short of any of them is not a driver — it is a
            # fragment that happens to contain correct arithmetic.
            errs.append("driver.kotlin: does not implement Driver — missing "
                        + ", ".join(missing))
        # Three spellings, all correct. `Driver.kt` ships a `sig(short: Int)` helper precisely
        # so SIG characteristics are written as `sig(0x2a6f)`, and a check that demanded the
        # 128-bit form would reject the idiomatic code the interface itself invites.
        if char:
            k = kotlin.lower()
            assigned = _short(char)[4:] if _short(char).startswith("0000") else ""
            spellings = [char.lower(), _short(char)] + ([assigned] if assigned else [])
            if not any(sp and sp in k for sp in spellings):
                errs.append("driver.kotlin: the source never names the characteristic it "
                            "declares, so nothing in the class says which device it is for")
        return errs
