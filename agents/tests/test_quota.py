"""Quota is a 4xx that means "not now", and everything here turns on that one distinction.

`_generate` sorts failures into repeatable and transient, and 429 was on the wrong side of
that line: a run of seventy scenarios died on whichever one happened to land in a full minute,
and reported it as the agent failing. These tests pin the sorting, the ladder that waits a
minute out, and the latch that stops seventy scenarios each paying to learn the same thing.

The SDK is skipped rather than required. Replaying the corpus needs no SDK at all, and a
judge who clones this repo and runs pytest should not be told the suite is broken because of
a dependency the thing under test imports lazily on purpose.
"""
import pytest

pytest.importorskip("google.genai")

from google.genai import errors as genai_errors  # noqa: E402

from warrant import model as model_mod  # noqa: E402
from warrant.model import ModelUnavailable, QuotaExhausted  # noqa: E402


def quota_error(retry_delay: str | None = None) -> genai_errors.ClientError:
    details: dict = {"status": "RESOURCE_EXHAUSTED", "message": "Quota exceeded", "code": 429}
    if retry_delay is not None:
        details["details"] = [{"@type": "type.googleapis.com/google.rpc.RetryInfo",
                               "retryDelay": retry_delay}]
    return genai_errors.ClientError(429, {"error": details})


@pytest.fixture
def vertex(monkeypatch):
    """A fake Vertex that answers with a scripted sequence, and a clock that does not tick.

    Sleeps are recorded rather than taken: the ladder's shape is the thing being asserted,
    and a test that proves it by waiting two minutes is a test nobody runs twice.
    """
    model_mod.reset_quota_gate()
    slept: list[float] = []
    monkeypatch.setattr(model_mod.time, "sleep", slept.append)

    def script(*answers):
        seen = {"calls": 0}

        class Models:
            def generate_content(self, **_):
                i = min(seen["calls"], len(answers) - 1)
                seen["calls"] += 1
                answer = answers[i]
                if isinstance(answer, Exception):
                    raise answer
                return answer

        class Client:
            models = Models()

        monkeypatch.setattr(model_mod, "_client", Client())
        return seen

    yield script, slept
    model_mod.reset_quota_gate()


def call():
    return model_mod._generate("instruction", [model_mod.Part(text="hello")],
                               {"type": "object"}, "gemini-3.5-flash", 0.0)


class TestQuotaIsRetried:
    def test_a_full_minute_is_waited_out_rather_than_reported_as_a_failure(self, vertex):
        script, slept = vertex
        seen = script(quota_error(), quota_error(), "the answer")
        assert call() == "the answer"
        assert seen["calls"] == 3
        # Both waits came off the quota ladder, not the transport one — the transport ladder
        # would have spent the whole loop inside the same closed minute.
        assert slept == [model_mod.QUOTA_BACKOFF[0], model_mod.QUOTA_BACKOFF[1]]

    def test_the_server_s_own_retry_delay_beats_the_ladder(self, vertex):
        script, slept = vertex
        script(quota_error("3s"), "the answer")
        assert call() == "the answer"
        assert slept == [3.0]

    def test_an_absurd_retry_delay_is_capped(self, vertex):
        # Accurate and useless. Nobody watching a demo waits an hour to be told to wait.
        script, slept = vertex
        script(quota_error("3600s"), "the answer")
        assert call() == "the answer"
        assert slept == [model_mod.QUOTA_MAX_WAIT]

    def test_quota_that_never_clears_says_it_was_quota(self, vertex):
        script, _ = vertex
        seen = script(quota_error())
        with pytest.raises(QuotaExhausted) as caught:
            call()
        assert seen["calls"] == model_mod.ATTEMPTS
        assert "quota" in str(caught.value).lower()
        # It is still a ModelUnavailable, so evals/runner.py keeps catching it as one.
        assert isinstance(caught.value, ModelUnavailable)


class TestEverythingElseIsUnchanged:
    def test_a_403_is_never_retried(self, vertex):
        script, _ = vertex
        seen = script(genai_errors.ClientError(403, {"error": {"status": "PERMISSION_DENIED"}}))
        with pytest.raises(ModelUnavailable) as caught:
            call()
        assert seen["calls"] == 1
        assert not isinstance(caught.value, QuotaExhausted)

    def test_a_502_still_uses_the_transport_ladder(self, vertex):
        script, slept = vertex
        script(genai_errors.ServerError(502, {"error": {"status": "UNAVAILABLE"}}), "the answer")
        assert call() == "the answer"
        assert slept == [1.5]


class TestTheRunLearnsTheCeilingOnce:
    def test_a_confirmed_ceiling_short_circuits_every_later_call(self, vertex):
        script, _ = vertex
        script(quota_error())
        with pytest.raises(QuotaExhausted):
            call()

        # The corpus is fanned across a thread pool. If each of the remaining scenarios also
        # climbed the whole ladder, a run that is already doomed would take forty minutes to
        # say so — with the same one-line answer buried on every row.
        seen = script(quota_error())
        with pytest.raises(QuotaExhausted):
            call()
        assert seen["calls"] == 0, "the second call must not reach Vertex at all"

    def test_the_latch_is_a_cooldown_and_not_a_verdict(self, vertex, monkeypatch):
        # The same module runs inside the deployed engine, which is a container that lives
        # for days. A latch that never re-armed would mean one bad minute poisoned every
        # adjudication after it, and the fleet would keep saying "out of quota" long after
        # the quota came back — worse than the failure the latch exists to prevent.
        script, _ = vertex
        script(quota_error())
        with pytest.raises(QuotaExhausted):
            call()

        clock = [model_mod.time.monotonic() + model_mod.QUOTA_GATE_TTL + 1]
        monkeypatch.setattr(model_mod.time, "monotonic", lambda: clock[0])

        seen = script("the answer")
        assert call() == "the answer"
        assert seen["calls"] == 1, "the cooldown expired, so Vertex must be asked again"

    def test_the_ladder_is_shorter_where_someone_is_waiting(self, vertex, monkeypatch):
        # `infra/deploy-agents.py` sets this for the engine, which answers behind fleet.ts's
        # 45-second timeout. A thirty-second rung there is not patience — it is a wait the
        # caller has already given up on.
        script, slept = vertex
        monkeypatch.setenv("WARRANT_QUOTA_BACKOFF", "2,5")
        script(quota_error(), quota_error(), "the answer")
        assert call() == "the answer"
        assert slept == [2.0, 5.0]

    def test_a_malformed_ladder_does_not_make_quota_fatal(self, vertex, monkeypatch):
        script, slept = vertex
        monkeypatch.setenv("WARRANT_QUOTA_BACKOFF", "soon, later")
        script(quota_error(), "the answer")
        assert call() == "the answer"
        assert slept == [model_mod.QUOTA_BACKOFF[0]]

    def test_a_burst_does_not_trip_the_latch(self, vertex):
        # Tripping on any 429 would mean one unlucky moment poisoned the rest of the run.
        # The latch is evidence of a ceiling, and only a full ladder is that evidence.
        script, _ = vertex
        script(quota_error(), "the answer")
        assert call() == "the answer"

        seen = script("the next answer")
        assert call() == "the next answer"
        assert seen["calls"] == 1
