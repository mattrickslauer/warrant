"""The conditionals that carry Auditor and Wright.

Both agents were added with one refusal each that the rest of the fleet depends on, and both
refusals live in `check_conditionals` because a JSON Schema cannot state either. A schema can
say `unit` is a string. It cannot say the string must name a physical quantity, and "count" is
a perfectly good string.

These call no model. Every case below is a well-formed answer that a fluent model could
plausibly return, and the assertion is that it is caught anyway.
"""
import pytest

from warrant import REGISTRY

FULL = "-0000-1000-8000-00805f9b34fb"
#: A driver that actually satisfies every member `Driver` declares. The earlier fixture here
#: was a one-line stub, and the member gate correctly rejected it — which is the gate working.
GOOD_KOTLIN = """package ink.warrant.instrument
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

class AcmeDriver : Driver {
    override val id = "acme-hygrometer-v1"
    override val label = "Acme hygrometer"
    override val produces = Produces(unit = "%RH", min = 0.0, max = 100.0)
    override val matches = Match(serviceUuids = listOf(UUID.fromString("0000181a__F__")))
    override fun characteristicFor(services: List<UUID>): CharacteristicRef? =
        if (services.any { it.toString() == "0000181a__F__" })
            CharacteristicRef(UUID.fromString("0000181a__F__"),
                              UUID.fromString("00002a6f__F__")) else null
    override fun decode(raw: ByteArray): Double? {
        if (raw.size != 2) return null
        return ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).short.toDouble() / 100.0
    }
}""".replace("__F__", FULL)


def emit(**over):
    driver = {"class_name": "AcmeDriver", "label": "Acme hygrometer",
              "service": "0000181a" + FULL, "characteristic": "00002a6f" + FULL,
              "unit": "%RH", "min": 0.0, "max": 100.0, "kotlin": GOOD_KOTLIN,
              "rationale": "uint16 little-endian at offset 0, scale 0.01"}
    driver.update(over)
    return {"mode": "emit", "understanding": "a hygrometer", "evidence": ["0x2901 says Humidity"],
            "unresolved": [], "driver": driver}


def errs(agent, out):
    return REGISTRY[agent]().check_conditionals(out)


class TestWrightWillNotEmitAnUnnamedNumber:
    """A number whose unit nobody can name is not a measurement. It is the single rule that
    separates this agent from a generic GATT reader, so it is the one most worth testing."""

    def test_a_good_driver_is_accepted(self):
        assert errs("wright", emit()) == []

    @pytest.mark.parametrize("unit", ["", "unknown", "raw", "count", "counts", "n/a", "value"])
    def test_a_unit_that_names_nothing_is_refused(self, unit):
        assert any("unit" in e for e in errs("wright", emit(unit=unit))), \
            f"{unit!r} was accepted as a physical unit"

    def test_case_and_padding_do_not_evade_it(self):
        assert any("unit" in e for e in errs("wright", emit(unit="  RAW  ")))


class TestWrightWillNotPickADecoy:
    """0x2A19 reads first on a great many devices and decodes to a believable integer. A
    generic driver picks it; this agent's whole justification is that it does not."""

    @pytest.mark.parametrize("char,what", [
        ("00002a19" + FULL, "battery level"),
        ("00002a26" + FULL, "firmware revision"),
        ("00002a25" + FULL, "serial number"),
    ])
    def test_a_device_information_characteristic_is_refused(self, char, what):
        out = emit(characteristic=char, kotlin=f'class D {{ val c = "{char}" }}')
        assert any("characteristic" in e for e in errs("wright", out)), f"{what} was accepted"

    def test_the_short_form_does_not_evade_it(self):
        """SIG characteristics are written both ways in the wild. A check that matched only the
        128-bit form would be evaded by writing 0x2A19."""
        out = emit(characteristic="0x2A19", kotlin='class D { val c = "0x2A19" }')
        assert any("characteristic" in e for e in errs("wright", out))


