"""The interview harness, and the one piece of arithmetic the Scoper is judged on.

`traceable` is the assertion the whole scenario exists to make, so it is the assertion most
worth distrusting. A traceability check that silently always passes would report a green
suite while the Scoper fabricated tolerances, which is worse than having no check at all —
it would be evidence, and it would be wrong.

So these feed `_bounds` and `disclosed_numbers` drafts that were and were not invented, and
assert the difference is caught. No model is called: this is arithmetic over a JSON document,
and it should be testable without one.
"""
import pytest

from evals.interview import _bounds
from evals.shop import disclosed_numbers, numbers_in


def draft(*fields):
    return {"key": "front-brake", "title": "Front brake service", "strictness": 2,
            "minimum_tier": "instrumented",
            "steps": [{"title": "Torque the caliper", "explanation": "why", "max_add_fields": 2,
                       "fields": list(fields)}]}


def field(key, **kw):
    base = {"key": key, "kind": "measurement", "prompt": "p", "source": "instrument",
            "required_at_strictness": 1, "acceptance_rule": "within", "guidance": "g"}
    return {**base, **kw}


class TestWhatCountsAsABound:
    def test_it_finds_both_edges(self):
        found = _bounds(draft(field("torque", acceptance_min=27, acceptance_max=33)))
        assert sorted(b["value"] for b in found) == [27.0, 33.0]

    def test_a_bound_carries_where_it_came_from(self):
        found = _bounds(draft(field("pad_thickness", acceptance_min=2, acceptance_unit="mm")))
        assert found[0]["field"] == "pad_thickness" and found[0]["unit"] == "mm"

    @pytest.mark.parametrize("extra", [
        {"strictness": 3},          # the Scoper is supposed to choose this
        {"max_add_fields": 2},      # and this
    ])
    def test_integers_the_scoper_chooses_are_not_bounds(self, extra):
        """A tolerance is a figure it must be told. Strictness is a judgement it must make.
        Conflating them would make the check fire on entirely correct behaviour, and a check
        that cries wolf is deleted within a week."""
        d = draft(field("photo", acceptance_rule="must_show", acceptance_description="pads"))
        d.update(extra)
        assert _bounds(d) == []

    def test_a_procedure_with_no_measurements_has_no_bounds(self):
        assert _bounds(draft(field("photo", kind="photo", source="camera",
                                   acceptance_rule="must_show"))) == []


class TestWhatTheShopDisclosed:
    def test_only_the_shop_counts(self):
        """The Scoper's own questions are full of numbers it has repeated back. Counting those
        would let it launder a figure it invented on turn three into a legitimate bound."""
        convo = [{"who": "scoper", "said": "Is it 40 Nm?"},
                 {"who": "shop", "said": "No, 30 Nm on those bolts."}]
        assert disclosed_numbers(convo) == {30.0}

    def test_a_range_yields_both_ends(self):
        assert numbers_in("between 27 and 33 Nm") == {27.0, 33.0}

    def test_decimals_survive(self):
        assert 2.5 in numbers_in("we bin them at 2.5 mm")

    def test_a_catalogue_the_scoper_may_read_counts(self):
        """A published manufacturer figure is the one bound that need not come from the shop."""
        convo = [{"who": "shop", "said": "It's in the Honda book."}]
        assert 30.0 in disclosed_numbers(convo, "caliper bolt: 30 Nm")


class TestTheCheckThatMatters:
    """The whole point, stated twice: once where it must pass, once where it must fail."""

    CONVO = [{"who": "shop", "said": "We bin the pads at 2 mm, and it's 30 Nm on the bolts."}]

    def test_a_figure_the_shop_stated_is_traceable(self):
        disclosed = disclosed_numbers(self.CONVO)
        bounds = _bounds(draft(field("torque", acceptance_min=30),
                               field("pad", acceptance_min=2)))
        assert [b for b in bounds if b["value"] not in disclosed] == []

    def test_a_figure_nobody_stated_is_caught(self):
        """4.5 mm is plausible, it is the right unit, and it is on the right field. It is also
        a number that exists nowhere in the conversation, which is the only property that
        distinguishes an invented tolerance from a real one."""
        disclosed = disclosed_numbers(self.CONVO)
        bounds = _bounds(draft(field("disc_thickness", acceptance_min=4.5)))
        invented = [b for b in bounds if b["value"] not in disclosed]
        assert len(invented) == 1 and invented[0]["field"] == "disc_thickness"

    def test_one_invented_figure_among_correct_ones_still_fails(self):
        disclosed = disclosed_numbers(self.CONVO)
        bounds = _bounds(draft(field("torque", acceptance_min=30),
                               field("disc", acceptance_min=4.5)))
        assert [b["value"] for b in bounds if b["value"] not in disclosed] == [4.5]


