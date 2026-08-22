"""Warrant's agents.

Seven, and the line between them is the same line drawn everywhere else in this system:
a model is used where judgement is genuinely required and nowhere else. The seal, the gate
and the ledger are deterministic and are not in here.

Six of them judge something and return a verdict a person can argue with. Wright is the
exception, and the reason it is held to a stricter standard: it returns a driver, and a driver
that is wrong mints wrong measurements unattended until somebody notices.
"""
from .auditor import Auditor
from .base import Agent, MediaMissing, Result
from .foreman import Foreman
from .inspector import Inspector
from .instructor import Instructor
from .scoper import Scoper
from .skeptic import Skeptic
from .wright import Wright

REGISTRY: dict[str, type[Agent]] = {
    a.name: a for a in (Inspector, Skeptic, Instructor, Foreman, Scoper, Auditor, Wright)
}

__all__ = ["Agent", "Result", "MediaMissing", "REGISTRY",
           "Inspector", "Skeptic", "Instructor", "Foreman", "Scoper", "Auditor", "Wright"]
