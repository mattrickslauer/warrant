"""The gates, and the loop that feeds what they say back to Wright.

Every test here is about a way a driver can be WRONG while looking right. That is the whole
subject: a driver that fails to compile is caught by a compiler and needs no test of ours, but
a driver that compiles, runs, produces believable numbers and is measuring the wrong thing is
caught by nothing except gate 4 — and by this file, which is what says gate 4 works.
"""
from __future__ import annotations

import pytest

from warrant import anvil as anvil_mod
from warrant.anvil import (AnvilUnreachable, Gate, forge, gate_plausible, gate_tracks,
                           gate_unit)
from warrant.forge import Forging, forge_driver, frames_for


# --- gate 4, tracking ---------------------------------------------------------------------
def test_tracks_accepts_a_rising_quantity_that_rose():
    g = gate_tracks([22.4, 22.6, 23.1, 23.9], "rising")
    assert g.passed and "rising" in g.detail


def test_tracks_rejects_a_decoding_that_went_the_other_way():
    g = gate_tracks([22.4, 22.6, 23.1, 23.9], "falling")
    assert not g.passed and "wrong way" in g.detail


def test_tracks_rejects_a_decoding_that_did_not_move():
    """The observed failure the scenario corpus already carries: four identical plausible
    numbers across frames captured while the quantity was deliberately raised."""
    g = gate_tracks([44.28, 44.28, 44.28, 44.28], "rising")
    assert not g.passed


def test_tracks_rejects_a_lurch_even_when_the_trend_is_right():
    """A wrong width or endianness usually still trends correctly. It lurches, because the byte
    being read rolls over — and that is the only thing separating it from a real reading."""
    g = gate_tracks([22.4, -163.0, 23.1, 23.9], "rising")
    assert not g.passed and "larger than the whole movement" in g.detail


def test_tracks_refuses_to_judge_without_a_direction():
    """The direction is never parsed out of the probe instruction. A gate that decided a
    driver's fate by reading English would be the softest link in the chain."""
    g = gate_tracks([1.0, 2.0, 3.0], "")
    assert not g.passed and "direction" in g.detail


def test_tracks_needs_enough_samples_to_be_a_trend():
    assert not gate_tracks([1.0, 2.0], "rising").passed


# --- gate 5, the unit ---------------------------------------------------------------------
@pytest.mark.parametrize("unit", ["count", "raw", "value", "", "unknown", "N/A"])
def test_a_non_unit_is_refused(unit):
    assert not gate_unit(unit).passed


def test_a_real_unit_passes():
    assert gate_unit("degC").passed


# --- gate 3, plausibility -----------------------------------------------------------------
def test_values_outside_the_drivers_own_range_are_refused():
    g = gate_plausible([-163.76, -112.56, 15.45], -40.0, 125.0)
    assert not g.passed and "-163.76" in g.detail


def test_a_degenerate_range_cannot_pass_trivially():
    assert not gate_plausible([5.0], 5.0, 5.0).passed


def test_no_declared_range_is_a_failure_not_a_skip():
    assert not gate_plausible([5.0], None, None).passed


# --- forge(), over a stubbed anvil ---------------------------------------------------------
def anvil_says(monkeypatch, answer):
    monkeypatch.setattr(anvil_mod, "run_on_anvil", lambda *a, **k: answer)


OK = {"ok": True, "values": [22.4, 22.6, 23.1, 23.9], "nulls": 0,
      "unit": "degC", "min": -40.0, "max": 125.0, "ms": 12}


def test_a_lint_rejection_is_a_failed_compiles_gate_and_carries_the_stage(monkeypatch):
    anvil_says(monkeypatch, {"ok": False, "stage": "lint",
                             "error": "import java.net.Socket is not permitted"})
    v = forge("src", ["00"])
    assert not v.ok and v.stage == "lint"
    assert [g.name for g in v.failed] == ["compiles"]
    assert "java.net.Socket" in v.feedback()


def test_a_compiler_error_reaches_wright_verbatim(monkeypatch):
    anvil_says(monkeypatch, {"ok": False, "stage": "compile",
                             "error": "Candidate.kt:14:88: error: syntax error: Expecting ')'."})
    v = forge("src", ["00"])
    # Passed through untouched. A real compiler message is worth more than any paraphrase, and
    # rewording it would be inventing detail about code we did not write.
    assert "Candidate.kt:14:88" in v.feedback()


def test_a_null_decode_fails_the_decodes_gate(monkeypatch):
    anvil_says(monkeypatch, {**OK, "nulls": 2})
    v = forge("src", ["00", "01"], tracking=["02", "03", "04"], direction="rising")
    assert not v.ok
    assert any(g.name == "decodes" and not g.passed for g in v.gates)


def test_absent_tracking_fails_gate_four_rather_than_skipping_it(monkeypatch):
    """A driver that was never made to track is not a driver that tracked. Skipping the gate
    when the evidence is missing would let every untested driver through it."""
    anvil_says(monkeypatch, OK)
    v = forge("src", ["00", "01"])
    assert not v.ok
    tracks = [g for g in v.gates if g.name == "tracks"][0]
    assert not tracks.passed and "deliberately moved" in tracks.detail


def test_all_five_gates_pass_together(monkeypatch):
    anvil_says(monkeypatch, OK)
    v = forge("src", [], tracking=["a", "b", "c", "d"], direction="rising")
    assert v.ok, v.feedback()
    assert {g.name for g in v.gates} == {"compiles", "decodes", "plausible", "unit named", "tracks"}


