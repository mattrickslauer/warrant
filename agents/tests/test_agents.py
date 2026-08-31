"""The conditional rules — the part of the contract Vertex has no way to enforce.

`responseSchema` can say add_field_prompt is a string. It cannot say it is required when
and only when the verdict is ADD_FIELD. That gap is where a plausible-looking but useless
answer lives, so each agent closes it in code and each rule is tested here.
"""
import pytest

from warrant import Foreman, Inspector, Instructor, Scoper, Skeptic


class TestInspector:
    def setup_method(self):
        self.a = Inspector()

    def test_add_field_without_the_request_is_rejected(self):
        errs = self.a.check_conditionals({"verdict": "ADD_FIELD"})
        assert len(errs) == 3
        assert any("add_field_prompt" in e for e in errs)

    def test_add_field_with_the_request_is_accepted(self):
        assert self.a.check_conditionals({"verdict": "ADD_FIELD", "add_field_key": "k",
                                          "add_field_kind": "photo",
                                          "add_field_prompt": "photograph the label again"}) == []

    def test_escalate_needs_the_actual_question(self):
        assert self.a.check_conditionals({"verdict": "ESCALATE"}) != []
        assert self.a.check_conditionals({"verdict": "ESCALATE",
                                          "escalation_question": "which pad went in?"}) == []

    def test_a_pass_that_still_asks_for_something_is_incoherent(self):
        # A PASS carrying a follow-up request would advance the step and queue a question
        # nobody will ever answer.
        assert self.a.check_conditionals({"verdict": "PASS", "add_field_prompt": "again"}) != []
        assert self.a.check_conditionals({"verdict": "PASS"}) == []

    def test_the_prompt_states_the_confidence_bar_for_the_procedure(self):
        parts = self.a.parts(_inspector_case(strictness=3))
        assert "0.9" in parts[0].text

    def test_an_exhausted_budget_is_stated_as_a_prohibition(self):
        text = self.a.parts(_inspector_case(used=2))[0].text
        assert "none left" in text and "ESCALATE" in text

    def test_a_typed_number_is_labelled_as_a_claim(self):
        text = self.a.parts(_inspector_case(source="human"))[0].text
        assert "TYPED BY A PERSON" in text

    def test_a_consistent_with_rule_is_shown_what_it_compares_against(self):
        """`consistent_with` names an earlier field; without that image it is undecidable.

        Observed on the pickup procedure: p2 resolves against `p1.object_before` and the
        Inspector was handed only the new frame, so the honest answer was the one it gave —
        ESCALATE, "the reference image is not provided to verify consistency". A rule that
        can never be satisfied is worse than no rule: it escalates every correct job.
        """
        case = _inspector_case()
        case["field"] = {"key": "object_held", "kind": "photo", "prompt": "p",
                         "source": "camera", "acceptance_rule": "consistent_with",
                         "acceptance_target": "p1.object_before", "guidance": "g"}
        case["media"] = ["brake/pads-seated-sharp.jpg"]
        case["reference"] = {"target": "p1.object_before",
                             "media": ["brake/pads-seated-blurred.jpg"]}
        parts = self.a.parts(case)
        # The reference must arrive as pixels, not as a sentence about pixels.
        assert sum(1 for p in parts if p.data) == 2
        text = " ".join(p.text or "" for p in parts)
        assert "p1.object_before" in text
        # And it must be distinguishable from the evidence, or the Inspector will judge the
        # wrong frame against the rule.
        assert "reference" in text.lower()

    def test_the_reference_block_is_absent_when_there_is_no_reference(self):
        # Every other optional block in this prompt is omitted rather than nulled, because a
        # heading with nothing under it invites the model to invent what belongs there.
        parts = self.a.parts(_inspector_case())
        assert "reference" not in " ".join(p.text or "" for p in parts).lower()

    def test_media_is_attached_as_media_not_described(self):
        # An agent told "there is a photo" will hallucinate its contents.
        case = _inspector_case()
        case["media"] = ["brake/caliper-editorial-stockish.webp"]
        parts = self.a.parts(case)
        assert any(p.data for p in parts)