class TestTheScenariosThemselves:
    def test_every_interview_withholds_something(self, scenarios):
        """A scenario where the shop can answer everything cannot observe the refusal, and
        would pass whether or not the Scoper was capable of making it."""
        interviews = [c for c in scenarios("scoper", None) if c.get("kind") == "interview"]
        assert interviews, "no interview scenarios found"
        for case in interviews:
            facts = case["input"]["facts"]
            assert facts, f"{case['id']}: an interview needs a fact sheet"

    def test_an_interview_must_declare_a_turn_cap(self, scenarios):
        for case in scenarios("scoper", None):
            if case.get("kind") == "interview":
                assert case["input"].get("max_turns"), f"{case['id']}: no max_turns"


class TestTheScoperIsToldWhatItHasNotAsked:
    """The agent's own contract asks it to know what it has not yet covered. Nothing showed
    it, and observed behaviour was exactly what that predicts: ten turns following the thread
    in front of it while the figure the record turns on was never asked."""

    def build(self, **case):
        from warrant import REGISTRY
        return REGISTRY["scoper"]().parts({"shop": {"trade": "x"}, "conversation": [], **case})[0].text

    def test_untouched_classes_are_named(self):
        text = self.build(asked_about=["scope", "sequence"])
        assert "Never asked about: tolerance" in text

    def test_covered_classes_are_not_listed_as_untouched(self):
        text = self.build(asked_about=["tolerance"])
        untouched = text.split("Never asked about: ")[1].split("\n")[0]
        assert "tolerance" not in untouched

    def test_the_remaining_turn_budget_is_stated(self):
        assert "Turns left before this interview ends: 4." in self.build(
            asked_about=["scope"], turns_left=4)

    def test_a_single_turn_scenario_gets_no_coverage_block(self):
        """Single-turn scenarios have no interview to report coverage over, and inventing one
        would put a claim in the prompt that the run cannot support."""
        assert "What you have not yet asked" not in self.build()

    def test_the_endgame_is_announced_only_near_the_end(self):
        """A shop that has said it does not know a figure will not know it on the last turn.
        Without this the Scoper holds unclosable unknowns, never empties `unresolved`, and
        hands the shop nothing at all — worse than a procedure with its gap written down."""
        assert "This interview ends in 1 turn." in self.build(asked_about=["scope"], turns_left=1)
        assert "This interview ends" not in self.build(asked_about=["scope"], turns_left=9)

    def test_questions_the_shop_could_not_answer_are_counted_back(self):
        """The observed rabbit hole — a disc spec, then which manual, then that manual's part
        number — is five straight questions the shop was never going to be able to answer."""
        assert "unable to answer 5 of your questions" in self.build(
            asked_about=["tolerance"], unanswered=5)
        assert "unable to answer" not in self.build(asked_about=["tolerance"], unanswered=0)


class TestATickBoxIsNotAnAcceptanceRule:
    """Observed on a real demo procedure, not invented for a test.

    Asked to compile a brake pad job for a machine whose caliper torque nobody publishes, the
    Scoper did not refuse and did not fabricate a figure. It wrote a `choice` field offering
    the single option "Tightened firmly by feel" — a tick box, for the fastener whose own
    explanation in this repo is the step that kills someone if it is skipped. It slipped past
    every numeric check because it contains no number to check.
    """

    def check(self, field):
        from warrant import REGISTRY
        draft = {"key": "k", "title": "t", "strictness": 1, "minimum_tier": "open",
                 "steps": [{"title": "s", "explanation": "e", "max_add_fields": 2,
                            "fields": [field]}]}
        return REGISTRY["scoper"]().check_conditionals(
            {"mode": "compile", "unresolved": [], "understanding": "u", "draft": draft})

    def base(self, **over):
        f = {"key": "caliper_tightness_check", "kind": "choice", "prompt": "p",
             "source": "human", "required_at_strictness": 1, "acceptance_rule": "matches",
             "guidance": "g", "acceptance_target": "Tightened firmly by feel"}
        f.update(over)
        return f

    def test_the_single_option_tick_box_is_refused(self):
        errs = self.check(self.base(choices=["Tightened firmly by feel"]))
        assert any("cannot record the job going wrong" in e for e in errs)

    def test_a_choice_with_no_options_at_all_is_refused(self):
        assert any("cannot record the job going wrong" in e for e in self.check(self.base()))

    def test_a_choice_that_can_fail_is_accepted(self):
        errs = self.check(self.base(key="disc_contamination",
                                    choices=["No oil or fluid detected", "Oil or fluid detected"]))
        assert errs == []

    def test_non_choice_fields_are_untouched(self):
        """The gate is about what a choice can express, not about every field having options."""
        errs = self.check(self.base(kind="photo", acceptance_rule="must_show",
                                    acceptance_description="the pads seated in the caliper"))
        assert errs == []
