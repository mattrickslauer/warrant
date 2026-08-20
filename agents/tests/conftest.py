import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from warrant import REGISTRY                                  # noqa: E402
from warrant.contract import response_schema, system_instruction  # noqa: E402
from warrant.model import _cache_key                          # noqa: E402
from warrant import model as model_mod                        # noqa: E402


@pytest.fixture
def cassettes(tmp_path, monkeypatch):
    """Point the cassette store at a temp dir so tests never read or write the real one."""
    d = tmp_path / "cassettes"
    d.mkdir()
    monkeypatch.setattr(model_mod, "CASSETTES", d)
    return d


@pytest.fixture
def seed(cassettes):
    """Pre-record an answer for a scenario, so the whole pipeline can run with no network.

    Computing the key through the agent's own prompt builder rather than hardcoding it means
    these tests break if the instruction assembly changes, which is the point: a silently
    changed prompt is a silently invalidated suite.
    """
    def _seed(case: dict, output: dict, *, temperature: float = 0.0):
        agent = REGISTRY[case["agent"]]()
        key = _cache_key(model_mod.DEFAULT_MODEL, system_instruction(agent.schema_name),
                         agent.parts(case["input"]), response_schema(agent.schema_name),
                         temperature)
        (cassettes / f"{key}.json").write_text(json.dumps({"model": "seeded", "output": output}))
        return key
    return _seed


@pytest.fixture
def scenarios():
    from evals.runner import load_scenarios
    return load_scenarios