class TestSkeptic:
    def setup_method(self):
        self.a = Skeptic()

    def test_a_reuse_claim_must_name_the_original(self):
        assert self.a.check_conditionals({"belongs": False, "mismatch_kind": "reuse"}) != []
        assert self.a.check_conditionals({"belongs": False, "mismatch_kind": "reuse",
                                          "prior_capture_ref": "cap-1"}) == []

    def test_a_dissent_must_say_what_did_not_match(self):
        assert self.a.check_conditionals({"belongs": False, "mismatch_kind": "none"}) != []
        assert self.a.check_conditionals({"belongs": False}) != []

    def test_agreement_cannot_carry_a_mismatch(self):
        assert self.a.check_conditionals({"belongs": True, "mismatch_kind": "asset"}) != []
        assert self.a.check_conditionals({"belongs": True, "mismatch_kind": "none"}) == []

    def test_it_is_never_shown_a_verdict_to_agree_with(self):
        # The second opinion stops being one the moment it knows the first. The contract
        # tells it not to guess the Inspector's conclusion; the prompt must not hand it one.
        text = " ".join(p.text or "" for p in self.a.parts(_skeptic_case())).lower()
        for verdict in ("pass", "add_field", "escalate", "verdict"):
            assert verdict not in text

    def test_its_own_case_shape_has_nowhere_to_put_a_verdict(self):
        # Defence in depth: a future caller cannot leak one in by adding a key, because the
        # prompt builder only ever reads the fields listed here.
        assert "verdict" not in str(self.a.parts(_skeptic_case()))

    def test_upload_mode_is_flagged_as_unverifiable(self):
        case = _skeptic_case()
        case["capture"]["capture_mode"] = "upload"
        assert "unverified" in self.a.parts(case)[0].text

    def test_the_step_is_named_so_a_before_frame_is_not_read_as_a_wrong_scene(self):
        # `proc_smile_v1` step 1 asks for a face that is NOT smiling. Told only
        # "procedure: proc_smile_v1", the Skeptic read the requirement out of the slug, saw a
        # neutral face and dissented `scene` on evidence the technician had produced exactly as
        # asked. Every before/after procedure here opens on a frame that contradicts its own
        # title, so the step is what makes the scene question answerable at all.
        text = self.a.parts(_skeptic_case())[0].text
        assert "The step this capture answers" in text
        assert "Check pad wear" in text
        assert "3 of 4" in text
        assert "BEFORE state" in text

    def test_a_step_with_no_position_claims_none(self):
        # "None of None" would be worse than silence: it reads as a step standing outside the
        # procedure it belongs to. The key goes missing rather than null.
        case = _skeptic_case()
        case["step"] = {"title": "Check pad wear"}
        text = self.a.parts(case)[0].text
        assert "Check pad wear" in text
        assert "position" not in text

    def test_the_step_never_carries_what_would_satisfy_it(self):
        # Which step this is places the evidence. What a correct frame looks like grades it, and
        # grading belongs to an agent this one must not be able to echo. The case builder sends
        # title and position only; this asserts the prompt cannot render more even if it did.
        case = _skeptic_case()
        case["step"] = {"title": "Straight face", "index": 1, "of": 2,
                        "explanation": "measured against a face that was not smiling",
                        "acceptance_description": "mouth closed and not smiling"}
        text = self.a.parts(case)[0].text
        assert "measured against" not in text
        assert "mouth closed" not in text

    def test_a_job_with_no_asset_is_not_asked_to_identify_a_machine(self):
        # "Pick up an object" names no asset, and nothing in the app ever writes one. Asked
        # "is this THE machine" with every asset field null, the only honest answer under
        # "if you cannot establish identity, dissent" is a dissent — and a dissent on a PASS
        # is a deterministic escalation. The one procedure that exists so a judge with an
        # empty desk can seal a record could therefore never seal.
        text = self.a.parts(_assetless_case())[0].text
        assert "The machine this evidence is claimed to be of" not in text
        assert "names no registered asset" in text

    def test_an_assetless_job_is_still_asked_the_questions_it_can_answer(self):
        # Not a bypass. Time, scene and reuse are all still decidable without an asset, and
        # reuse is the cheat this demo exists to catch — photograph the same mug twice.
        text = self.a.parts(_assetless_case())[0].text.lower()
        for question in ("time", "scene", "submitted before"):
            assert question in text


class TestInstructor:
    def test_a_missing_part_must_be_named(self):
        a = Instructor()
        assert a.check_conditionals({"blocker_kind": "part_missing"}) != []
        assert a.check_conditionals({"blocker_kind": "part_missing",
                                     "blocking_part": "EBC FA388HH"}) == []

    def test_the_transcript_reaches_the_model_verbatim(self):
        said = "I've been at this bloody thing for forty minutes"
        text = Instructor().parts({"step": {}, "machine": {}, "procedure": {},
                                   "transcript": said})[0].text
        assert said in text


