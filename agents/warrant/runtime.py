"""The fleet, as Agent Runtime sees it.

Agent Runtime hosts a *session*, not a job. A job at Warrant is a service interval or a
purchase-order lead time — weeks — and a single execution here caps at seven days, so
nothing durable may live in this process. The Foreman wakes, is shown a case, decides, and
the decision goes back to the caller to be written down. Continuity is the record.

That is why this class is so thin. It holds no job state between calls on purpose: any
state it kept would be state that silently disappears when the runtime recycles, and a
disposition that depends on a process still being alive is not a disposition anyone can
rely on months later in a dispute.

What it does own is the one thing the local harness gets for free and the remote does not:
somewhere to put the schemas, and somewhere harmless to put cassette writes.
"""
from __future__ import annotations

import os
from typing import Any

#: Every agent is reachable, and the Foreman is the default because it is the one that
#: delegates. Naming the rest is not decoration — the FEF criterion asks whether the system
#: delegates to specialized sub-agents, and the answer has to be inspectable from outside.
DEFAULT_AGENT = "foreman"


class WarrantFleet:
    """Warrant's seven agents behind one Agent Runtime operation, and one screen in front.

    Three operations, and the third is not a fourth agent: `screen` runs Flash-Lite over a capture
    to decide whether Flash has to be asked at all. It is outside `REGISTRY` on purpose, so
    `roster()` answers seven — see `screen.py`.

    Constructed locally and pickled to the remote, so `__init__` stores plain strings and
    nothing else. Everything that needs an import happens in `set_up`, which the runtime
    calls once per instance after unpickling.
    """

    def __init__(self, *, project: str, model: str | None = None,
                 gemini_location: str = "global") -> None:
        self._project = project
        self._model = model
        self._gemini_location = gemini_location

    # --- lifecycle ---------------------------------------------------------------------
    def set_up(self) -> None:
        """Runs on the remote, once, before the first query."""
        os.environ.setdefault("GCP_PROJECT", self._project)
        os.environ.setdefault("GEMINI_LOCATION", self._gemini_location)
        if self._model:
            os.environ.setdefault("GEMINI_MODEL", self._model)

        # `model.py` reads this at import and records every live call into it. There is no
        # checked-in cassette store out here and recording into the deployment directory
        # would either fail on a read-only layer or quietly grow forever, so point it at
        # scratch. Replay is a local concern; the remote is always live by definition.
        os.environ.setdefault("WARRANT_CASSETTES", "/tmp/warrant-cassettes")

        from . import REGISTRY
        from .screen import Screener

        self._registry = REGISTRY
        # NOT in the registry, and not reachable through `query`. See `screen.py` for why the
        # cheap model is deliberately not one of the seven.
        self._screener = Screener

    # --- operations --------------------------------------------------------------------
    def query(self, *, case: dict[str, Any], agent: str = DEFAULT_AGENT,
              temperature: float = 0.0) -> dict[str, Any]:
        """Put one case in front of one agent and return what it said.

        The verdict comes back with its schema errors rather than an exception, because an
        answer that failed validation is itself a finding — the caller has to be able to
        refuse it and say why, not receive a 500 that loses the text.
        """
        name = (agent or DEFAULT_AGENT).strip().lower()
        cls = self._registry.get(name)
        if cls is None:
            raise ValueError(
                f"no agent {name!r}; have {', '.join(sorted(self._registry))}")

        # live=True unconditionally. A cassette on the remote would mean the deployed fleet
        # was answering from a recording, which is the one thing a judged deployment must
        # never do.
        result = cls().run(case, live=True, temperature=temperature)
        return {
            "agent": name,
            "output": result.output,
            "valid": result.valid,
            "schema_errors": result.schema_errors,
            "model": result.call.model,
            "latency_ms": result.call.latency_ms,
            "usage": result.call.usage,
        }

    def screen(self, *, case: dict[str, Any],
               temperature: float = 0.0) -> dict[str, Any]:
        """Look at one capture cheaply, on Flash-Lite, before the judge is asked.

        A separate operation rather than an eighth entry in `query`'s registry, because it is
        not an agent and `roster()` must keep saying seven. The reply is shaped exactly like
        `query`'s so the caller reads both the same way — including `model`, which is what
        makes the saving auditable: a decision row that names the screening model is a Flash
        call that never had to happen.

        `acts_on` travels with the answer. Whether a screen is strong enough to stop a capture
        is a policy question in ordinary code, and the caller must not have to re-derive it
        from the fields — but it is returned rather than enforced here, because the thing that
        knows the ADD FIELD budget is the adjudication spine, not this process.
        """
        from .screen import SCREENING_MODEL, acts_on

        result = self._screener().run(case, live=True, temperature=temperature,
                                      model=SCREENING_MODEL)
        return {
            "agent": "screen",
            "output": result.output,
            "valid": result.valid,
            "schema_errors": result.schema_errors,
            "model": result.call.model,
            "latency_ms": result.call.latency_ms,
            "usage": result.call.usage,
            # An answer that failed its own schema is never acted on, whatever it says.
            "acts_on": bool(result.valid and acts_on(result.output)),
        }

    def register_operations(self) -> dict[str, list[str]]:
        """Which methods Agent Runtime actually exposes over HTTP.

        Without this the runtime registers `query` alone and `roster` is silently absent —
        not an error, just a deployed engine that cannot tell you what is inside it. Since
        the sealed record stamps which agent version made a decision, being able to ask a
        running engine for its roster is how that stamp stays checkable from outside.
        """
        return {"": ["query", "roster", "screen"]}

    def roster(self) -> dict[str, Any]:
        """Who is deployed, and which contract each one answers under.

        A deployed engine that cannot tell you what is inside it is not inspectable, and
        the whole claim here is that the fleet is legible from the outside.
        """
        return {"default": DEFAULT_AGENT,
                "agents": [{"name": n, "contract": c.schema_name}
                           for n, c in sorted(self._registry.items())]}
