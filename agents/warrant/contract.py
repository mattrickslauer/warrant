"""The contract, loaded once.

`contract/agents/*.schema.json` is not documentation that happens to match the code. It is
sent to Vertex verbatim as `responseSchema`, and its `description` fields are sent verbatim
as the system instruction. There is exactly one statement of what an agent must return, and
both the model and the validator read it from the same file.

`contract/check.mjs` already guarantees these schemas stay inside the subset Vertex accepts,
so nothing here has to defend against `$ref` or `oneOf` appearing in an agent schema.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
AGENTS_DIR = ROOT / "contract" / "agents"
ENTITIES_DIR = ROOT / "contract" / "entities"


class ContractError(RuntimeError):
    """A schema is missing or malformed. Always a bug here, never a model failure."""


@lru_cache(maxsize=None)
def agent_schema(name: str) -> dict[str, Any]:
    """The response schema for one agent, e.g. `inspector-verdict`."""
    path = AGENTS_DIR / f"{name}.schema.json"
    if not path.exists():
        available = sorted(p.stem.removesuffix(".schema") for p in AGENTS_DIR.glob("*.schema.json"))
        raise ContractError(f"no agent schema {name!r} in {AGENTS_DIR} (have: {', '.join(available)})")
    return json.loads(path.read_text())


@lru_cache(maxsize=None)
def entity_schema(name: str) -> dict[str, Any]:
    path = ENTITIES_DIR / f"{name}.schema.json"
    if not path.exists():
        raise ContractError(f"no entity schema {name!r} in {ENTITIES_DIR}")
    return json.loads(path.read_text())


def response_schema(name: str) -> dict[str, Any]:
    """The schema as Vertex wants it: no title, no nullable-with-enum ambiguity.

    Vertex rejects `nullable` alongside `enum` on some paths, and `title` is noise in the
    request. Stripping happens here rather than in the contract file because the contract
    file is also read by TypeScript, where both are useful.
    """
    return _strip(agent_schema(name))


def _strip(node: Any) -> Any:
    if isinstance(node, list):
        return [_strip(n) for n in node]
    if not isinstance(node, dict):
        return node
    out: dict[str, Any] = {}
    for key, value in node.items():
        # A `properties` map's keys are field names, not schema keywords. Recursing into it
        # blindly deletes any field actually called `title` — a step's, say — while leaving
        # it in `required`, and Vertex rejects the whole request for a field that vanished.
        if key == "properties" and isinstance(value, dict):
            out[key] = {name: _strip(sub) for name, sub in value.items()}
        elif key != "title":
            out[key] = _strip(value)
    # An enum field that may be absent: Vertex wants the enum without the null union, and
    # absence is expressed by leaving it out of `required`, which it already is.
    if "enum" in out and out.get("nullable"):
        out.pop("nullable")
    return out


def system_instruction(name: str) -> str:
    """The schema's own prose, assembled into the agent's standing instruction.

    The top-level `description` states the agent's job. Each property `description` states
    what that field means and when it is required. Sending both means a field's rule cannot
    drift away from the prompt that asks for it — they are the same sentence.
    """
    schema = agent_schema(name)
    lines = [schema.get("description", "").strip(), "", "Return JSON with these fields:"]
    for key, prop in schema.get("properties", {}).items():
        desc = prop.get("description", "").strip()
        bits = []
        if "enum" in prop:
            bits.append("one of " + " | ".join(prop["enum"]))
        elif prop.get("type"):
            bits.append(prop["type"])
        if key in schema.get("required", []):
            bits.append("required")
        else:
            bits.append("null when it does not apply")
        head = f"- {key} ({', '.join(bits)})"
        lines.append(f"{head}: {desc}" if desc else head)
    return "\n".join(lines).strip()


def required_fields(name: str) -> list[str]:
    return list(agent_schema(name).get("required", []))


def validation_schema(name: str) -> dict[str, Any]:
    """The same schema, in the dialect `jsonschema` speaks.

    The contract files use OpenAPI's `nullable`, because that is what Vertex reads. Draft
    2020-12 expresses the same thing as a type union, and would otherwise reject the null
    an agent is explicitly told to send for an inapplicable field.
    """
    return _nullable_to_union(agent_schema(name))


def _nullable_to_union(node: Any) -> Any:
    if isinstance(node, list):
        return [_nullable_to_union(n) for n in node]
    if not isinstance(node, dict):
        return node
    out = {k: _nullable_to_union(v) for k, v in node.items() if k != "nullable"}
    if node.get("nullable") and isinstance(out.get("type"), str):
        out["type"] = [out["type"], "null"]
        # An enum on a nullable field has to admit the null it is allowed to be.
        if "enum" in out and None not in out["enum"]:
            out["enum"] = [*out["enum"], None]
    return out
