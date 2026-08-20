"""The contract is sent to Vertex and used to validate the reply. Both have to be right."""
import json

import pytest
from jsonschema import Draft202012Validator

from warrant import REGISTRY
from warrant.contract import (AGENTS_DIR, agent_schema, response_schema,
                              system_instruction, validation_schema)

NAMES = sorted(p.name.removesuffix(".schema.json") for p in AGENTS_DIR.glob("*.schema.json"))

VERTEX_BANNED = ("$ref", "oneOf", "anyOf", "allOf", "not", "additionalProperties",
                 "patternProperties", "if", "then", "else", "const", "$defs", "definitions")


def walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


def test_every_agent_has_a_schema_and_every_schema_has_an_agent():
    assert set(NAMES) == {a.schema_name for a in REGISTRY.values()}


@pytest.mark.parametrize("name", NAMES)
def test_response_schema_stays_inside_the_vertex_subset(name):
    # contract/check.mjs asserts this too. Duplicated here because the Python side is what
    # actually posts the request, and a divergence between the two is exactly the bug that
    # would otherwise be found on a live call.
    for node in walk(response_schema(name)):
        for banned in VERTEX_BANNED:
            assert banned not in node, f"{name}: {banned}"


@pytest.mark.parametrize("name", NAMES)
def test_validation_schema_accepts_null_on_every_nullable_field(name):
    schema = agent_schema(name)
    validator = Draft202012Validator(validation_schema(name))
    required = schema.get("required", [])
    for key, prop in schema["properties"].items():
        if not prop.get("nullable"):
            continue
        assert key not in required, f"{name}.{key} is both nullable and required"
        doc = {k: _sample(v) for k, v in schema["properties"].items() if k in required}
        doc[key] = None
        assert list(validator.iter_errors(doc)) == [], f"{name}.{key} rejected an allowed null"


@pytest.mark.parametrize("name", NAMES)
def test_system_instruction_carries_every_field_and_its_rule(name):
    text = system_instruction(name)
    assert agent_schema(name)["description"][:40] in text
    for key in agent_schema(name)["properties"]:
        assert key in text, f"{name}: the model is never told about {key}"


@pytest.mark.parametrize("name", NAMES)
def test_response_schema_is_json_serialisable_as_sent(name):
    json.dumps(response_schema(name))


def _sample(prop):
    if "enum" in prop:
        return prop["enum"][0]
    return {"string": "x", "number": 0.5, "integer": 1, "boolean": True,
            "array": [], "object": {}}.get(prop.get("type"), "x")
