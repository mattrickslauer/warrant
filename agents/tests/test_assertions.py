"""The assertion language has to be right before anything it judges can be trusted."""
import pytest

from evals.assertions import BadAssertion, MISSING, evaluate, resolve, validate_expect

OUT = {"verdict": "ADD_FIELD", "confidence": 0.42, "rationale": "The label is lost to glare.",
       "add_field_prompt": "photograph the label from an angle", "escalation_question": None,
       "unresolved": ["torque figure", "who signs it off"],
       "draft": {"minimum_tier": "instrumented",
                 "steps": [{"title": "Fit the pads", "fields": [{"key": "pad_torque"}]}]}}


def ok(expect):
    return all(c.ok for c in evaluate(OUT, expect))


def test_dotted_path_walks_lists_and_dicts():
    assert resolve(OUT, "draft.steps.0.fields.0.key") == "pad_torque"
    assert resolve(OUT, "draft.steps.9.key") is MISSING
    assert resolve(OUT, "nope.deeper") is MISSING


def test_absent_treats_null_empty_and_missing_alike():
    # The model may express "does not apply" as null, as "", or by omission. All three are
    # the same claim and a scenario should not have to care which one arrived.
    assert ok({"absent": ["escalation_question", "add_field_key"]})
    assert not ok({"absent": ["add_field_prompt"]})


def test_present_rejects_empty_string_and_empty_list():
    assert evaluate({"a": ""}, {"present": ["a"]})[0].ok is False
    assert evaluate({"a": []}, {"present": ["a"]})[0].ok is False
    assert evaluate({"a": "x"}, {"present": ["a"]})[0].ok is True


def test_mentions_reads_lists_as_flattened_text():
    assert ok({"mentions_any": {"unresolved": ["torque"]}})
    assert ok({"mentions_none": {"unresolved": ["disc"]}})


def test_mentions_is_case_insensitive():
    assert ok({"mentions_any": {"rationale": ["GLARE"]}})


def test_not_in_is_the_common_refusal_shape():
    assert ok({"not_in": {"verdict": ["PASS"]}})
    assert not ok({"not_in": {"verdict": ["ADD_FIELD"]}})


def test_numeric_comparison_rejects_non_numbers():
    assert evaluate({"confidence": "high"}, {"gte": {"confidence": 0.5}})[0].ok is False


def test_word_counts():
    assert ok({"min_words": {"rationale": 3}, "max_words": {"rationale": 20}})
    assert not ok({"min_words": {"rationale": 50}})


def test_unknown_operator_is_loud_not_silent():
    # A typo'd operator that quietly passes is worse than having no test at all.
    with pytest.raises(BadAssertion):
        evaluate(OUT, {"menshuns_any": {"rationale": ["glare"]}})
    assert validate_expect({"menshuns_any": {}}) != []


def test_operator_shape_is_validated_at_load():
    assert validate_expect({"equals": ["verdict"]}) != []
    assert validate_expect({"present": {"verdict": True}}) != []
    assert validate_expect({"equals": {"verdict": "PASS"}, "present": ["x"]}) == []
