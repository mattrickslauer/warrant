"""End to end, with the model replaced by a recording.

These are the tests that say the suite is worth running. A harness that reports pass on
everything is indistinguishable from a working one until the day it matters, so each case
below feeds the pipeline a deliberately wrong answer and asserts it is caught — and for the
same scenario, feeds the right one and asserts it is not.
"""
import json

import pytest

from evals.runner import ScenarioError, load_scenarios, run_one

#: The right answer to `inspector/no-media-at-all-cannot-pass`. That scenario is the vehicle
#: for the discrimination tests because it attaches no media, so these run anywhere — before
#: the corpus imagery has ever been generated.
GOOD_INSPECTOR = {"verdict": "ADD_FIELD", "confidence": 0.1,
                  "rationale": "Nothing was captured for this field, so there is no evidence to judge.",
                  "add_field_key": "pads_seated_retry", "add_field_kind": "photo",
                  "add_field_prompt": "photograph the new pads seated in the front caliper, close "
                                      "enough that both pad faces are visible"}
SID = "no-media-at-all"


def case(scenarios, sid):
    found = [c for c in scenarios(None, sid)]
    assert len(found) == 1, f"{sid} matched {len(found)}"
    return found[0]


class TestItAcceptsARightAnswer:
    def test_a_correct_add_field_passes(self, scenarios, seed):
        c = case(scenarios, SID)
        seed(c, GOOD_INSPECTOR)
        assert run_one(c, live=False, temperature=0.0)["status"] == "pass"


class TestItCatchesAWrongAnswer:
    @pytest.mark.parametrize("mutation,expect_status,because", [
        ({"verdict": "PASS", "add_field_key": None, "add_field_kind": None,
          "add_field_prompt": None},
         "fail", "an unreadable label was waved through"),
        ({"confidence": 0.95},
         "fail", "high confidence about evidence that does not exist"),
        ({"add_field_prompt": None},
         "invalid", "ADD_FIELD without the request is off-contract"),
        ({"confidence": "very high"},
         "invalid", "confidence must be a number"),
        ({"rationale": "The pads are clearly seated and the material is thick."},
         "fail", "the rationale describes evidence that was never supplied"),
    ])
    def test_each_defect_is_reported(self, scenarios, seed, mutation, expect_status, because):
        c = case(scenarios, SID)
        seed(c, {**GOOD_INSPECTOR, **mutation})
        row = run_one(c, live=False, temperature=0.0)
        assert row["status"] == expect_status, f"{because}: got {row['status']}"

    def test_the_corpus_rejects_a_generic_retry(self, scenarios):
        # Asserted against the scenario that owns the rule, evaluated directly so it needs
        # neither a model nor the generated imagery.
        from evals.assertions import evaluate
        expect = case(scenarios, "label-lost-to-glare")["expect"]
        answer = {"verdict": "ADD_FIELD", "confidence": 0.3, "rationale": "unreadable",
                  "add_field_key": "k", "add_field_kind": "photo"}
        lazy = evaluate({**answer, "add_field_prompt": "please try again"}, expect)
        assert not all(c.ok for c in lazy)
        specific = evaluate({**answer, "add_field_prompt":
                             "photograph the label from a shallower angle, the overhead light "
                             "is reflecting straight off it"}, expect)
        assert all(c.ok for c in specific), [str(c) for c in specific if not c.ok]

    def test_a_failure_names_the_assertion_that_failed(self, scenarios, seed):
        c = case(scenarios, SID)
        seed(c, {**GOOD_INSPECTOR, "verdict": "PASS", "add_field_key": None,
                 "add_field_kind": None, "add_field_prompt": None,
                 "rationale": "Looks fine."})
        row = run_one(c, live=False, temperature=0.0)
        failed = [ch for ch in row["checks"] if not ch["ok"]]
        assert failed and any(ch["path"] == "verdict" for ch in failed)
        assert "PASS" in " ".join(ch["detail"] for ch in failed)


class TestItRefusesToGuess:
    def test_a_scenario_whose_media_is_absent_is_an_error_not_a_pass(self, scenarios, seed):
        # The agent was never shown what the scenario claims. Scoring that as a verdict is
        # the single worst thing this harness could do.
        #
        # The reference is fabricated rather than borrowed from a real scenario on purpose:
        # this test used to name a case whose photograph had not been taken yet, and quietly
        # stopped testing anything the day that photograph was added to the corpus.
        c = dict(case(scenarios, "pads-seated-clean-passes"))
        c["input"] = {**c["input"], "media": ["brake/a-photograph-nobody-has-taken.jpg"]}
        row = run_one(c, live=False, temperature=0.0)
        assert row["status"] == "error"
        assert "media" in row["error"]

    def test_no_cassette_and_no_network_is_an_error_not_a_pass(self, scenarios, cassettes):
        c = case(scenarios, "asked-to-skip")
        row = run_one(c, live=False, temperature=0.0)
        assert row["status"] == "error"
        assert "cassette" in row["error"]

    def test_a_reworded_prompt_invalidates_the_recording(self, scenarios, seed, monkeypatch):
        c = case(scenarios, "asked-to-skip")
        seed(c, {"reason_summary": "wants it marked off", "blocker_kind": "other",
                 "recommended_action": "the step must be performed", "proposed_status": "deferred",
                 "safety_flag": False})
        assert run_one(c, live=False, temperature=0.0)["status"] == "pass"

        import warrant.base
        monkeypatch.setattr(warrant.base.Agent, "instruction", lambda self: "reworded")
        # Silently reusing the old recording would report a stale verdict as a current one.
        assert run_one(c, live=False, temperature=0.0)["status"] == "error"


class TestTheCorpusItself:
    def test_every_scenario_loads_and_declares_why_it_exists(self, scenarios):
        cases = scenarios(None, None)
        assert len(cases) >= 40
        for c in cases:
            assert len(c["why"].split()) >= 8, f"{c['id']}: why is too thin to be useful"
            assert c["expect"], f"{c['id']}: asserts nothing"

    def test_every_agent_is_covered(self, scenarios):
        from warrant import REGISTRY
        covered = {c["agent"] for c in scenarios(None, None)}
        assert covered == set(REGISTRY)

    def test_each_agent_has_both_an_acceptance_and_a_refusal_case(self, scenarios):
        # A suite of only-refusals produces an agent that refuses everything and scores 100%.
        by_agent = {}
        for c in scenarios(None, None):
            by_agent.setdefault(c["agent"], []).append(json.dumps(c["expect"]))
        for agent, expects in by_agent.items():
            blob = " ".join(expects)
            assert any(k in blob for k in ("not_in", "is_false", '"absent"', "mentions_none")), \
                f"{agent}: no scenario asserts that it withholds or refuses anything"
            assert any(k in blob for k in ('"equals"', '"is_true"', '"PASS"')), \
                f"{agent}: never accepts anything"

    def test_a_malformed_scenario_is_rejected_at_load(self, tmp_path, monkeypatch):
        import evals.runner as runner
        bad = tmp_path / "inspector"
        bad.mkdir()
        (bad / "x.json").write_text(json.dumps(
            {"why": "short", "input": {}, "expect": {"menshuns": {"a": 1}}}))
        monkeypatch.setattr(runner, "SCENARIOS", tmp_path)
        with pytest.raises(ScenarioError) as e:
            runner.load_scenarios()
        assert "menshuns" in str(e.value)
