"""Warrant's agents.

Five, and the line between them is the same line drawn everywhere else in this system:
a model is used where judgement is genuinely required and nowhere else. The seal, the gate
and the ledger are deterministic and are not in here.
"""
from .base import Agent, MediaMissing, Result
from .foreman import Foreman
from .inspector import Inspector
from .instructor import Instructor
from .scoper import Scoper
from .skeptic import Skeptic

REGISTRY: dict[str, type[Agent]] = {
    a.name: a for a in (Inspector, Skeptic, Instructor, Foreman, Scoper)
}

__all__ = ["Agent", "Result", "MediaMissing", "REGISTRY",
           "Inspector", "Skeptic", "Instructor", "Foreman", "Scoper"]