def test_the_unit_is_read_off_the_compiled_class_not_the_models_answer(monkeypatch):
    """The driver's JSON may say degC while its source writes `count`. The anvil reports what
    the compiled class declares, and that is what gate 5 judges."""
    anvil_says(monkeypatch, {**OK, "unit": "count"})
    v = forge("src", [], tracking=["a", "b", "c"], direction="rising")
    assert not v.ok and any(g.name == "unit named" and not g.passed for g in v.gates)


# --- the loop -------------------------------------------------------------------------------
class FakeWright:
    """Wright, scripted. `run` returns the next prepared answer and records the case it saw,
    which is how the history assertions below check what the next turn was actually told."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.seen: list[dict] = []

    def run(self, case, *, live=False, temperature=0.0, model=None):
        self.seen.append(case)
        output, errors = self.answers.pop(0)
        return type("R", (), {"output": output, "schema_errors": errors})()


def emit(class_name="AcmeDriver", characteristic="0x2a6e", kotlin="src"):
    return ({"mode": "emit", "driver": {"class_name": class_name, "kotlin": kotlin,
                                        "characteristic": characteristic, "unit": "degC"}}, [])


CASE = {"frames": {"00002a6e-0000-1000-8000-00805f9b34fb": ["c008", "d408"]},
        "tracking": {"frames": ["c008", "d408", "0609"], "direction": "rising",
                     "instruction given": "warm the probe"}}


def test_a_driver_that_passes_every_gate_is_accepted(monkeypatch):
    anvil_says(monkeypatch, OK)
    out = forge_driver(CASE, agent=FakeWright([emit()]))
    assert out.accepted and out.driver["class_name"] == "AcmeDriver"


def test_a_rejection_names_the_gate_in_the_history_the_next_turn_reads(monkeypatch):
    """The point of the whole loop. Wright's prompt renders `history` as 'any driver that was
    rejected and the gate that rejected it', and this is what fills it."""
    answers = [{"ok": False, "stage": "compile", "error": "Candidate.kt:9:3: error: boom"}, OK]
    monkeypatch.setattr(anvil_mod, "run_on_anvil", lambda *a, **k: answers.pop(0))
    agent = FakeWright([emit("First"), emit("Second")])
    out = forge_driver(CASE, agent=agent)

    assert out.accepted and out.driver["class_name"] == "Second"
    second_turn_history = agent.seen[1]["history"]
    assert len(second_turn_history) == 1
    assert "First" in second_turn_history[0]
    assert "compiles" in second_turn_history[0]
    assert "Candidate.kt:9:3" in second_turn_history[0]


def test_history_already_on_the_case_is_kept_not_replaced(monkeypatch):
    anvil_says(monkeypatch, OK)
    agent = FakeWright([emit()])
    forge_driver({**CASE, "history": ["something an earlier session learned"]}, agent=agent)
    assert agent.seen[0]["history"][0] == "something an earlier session learned"


def test_abandon_stops_the_loop_immediately():
    agent = FakeWright([({"mode": "abandon", "abandon": {"why": "no_unit_derivable"}}, [])])
    out = forge_driver(CASE, agent=agent)
    assert out.outcome == "abandoned" and out.abandon["why"] == "no_unit_derivable"


def test_a_probe_stops_the_loop_because_there_is_hardware_in_that_path():
    """Fabricating frames to keep the loop turning would manufacture the very evidence the
    gates exist to weigh."""
    agent = FakeWright([({"mode": "probe",
                          "probe": {"op": "sample_while_changing",
                                    "instruction": "breathe on the sensor"}}, [])])
    out = forge_driver(CASE, agent=agent)
    assert out.outcome == "needs_probe"
    assert out.probe["op"] == "sample_while_changing"


def test_a_driver_for_a_characteristic_nobody_captured_is_a_finding(monkeypatch):
    """What emitting from the GATT tree alone looks like: a decoding that cannot be checked
    against frames that do not exist."""
    anvil_says(monkeypatch, OK)
    agent = FakeWright([emit(characteristic="0x2a19"), emit()])
    out = forge_driver(CASE, agent=agent)
    assert out.accepted
    assert out.attempts[0]["outcome"] == "no frames"
    assert "0x2a19" in agent.seen[1]["history"][0]


def test_the_loop_gives_up_rather_than_arguing_forever(monkeypatch):
    anvil_says(monkeypatch, {"ok": False, "stage": "compile", "error": "still wrong"})
    agent = FakeWright([emit() for _ in range(4)])
    out = forge_driver(CASE, agent=agent, max_attempts=4)
    assert out.outcome == "exhausted" and len(out.attempts) == 4


def test_an_off_contract_answer_is_never_compiled():
    agent = FakeWright([({"mode": "emit", "driver": {"kotlin": "x"}},
                         ["driver.unit: does not name a physical unit"])])
    out = forge_driver(CASE, agent=agent)
    assert out.outcome == "off_contract"


def test_an_unreachable_anvil_never_records_a_rejection(monkeypatch):
    """No statement about the driver was made. Marking a failure against code nobody ran is
    the one thing worse than not running it."""
    def down(*a, **k):
        raise AnvilUnreachable("connection refused")
    monkeypatch.setattr(anvil_mod, "run_on_anvil", down)
    with pytest.raises(AnvilUnreachable):
        forge_driver(CASE, agent=FakeWright([emit()]))
