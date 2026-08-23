"""The gates against the REAL compiler, on the frames the scenario corpus actually carries.

Everything in `test_forge.py` stubs the anvil, which is right for testing the gates' arithmetic
and wrong for testing the claim the whole design rests on: that a driver is compiled and
executed before it is believed. These tests compile Kotlin. They are skipped, loudly, when the
anvil is not running — never quietly passed, because a green suite that silently stopped
compiling anything is the exact failure this file exists to prevent.

    ./anvil/run.sh &
    python3 -m pytest tests/test_anvil_live.py -q
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest

from warrant.anvil import ANVIL_URL, forge
from warrant.forge import forge_driver


def anvil_is_up() -> bool:
    try:
        with urllib.request.urlopen(ANVIL_URL.rstrip("/") + "/health", timeout=2) as r:
            return json.loads(r.read()).get("ok") is True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not anvil_is_up(), reason=f"no anvil at {ANVIL_URL} — start it with ./anvil/run.sh")


CHAR = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

#: Verbatim from evals/scenarios/wright/frames-do-not-track-rejects-own-driver.json. Bytes 1
#: and 2 never change; byte 3 is the one that moves.
CASE = {
    "advertisement": {"name": "ACME-H2"},
    "frames": {CHAR: ["01 4c 11 2c", "01 4c 11 30", "01 4c 11 35", "01 4c 11 33"]},
    "tracking": {"instruction given": "breathe on the sensor so the humidity climbs",
                 "direction": "rising",
                 "frames": ["01 4c 11 2c", "01 4c 11 3a", "01 4c 11 48", "01 4c 11 56"]},
}

SHELL = """package ink.warrant.instrument

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

object AcmeH2Driver : Driver {{
    override val id = "wright.acme-h2"
    override val label = "ACME-H2 humidity"
    override val produces = Produces(unit = {unit}, min = 0.0, max = 100.0)
    override val matches = Match(namePrefixes = listOf("ACME-H2"))
    override fun characteristicFor(services: List<UUID>): CharacteristicRef? = null
    override fun decode(raw: ByteArray): Double? {{
{body}
    }}
}}
"""

#: The decoding the scenario records Wright actually producing: a uint16 little-endian at
#: offset 1. It compiles, it runs, and it returns 44.28 for every frame ever captured.
WRONG = SHELL.format(unit='"%RH"', body="""        if (raw.size < 3) return null
        return ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).getShort(1).toInt() / 100.0""")

RIGHT = SHELL.format(unit='"%RH"', body="""        if (raw.size < 4) return null
        return (raw[3].toInt() and 0xFF).toDouble()""")

NO_UNIT = SHELL.format(unit='"count"', body="""        if (raw.size < 4) return null
        return (raw[3].toInt() and 0xFF).toDouble()""")


def test_the_right_decoding_passes_all_five_gates():
    v = forge(RIGHT, CASE["frames"][CHAR],
              tracking=CASE["tracking"]["frames"], direction="rising")
    assert v.ok, v.feedback()
    assert v.values[-4:] == [44.0, 58.0, 72.0, 86.0]
    assert v.unit == "%RH"


def test_a_plausible_driver_that_measures_nothing_is_caught_only_by_gate_four():
    """The case the whole design exists for. Four gates pass — it compiles, every frame
    decodes, 44.28 is a perfectly believable humidity, and %RH is a real unit — and the
    reading did not move while somebody was breathing on the sensor."""
    v = forge(WRONG, CASE["frames"][CHAR],
              tracking=CASE["tracking"]["frames"], direction="rising")
    assert not v.ok
    assert [g.name for g in v.failed] == ["tracks"]
    assert set(v.values) == {44.28}


def test_the_unit_is_read_out_of_the_compiled_class():
    v = forge(NO_UNIT, CASE["frames"][CHAR],
              tracking=CASE["tracking"]["frames"], direction="rising")
    assert not v.ok
    assert any(g.name == "unit named" and not g.passed for g in v.failed)


def test_a_forbidden_import_never_reaches_the_compiler():
    v = forge(RIGHT.replace("import java.util.UUID",
                            "import java.util.UUID\nimport java.net.Socket"),
              CASE["frames"][CHAR], tracking=CASE["tracking"]["frames"], direction="rising")
    assert not v.ok and v.stage == "lint"


def test_a_decode_that_never_returns_costs_one_frame_not_the_service():
    v = forge(SHELL.format(unit='"%RH"', body="        while (true) { }"),
              CASE["frames"][CHAR])
    assert not v.ok and v.stage == "execute" and "did not return" in v.feedback()


class ScriptedWright:
    """Wright, scripted, so the run is deterministic. What is under test is the LOOP."""

    def __init__(self, sources):
        self.sources = list(sources)
        self.seen: list[dict] = []

    def run(self, case, *, live=False, temperature=0.0, model=None):
        self.seen.append(case)
        return type("R", (), {"schema_errors": [], "output": {
            "mode": "emit",
            "driver": {"class_name": "AcmeH2Driver", "characteristic": CHAR,
                       "unit": "%RH", "kotlin": self.sources.pop(0)}}})()


def test_the_loop_rejects_compiles_again_and_accepts():
    """End to end: a driver is written, compiled, executed, rejected by the gate that reads the
    physical world, the rejection is put in front of the next turn naming the gate, and the
    second driver passes."""
    agent = ScriptedWright([WRONG, RIGHT])
    out = forge_driver(CASE, agent=agent)

    assert out.accepted
    assert out.attempts[0]["outcome"] == "rejected"
    assert out.attempts[1]["outcome"] == "accepted"

    told = agent.seen[1]["history"]
    assert len(told) == 1
    assert "tracks" in told[0] and "44.28" in told[0]
