"""The Gemma screen, and the one property that makes putting a cheap model on the path safe.

None of these call a model. The whole point of the screen is that its authority is bounded by
ordinary code — `acts_on` — and by a schema with no PASS in it, so what is worth testing is
exactly the code and the schema rather than any answer a model happens to give.

The first test is the load-bearing one. If `EvidenceScreen` ever grows a verdict meaning
"satisfied", every other guarantee in this file stops mattering, because the cheap model would
then be able to advance a step on its own.
"""
import pytest

from warrant import REGISTRY
from warrant.contract import agent_schema, response_schema, system_instruction
from warrant.screen import ACTIONABLE, SCREEN_FLOOR, Screener, acts_on

CASE = {"field": {"prompt": "photograph the caliper with the pads visible", "kind": "photo"},
        "step": {"title": "remove wheel"},
        "media": ["brake/pads-seated-sharp.jpg"]}


def _unusable(**over):
    out = {"screen": "UNUSABLE", "confidence": 0.95, "defect": "too_blurred",
           "retake_prompt": "the caliper is out of focus; photograph it again", "rationale": "x"}
    out.update(over)
    return out


# --- the invariant --------------------------------------------------------------------
def test_the_screen_has_no_answer_that_means_satisfied():
    """The cheap model must not be ABLE to pass a step, not merely instructed not to.

    A prompt saying "you cannot pass anything" is advice. An enum without a passing member is
    a property of the request, and it holds however the model behaves.
    """
    enum = agent_schema("evidence-screen")["properties"]["screen"]["enum"]
    assert enum == ["UNUSABLE", "NEEDS_JUDGEMENT"]
    for banned in ("PASS", "OK", "SATISFIED", "ACCEPT", "APPROVED", "CLEAR"):
        assert banned not in enum


def test_the_screen_is_not_one_of_the_seven():
    """`roster()` reads REGISTRY, and the count is said out loud in the film."""
    assert "screen" not in REGISTRY
    assert len(REGISTRY) == 7


def test_the_screen_is_never_shown_the_rule_the_judge_applies():
    """It cannot usurp a judgement it was never told the terms of — the same reason
    `inspector.py` withholds `acceptance_target`, applied to a smaller model."""
    rich = dict(CASE, field=dict(CASE["field"], acceptance_rule="matches",
                                 acceptance_target="X004X2NVXZ",
                                 acceptance_min=26, acceptance_max=30,
                                 acceptance_unit="Nm"),
                strictness=3, reading={"value": 28.4, "unit": "Nm", "source": "instrument"})
    prompt = "\n".join(p.text or "" for p in Screener().parts(rich))
    for leaked in ("X004X2NVXZ", "matches", "28.4", "strictness", "regulated"):
        assert leaked not in prompt, f"the screen was shown {leaked!r}"


# --- acts_on, which is where the authority actually stops ------------------------------
def test_a_confident_actionable_unusable_is_acted_on():
    assert acts_on(_unusable()) is True


def test_needs_judgement_is_never_acted_on_however_confident():
    assert acts_on({"screen": "NEEDS_JUDGEMENT", "confidence": 1.0, "rationale": "x"}) is False


@pytest.mark.parametrize("confidence", [0.0, 0.5, 0.84, SCREEN_FLOOR - 0.001])
def test_below_the_floor_the_capture_goes_to_the_judge(confidence):
    assert acts_on(_unusable(confidence=confidence)) is False


def test_at_the_floor_exactly_it_is_acted_on():
    assert acts_on(_unusable(confidence=SCREEN_FLOOR)) is True


@pytest.mark.parametrize("defect", ["work_looks_wrong", "part_number_mismatch", "", None,
                                    "pads_worn_out", "unknown"])
def test_a_defect_outside_the_actionable_set_is_not_obeyed(defect):
    """The screen inventing a defect about the WORK rather than the frame is the failure
    mode this guards: those are the judge's to find, and short-circuiting one would be the
    cheap model refusing a job it was never qualified to refuse."""
    assert defect not in ACTIONABLE
    assert acts_on(_unusable(defect=defect)) is False


@pytest.mark.parametrize("retake", ["", "   ", None])
def test_an_unusable_with_nothing_to_send_back_is_not_acted_on(retake):
    """Refusing a capture without saying what to do instead is the ADD FIELD pathology the
    architecture already forbids; it does not get in through the screen either."""
    assert acts_on(_unusable(retake_prompt=retake)) is False


@pytest.mark.parametrize("confidence", [None, "0.99", True, [1], {}])
def test_a_non_numeric_confidence_is_not_acted_on(confidence):
    """`True` is in here deliberately: it is an instance of int in Python, and a bool that
    read as 1.0 would clear any floor."""
    assert acts_on(_unusable(confidence=confidence)) is False


def test_the_floor_is_overridable_for_a_test_but_defaults_high():
    assert SCREEN_FLOOR == 0.85
    assert acts_on(_unusable(confidence=0.6), floor=0.5) is True


# --- schema conformance ---------------------------------------------------------------
def test_unusable_must_name_a_defect_and_a_retake():
    errs = Screener().validate({"screen": "UNUSABLE", "confidence": 0.9, "rationale": "x"})
    assert any("defect" in e for e in errs)
    assert any("retake_prompt" in e for e in errs)


def test_needs_judgement_must_not_carry_a_defect():
    """A screen that names a defect and declines to act on it contradicts itself, and
    `acts_on` reads `screen` alone — so the stray field would vanish silently."""
    errs = Screener().validate({"screen": "NEEDS_JUDGEMENT", "confidence": 0.9,
                                "rationale": "x", "defect": "too_dark",
                                "retake_prompt": "again"})
    assert any("defect" in e for e in errs)
    assert any("retake_prompt" in e for e in errs)


def test_a_well_formed_answer_of_each_kind_validates():
    assert Screener().validate(_unusable()) == []
    # `defect: "none"` rather than an absent field. It is REQUIRED by the contract, because a
    # nullable enum is a field a model fills in — see `Screener.check_conditionals`.
    assert Screener().validate({"screen": "NEEDS_JUDGEMENT", "confidence": 0.4,
                                "defect": "none",
                                "rationale": "the caliper is in frame and legible"}) == []


def test_needs_judgement_says_none_rather_than_omitting_the_defect():
    """The regression that made the screen inert. Observed live: offered a nullable enum,
    Flash-Lite named a defect on all four NEEDS_JUDGEMENT answers — including
    `subject_absent` on a photograph its own rationale called "clearly visible". Every answer
    then failed validation, and `acts_on` requires `valid`, so the screen cost a model call
    per capture and never once fired."""
    assert "none" in agent_schema("evidence-screen")["properties"]["defect"]["enum"]
    assert "defect" in agent_schema("evidence-screen")["required"]
    # And `none` is not actionable, so saying it can never short-circuit a capture.
    assert "none" not in ACTIONABLE
    assert acts_on(_unusable(defect="none")) is False


def test_an_absent_capture_is_not_screened():
    """Nothing to look at means no frame to find a defect in. Saying `nothing_in_frame` would
    be the screen reporting an observation about an image that does not exist."""
    prompt = "\n".join(p.text or "" for p in Screener().parts(dict(CASE, media=[])))
    assert "return NEEDS_JUDGEMENT" in prompt


def test_the_contract_is_reachable_and_vertex_shaped():
    """It is loaded the same way the seven are, from the same directory, and sent verbatim."""
    assert response_schema("evidence-screen")["properties"]["screen"]["enum"]
    assert "SCREEN" in system_instruction("evidence-screen").upper()