class TestForeman:
    def setup_method(self):
        self.a = Foreman()

    @pytest.mark.parametrize("action,field", [("chase", "chase_after"),
                                              ("reorder", "reorder_part"),
                                              ("escalate", "escalate_to_role")])
    def test_each_action_carries_what_it_needs_to_be_acted_on(self, action, field):
        assert self.a.check_conditionals({"action": action}) != []
        assert self.a.check_conditionals({"action": action, field: "x"}) == []

    def test_revise_needs_nothing_extra(self):
        assert self.a.check_conditionals({"action": "revise"}) == []

    def test_a_waiver_request_arrives_with_its_standing_and_the_rule(self):
        text = self.a.parts({"job": {}, "step": {}, "recommendation": {},
                             "waiver_request": {"by": "Dave", "has_standing": False,
                                                "said": "sign it off"}})[0].text
        assert "standing" in text and "may not waive" in text


class TestScoper:
    def setup_method(self):
        self.a = Scoper()

    def test_asking_and_compiling_are_mutually_exclusive(self):
        assert self.a.check_conditionals({"mode": "ask", "question": "q",
                                          "asks_about": "tolerance"}) == []
        assert self.a.check_conditionals({"mode": "ask", "question": "q",
                                          "asks_about": "tolerance",
                                          "draft": {"steps": []}}) != []

    def test_compiling_with_anything_unresolved_is_rejected(self):
        errs = self.a.check_conditionals(
            {"mode": "compile", "unresolved": ["the torque figure"],
             "draft": _draft()})
        assert any("unresolved" in e for e in errs)

    def test_an_instrument_field_forces_the_instrumented_tier(self):
        # Derived, never chosen. Otherwise the procedure is refused at run time and the shop
        # is never told why.
        d = _draft(source="instrument", tier="open")
        assert any("minimum_tier" in e for e in self.a.check_conditionals(
            {"mode": "compile", "unresolved": [], "draft": d}))
        d["minimum_tier"] = "instrumented"
        assert self.a.check_conditionals({"mode": "compile", "unresolved": [], "draft": d}) == []

    def test_a_bound_that_was_never_stated_is_caught(self):
        d = _draft(rule="within")
        errs = self.a.check_conditionals({"mode": "compile", "unresolved": [], "draft": d})
        assert any("no bound" in e for e in errs)

    def test_must_show_needs_something_it_must_show(self):
        d = _draft(rule="must_show")
        d["steps"][0]["fields"][0]["acceptance_description"] = ""
        assert any("must_show" in e for e in self.a.check_conditionals(
            {"mode": "compile", "unresolved": [], "draft": d}))

    def test_duplicate_field_keys_are_caught(self):
        d = _draft()
        d["steps"][0]["fields"].append(dict(d["steps"][0]["fields"][0]))
        assert any("share a key" in e for e in self.a.check_conditionals(
            {"mode": "compile", "unresolved": [], "draft": d}))


# --- fixtures ---------------------------------------------------------------------
def _inspector_case(strictness=2, used=0, source="instrument"):
    return {"step": {"title": "t", "explanation": "e", "max_add_fields": 2},
            "field": {"key": "k", "kind": "measurement", "prompt": "p", "source": "instrument",
                      "acceptance_rule": "within", "acceptance_min": 6, "acceptance_max": 9,
                      "acceptance_unit": "Nm", "guidance": "g"},
            "capture": {"capture_mode": "live", "capture_surface": "app_instrument"},
            "reading": {"value": 7.5, "unit": "Nm", "source": source},
            "strictness": strictness, "add_fields_used": used, "media": []}


def _skeptic_case():
    return {"asset": {"id": "A-1"}, "job": {"id": "J-1"},
            "step": {"title": "Check pad wear", "index": 3, "of": 4},
            "capture": {"capture_mode": "live", "capture_surface": "app"},
            "media": [], "prior_media": []}


def _assetless_case():
    """A public procedure. No tenant, no fleet, no registered asset — anything on a desk."""
    return {"asset": None, "job": {"id": "anon/J-1", "procedure": "proc_pickup_v1"},
            "step": {"title": "Show it where it lies", "index": 1, "of": 2},
            "capture": {"capture_mode": "live", "capture_surface": "app"},
            "media": [], "prior_media": []}


def _draft(source="camera", tier="open", rule="must_show"):
    field = {"key": "f1", "kind": "photo", "source": source, "prompt": "p",
             "required_at_strictness": 1, "acceptance_rule": rule, "guidance": "g"}
    if rule == "must_show":
        field["acceptance_description"] = "both pads seated in the caliper"
    return {"key": "k", "title": "t", "strictness": 1, "minimum_tier": tier,
            "steps": [{"title": "s", "explanation": "e", "max_add_fields": 2, "fields": [field]}]}
