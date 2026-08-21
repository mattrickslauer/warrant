"""The one place a model is called.

Live calls go through the **Google GenAI SDK** against **Vertex AI**. Structured output is
not parsed out of prose: the contract schema is handed over as `response_schema` and the
model returns JSON or fails.

**Replay needs none of that.** The SDK is imported lazily, inside the live branch only, so
a judge cloning this repo can replay the entire recorded suite on the standard library
alone — no SDK, no cloud account, no credentials. That property was the whole reason this
module used to speak raw REST; it survives, and now the live path uses the framework the
rest of the platform is built on instead of hand-rolling HTTP.

Every call goes through a cassette. The key covers the model, the instruction, the schema
and the bytes of every attachment, so changing a prompt necessarily misses the cache and
re-running an unchanged suite costs nothing. That is what makes iterating on one agent's
wording cheap while the other forty scenarios stay free.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

#: Redirectable so an experiment, or CI, can record somewhere other than the checked-in
#: store. Never point this at the repo copy while fabricating answers: a hand-written
#: cassette is indistinguishable from a recorded one, and this suite is the thing that is
#: supposed to tell you what the model actually said.
CASSETTES = Path(os.environ.get("WARRANT_CASSETTES")
                 or Path(__file__).resolve().parents[1] / "evals" / "cassettes")

DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
PROJECT = os.environ.get("GCP_PROJECT", "warrent-505918")

#: Where the MODEL is served, which is not where the rest of the project runs. The Gemini 3
#: family is published to the `global` endpoint; asking a regional host for it returns a flat
#: 404 that reads exactly like a model that does not exist. Overridable for a model that is
#: genuinely regional, but `global` is the correct default for everything this fleet calls.
MODEL_LOCATION = os.environ.get("GEMINI_LOCATION", "global")


class ModelUnavailable(RuntimeError):
    """No cassette and no live access. Distinct from a model that answered badly."""


@dataclass
class Part:
    """One piece of the user turn. Text, media bytes, or media BY REFERENCE.

    A URI part names an object the model reads for itself. It exists because the deployed
    fleet judges photographs that live in Cloud Storage, and base64 through the query payload
    would mean every megabyte crossed the wire twice for no gain.
    """
    text: str | None = None
    mime_type: str | None = None
    data: bytes | None = None
    #: A `gs://` object the model reads directly. Mutually exclusive with `data`.
    uri: str | None = None
    label: str = ""

    def to_sdk(self) -> Any:
        """As an SDK Part. Imported here, not at module scope, so replay stays stdlib-only."""
        from google.genai import types
        if self.text is not None:
            return types.Part.from_text(text=self.text)
        if self.uri is not None:
            return types.Part.from_uri(file_uri=self.uri,
                                       mime_type=self.mime_type or "application/octet-stream")
        return types.Part.from_bytes(data=self.data or b"",
                                     mime_type=self.mime_type or "application/octet-stream")

    def digest(self) -> str:
        if self.text is not None:
            return "t:" + hashlib.sha256(self.text.encode()).hexdigest()[:16]
        # A URI part has no bytes to key on, so it keys on the reference. Replay of a
        # gs:// part is therefore only ever as trustworthy as the object being immutable,
        # which is why storage.rules makes evidence append-only.
        if self.uri is not None:
            return f"u:{self.mime_type}:" + hashlib.sha256(self.uri.encode()).hexdigest()[:16]
        return f"m:{self.mime_type}:" + hashlib.sha256(self.data or b"").hexdigest()[:16]


@dataclass
class Call:
    """What was asked and what came back. The eval report reads this, not the raw HTTP."""
    key: str
    output: dict[str, Any]
    cached: bool
    latency_ms: int
    model: str
    raw: str = ""
    usage: dict[str, Any] = field(default_factory=dict)


def _cache_key(model: str, instruction: str, parts: list[Part],
               schema: dict[str, Any], temperature: float) -> str:
    payload = json.dumps({
        "model": model,
        "instruction": instruction,
        "parts": [p.digest() for p in parts],
        "schema": schema,
        "temperature": temperature,
    }, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:32]


def _credentials() -> Any:
    """Application Default Credentials, falling back to the `gcloud` user credential.

    ADC is the right answer on Cloud Run and in CI, where the metadata server hands the
    container a short-lived token and no key exists to leak. On a developer's laptop ADC is
    frequently just absent — `gcloud auth application-default login` is a separate step from
    `gcloud auth login`, and forgetting it produces a DefaultCredentialsError that says
    nothing about the model. Rather than make that a dead end, fall back to the same
    `gcloud` credential every other script in this repo already uses.
    """
    try:
        import google.auth
        creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"])
        return creds
    except Exception:
        pass
    try:
        from google.oauth2.credentials import Credentials
        tok = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"], text=True, timeout=60,
            stderr=subprocess.PIPE).strip()
        return Credentials(token=tok)
    except FileNotFoundError as e:
        raise ModelUnavailable(
            "no ADC and gcloud is not installed; run with --replay") from e
    except subprocess.CalledProcessError as e:
        raise ModelUnavailable(f"gcloud auth failed: {e.stderr.strip()[:200]}") from e
    except subprocess.TimeoutExpired as e:
        raise ModelUnavailable("gcloud auth timed out") from e


#: Short on purpose. A healthy structured-output call answers in about five seconds; this
#: endpoint instead stalls outright now and then, and the stall clears immediately on a retry.
#: Waiting three minutes for one that is never coming turns a transient into a dead run, so a
#: call that has said nothing by now is abandoned and asked again rather than waited on.
CALL_TIMEOUT = int(os.environ.get("WARRANT_TIMEOUT", "45"))
ATTEMPTS = 5

_client: Any = None


def client() -> Any:
    """The Vertex client, built once per run. Import is lazy so replay never needs the SDK."""
    global _client
    if _client is not None:
        return _client
    try:
        from google import genai
    except ImportError as e:
        raise ModelUnavailable(
            "google-genai is not installed; `pip install -r agents/requirements.txt`, "
            "or run with --replay to use the recorded cassettes") from e
    _client = genai.Client(vertexai=True, project=PROJECT,
                           location=MODEL_LOCATION, credentials=_credentials())
    return _client


def _generate(instruction: str, parts: list[Part], schema: dict[str, Any],
              model: str, temperature: float) -> Any:
    """One structured call, retried on transport faults but never on a verdict.

    The endpoint 502s and stalls intermittently under load. Neither is a model verdict, so
    both are retried: a call that timed out mid-read tells you nothing about the answer, and
    letting it through would record "the agent failed" for a scenario the agent was never
    actually asked. A 4xx is the opposite — it will say the same thing five times — so it
    surfaces immediately.
    """
    from google.genai import types
    from google.genai import errors as genai_errors

    config = types.GenerateContentConfig(
        system_instruction=instruction,
        temperature=temperature,
        response_mime_type="application/json",
        response_schema=schema,
        http_options=types.HttpOptions(timeout=CALL_TIMEOUT * 1000),
        # These agents answer with a schema, never by calling a tool. Saying so explicitly
        # keeps the SDK from warning about automatic function calling on every single call.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    contents = [types.Content(role="user", parts=[p.to_sdk() for p in parts])]

    last: Exception | None = None
    for attempt in range(ATTEMPTS):
        try:
            return client().models.generate_content(
                model=model, contents=contents, config=config)
        except genai_errors.ClientError as e:            # 4xx — a real, repeatable refusal
            raise ModelUnavailable(f"{e}"[:400]) from e
        except genai_errors.ServerError as e:            # 5xx — transient
            last = e
        except ModelUnavailable:
            # A missing SDK or an unusable credential will not fix itself on the fourth
            # attempt. Surface it now rather than sleeping through five of them.
            raise
        except TimeoutError as e:
            last = e
        except Exception as e:                           # transport-level stalls and resets
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise ModelUnavailable(f"gave up after {ATTEMPTS} attempts: {last}")


def generate_json(instruction: str, parts: list[Part], schema: dict[str, Any], *,
                  model: str = DEFAULT_MODEL, temperature: float = 0.0,
                  live: bool = False, record: bool = True) -> Call:
    """Ask for one structured answer. Replays from cassette unless `live` is set.

    temperature defaults to 0: a scenario suite is measuring the prompt and the schema, and
    sampling noise on top of that makes a regression indistinguishable from a reroll.
    """
    key = _cache_key(model, instruction, parts, schema, temperature)
    cassette = CASSETTES / f"{key}.json"

    if not live and cassette.exists():
        saved = json.loads(cassette.read_text())
        return Call(key=key, output=saved["output"], cached=True, latency_ms=0,
                    model=saved.get("model", model), raw=saved.get("raw", ""),
                    usage=saved.get("usage", {}))
    if not live:
        raise ModelUnavailable(
            f"no cassette {key[:12]} for this input; re-run with --live to record it")

    started = time.time()
    response = _generate(instruction, parts, schema, model, temperature)
    latency = int((time.time() - started) * 1000)

    text = response.text
    if not text:
        # A blocked or empty candidate is not an answer. Say which, rather than letting a
        # JSONDecodeError downstream imply the agent said something malformed.
        reason = getattr(response, "prompt_feedback", None) or (
            response.candidates[0].finish_reason if response.candidates else None)
        raise ModelUnavailable(f"no candidate text in response (finish_reason={reason})")

    # A schema-constrained response that will not parse is a real failure and must surface
    # as one, not be smoothed over — the eval reports it against the scenario.
    output = json.loads(text)

    um = response.usage_metadata
    usage = {"promptTokenCount": getattr(um, "prompt_token_count", None),
             "candidatesTokenCount": getattr(um, "candidates_token_count", None),
             "totalTokenCount": getattr(um, "total_token_count", None)} if um else {}

    #: What the service says it served, which is the only trustworthy record of the model
    #: actually used. An alias resolves server-side, so the name asked for and the name that
    #: answered are not always the same string — and the record has to hold the latter.
    served = getattr(response, "model_version", None) or model

    if record:
        CASSETTES.mkdir(parents=True, exist_ok=True)
        cassette.write_text(json.dumps(
            {"model": served, "requested_model": model, "location": MODEL_LOCATION,
             "instruction": instruction,
             "parts": [p.digest() for p in parts], "labels": [p.label for p in parts],
             "output": output, "raw": text, "usage": usage}, indent=2))

    return Call(key=key, output=output, cached=False, latency_ms=latency,
                model=served, raw=text, usage=usage)