class TestWrightsOtherGates:
    def test_a_degenerate_range_is_refused(self):
        assert any("min/max" in e for e in errs("wright", emit(min=50.0, max=50.0)))

    def test_source_that_never_mentions_its_own_characteristic_is_refused(self):
        out = emit(kotlin="class D { /* nothing about which device this is */ }")
        assert any("kotlin" in e for e in errs("wright", out))

    def test_a_class_carrying_only_decode_does_not_implement_the_interface(self):
        """What the model actually emitted the first time it was asked, before it was shown
        the interface: correct arithmetic in a class that would not compile. `Driver` declares
        six members and the anvil compiles against the real file."""
        out = emit(kotlin=('class EnvT1Driver : Driver { override fun decode(b: ByteArray)'
                           ': Double? = null } // 00002a6f' + FULL))
        bad = [e for e in errs("wright", out) if "does not implement Driver" in e]
        assert bad and "characteristicFor" in bad[0] and "produces" in bad[0]

    def test_emitting_with_nothing_cited_is_refused(self):
        out = emit(); out["evidence"] = []
        assert any("evidence" in e for e in errs("wright", out))

    def test_emitting_with_unresolved_outstanding_is_refused(self):
        out = emit(); out["unresolved"] = ["which byte carries the reading"]
        assert any("unresolved" in e for e in errs("wright", out))

    def test_sample_while_changing_must_tell_the_person_what_to_do(self):
        """There is a human holding the device. A probe that asks them to make the quantity move
        without saying how is not an instruction."""
        out = {"mode": "probe", "understanding": "u", "evidence": ["e"], "unresolved": ["x"],
               "probe": {"op": "sample_while_changing", "samples": 10, "why": "to see it track"}}
        assert any("instruction" in e for e in errs("wright", out))


def finding(**over):
    f = {"step_title": "Clean the caliper up", "defect": "ambiguous_instruction",
         "what": "nobody can tell what clean enough means", "jobs_cited": ["J-4401", "J-4403"],
         "jobs_affected": 2, "proposed_revision": "say what the photo must show",
         "needs_the_shop": False, "confidence": 0.8}
    f.update(over)
    return {"mode": "revise", "understanding": "u", "jobs_examined": 11,
            "findings": [f], "considered_and_rejected": []}


class TestTheAuditorMustShowItsEvidence:
    def test_a_well_evidenced_finding_is_accepted(self):
        assert errs("auditor", finding()) == []

    def test_a_finding_citing_no_jobs_is_refused(self):
        """The one output of this agent nobody downstream can check, which makes it the one
        most worth refusing outright."""
        assert any("jobs_cited" in e for e in errs("auditor", finding(jobs_cited=[])))

    def test_claiming_more_jobs_than_were_examined_is_refused(self):
        assert any("jobs_affected" in e for e in errs("auditor", finding(jobs_affected=99)))

    def test_claiming_more_affected_than_cited_is_refused(self):
        out = finding(jobs_cited=["J-1"], jobs_affected=7)
        assert any("names only" in e for e in errs("auditor", out))

    def test_citing_more_jobs_than_it_claims_affected_is_fine(self):
        """Odd, not dishonest. Only the other direction claims something it cannot show."""
        assert errs("auditor", finding(jobs_cited=["J-1", "J-2", "J-3"], jobs_affected=2)) == []


class TestTheAuditorMayNotSupplyATolerance:
    """The Scoper's unbreakable rule arriving through a different door. Saying a bound is wrong
    is a finding; saying what it should instead be is a fabricated figure that every future
    record would carry as though a person had set it."""

    def test_a_wrong_bound_must_be_referred_back_to_the_shop(self):
        out = finding(defect="bound_wrong", needs_the_shop=False)
        assert any("needs_the_shop" in e for e in errs("auditor", out))

    def test_a_wrong_bound_referred_back_is_accepted(self):
        assert errs("auditor", finding(defect="bound_wrong", needs_the_shop=True)) == []


class TestTheAuditorsModes:
    def test_revising_with_nothing_found_is_refused(self):
        out = finding(); out["findings"] = []
        assert any("findings" in e for e in errs("auditor", out))

    @pytest.mark.parametrize("mode", ["no_defect", "insufficient_history"])
    def test_reporting_no_defect_while_listing_findings_is_refused(self, mode):
        out = finding(); out["mode"] = mode
        assert any("findings" in e for e in errs("auditor", out))


class TestEveryAgentIsReachable:
    def test_all_seven_are_registered_and_build_a_prompt(self, scenarios):
        """A new agent that is registered but whose scenarios never load is worse than one that
        does not exist: the suite reports a smaller corpus and nobody notices."""
        assert len(REGISTRY) == 7
        seen = {c["agent"] for c in scenarios(None, None)}
        assert seen == set(REGISTRY), f"no scenarios for {set(REGISTRY) - seen}"
