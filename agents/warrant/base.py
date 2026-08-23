"""What every Warrant agent is, and the two things each one has to supply.

An agent is a schema plus a way of laying the situation in front of the model. The
instruction comes from the contract, the response schema comes from the contract, and
validation runs against the contract — so a subclass below is only ever the part that is
genuinely specific to it: which facts this agent is shown, in what order, and which media
it has to actually look at.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from .contract import required_fields, response_schema, system_instruction, validation_schema
from .model import Call, Part, generate_json

MEDIA_DIR = Path(__file__).resolve().parents[1] / "evals" / "media"

#: What an agent may be handed. Mostly evidence — but `.pdf` is here for the authoring desk,
#: where a shop uploads the paper form it already uses and the Scoper reads it directly. A
#: document is not evidence and never becomes any; see `Scoper.parts`.
_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4",
         ".pdf": "application/pdf"}


class MediaMissing(RuntimeError):
    """A scenario names evidence that is not on disk.

    Raised rather than silently dropping the attachment. An Inspector asked to judge a
    photo it was never given will confidently return something, and that answer would be
    scored as though it had seen it.
    """


@dataclass
class Result:
    """One agent decision, with everything the report needs to explain it."""
    output: dict[str, Any]
    call: Call
    schema_errors: list[str]
    #: Exactly what was put in front of the model, kept so a reader of a run can see the
    #: question and not just the answer. Media is recorded by label and digest, never bytes.
    prompt: dict[str, Any] = field(default_factory=dict)

    @property
    def valid(self) -> bool:
        return not self.schema_errors


def describe(instruction: str, parts: list[Part]) -> dict[str, Any]:
    """The prompt in a form a person can read. Attachments are named and digested rather
    than inlined: a run artifact that carried image bytes would be unreadable and unversionable,
    and the digest is what the cassette key is built from anyway."""
    return {"instruction": instruction,
            "parts": [{"kind": "text", "text": p.text} if p.text is not None
                      else {"kind": "media", "label": p.label, "mime": p.mime_type,
                            "digest": p.digest()}
                      for p in parts]}


class Agent:
    """Base. Subclasses set `name`/`schema_name` and implement `parts`."""

    name: str = ""
    schema_name: str = ""
    #: Fields the contract marks conditionally required, checked by the agent's own rules.
    conditional: dict[str, Any] = {}

    def parts(self, case: dict[str, Any]) -> list[Part]:
        raise NotImplementedError

    # --- the shared machinery -------------------------------------------------------
    def instruction(self) -> str:
        return system_instruction(self.schema_name)

    def run(self, case: dict[str, Any], *, live: bool = False, temperature: float = 0.0,
            model: str | None = None) -> Result:
        instruction, parts = self.instruction(), self.parts(case)
        call = generate_json(instruction, parts, response_schema(self.schema_name),
                             temperature=temperature, live=live,
                             **({"model": model} if model else {}))
        return Result(output=call.output, call=call,
                      schema_errors=self.validate(call.output, case),
                      prompt=describe(instruction, parts))

    def validate(self, output: dict[str, Any],
                 case: dict[str, Any] | None = None) -> list[str]:
        """Structural conformance, before anything is asked about the answer's content.

        `case` is optional so a test can validate a bare answer, and passed by `run` so the
        rules that need the QUESTION as well as the answer can fire.
        """
        validator = Draft202012Validator(validation_schema(self.schema_name))
        errors = [f"{'.'.join(str(p) for p in e.path) or '<root>'}: {e.message}"
                  for e in validator.iter_errors(output)]
        for key in required_fields(self.schema_name):
            if key not in output:
                errors.append(f"{key}: required by the contract and absent")
        errors.extend(self.check_conditionals(output))
        if case is not None:
            errors.extend(self.check_conditionals_for_case(output, case))
        return errors

    def check_conditionals(self, output: dict[str, Any]) -> list[str]:
        """`nullable` cannot say "required when verdict is ADD_FIELD"; the contract says it
        in prose and each agent enforces it here. Vertex has no way to express it either,
        which is exactly why it is worth testing."""
        return []

    def check_conditionals_for_case(self, output: dict[str, Any],
                                    case: dict[str, Any]) -> list[str]:
        """The rules that need the QUESTION as well as the answer.

        Separate from `check_conditionals` because most agents do not need the case and should
        not have to accept it. The Inspector does: "observed is required to PASS a `matches`
        rule" is a statement about the field being judged, not about the verdict returned, and
        there is no way to say it from the answer alone.
        """
        return []

    # --- helpers for subclasses -----------------------------------------------------
    @staticmethod
    def text(body: str, label: str = "") -> Part:
        return Part(text=body.strip(), label=label)

    @staticmethod
    def media(ref: str, label: str = "") -> Part:
        """Evidence, by value from disk or by reference in Cloud Storage.

        The eval corpus names files under MEDIA_DIR. Production names `gs://` objects, which
        the model reads for itself. Both refuse an extension they cannot decode, because an
        Inspector handed something undecodable will confidently return a verdict anyway, and
        that answer would be recorded as though it had seen the evidence.
        """
        if ref.startswith("gs://"):
            mime = _MIME.get(Path(ref).suffix.lower())
            if mime is None:
                raise MediaMissing(f"{ref}: unsupported media type {Path(ref).suffix}")
            return Part(mime_type=mime, uri=ref, label=label or ref)

        path = (MEDIA_DIR / ref) if not Path(ref).is_absolute() else Path(ref)
        if not path.exists():
            raise MediaMissing(f"{ref} is not in {MEDIA_DIR}; run evals/gen_media.py")
        mime = _MIME.get(path.suffix.lower())
        if mime is None:
            raise MediaMissing(f"{ref}: unsupported media type {path.suffix}")
        return Part(mime_type=mime, data=path.read_bytes(), label=label or ref)

    @staticmethod
    def block(title: str, body: dict[str, Any] | list[Any] | str) -> str:
        """A labelled section of the situation. Plain prose beats JSON for the model, but
        structured facts stay structured — a field definition read as a sentence loses the
        distinction between what was asked for and what came back."""
        if isinstance(body, str):
            return f"## {title}\n{body.strip()}"
        import json as _json
        return f"## {title}\n{_json.dumps(body, indent=2)}"
