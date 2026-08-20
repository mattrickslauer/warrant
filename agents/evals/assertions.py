"""What a scenario is allowed to claim about an answer.

Deliberately small, and deliberately not exact-match. Asserting the whole object would
make every scenario fail the first time a rationale is reworded, and the suite would be
abandoned within a day. What a scenario pins is the part that decides something: the
verdict, the fields that must accompany it, and — where it matters — that the reasoning
actually cites the thing that should have decided it, rather than arriving at the right
answer for no reason.

Every operator is negatable in some form, because "must not PASS" is more often the real
requirement than "must ESCALATE": there are two acceptable ways to refuse.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

MISSING = object()


@dataclass
class Check:
    op: str
    path: str
    ok: bool
    detail: str

    def __str__(self) -> str:
        return f"{'ok ' if self.ok else 'FAIL'} {self.op}({self.path}) {self.detail}"


def resolve(obj: Any, path: str) -> Any:
    """Dotted path into the answer. `draft.steps.0.title` works."""
    cur = obj
    for seg in path.split("."):
        if isinstance(cur, list):
            if not seg.isdigit() or int(seg) >= len(cur):
                return MISSING
            cur = cur[int(seg)]
        elif isinstance(cur, dict):
            if seg not in cur:
                return MISSING
            cur = cur[seg]
        else:
            return MISSING
    return cur


def _shown(v: Any) -> str:
    if v is MISSING:
        return "<absent>"
    s = str(v)
    return s if len(s) <= 90 else s[:87] + "..."


def _text_of(v: Any) -> str:
    """Assertions about wording read arrays and objects as their flattened text, so
    `mentions_any` works on `unresolved` as naturally as on `rationale`."""
    if v is MISSING or v is None:
        return ""
    if isinstance(v, (list, tuple)):
        return " ".join(_text_of(x) for x in v)
    if isinstance(v, dict):
        return " ".join(_text_of(x) for x in v.values())
    return str(v)


# --- the operators ------------------------------------------------------------------
def _equals(v, want):   return v == want, f"is {_shown(v)}, want {_shown(want)}"
def _not_equals(v, w):  return v != w, f"is {_shown(v)}, must not be {_shown(w)}"
def _in(v, opts):       return v in opts, f"is {_shown(v)}, want one of {opts}"
def _not_in(v, opts):   return v not in opts, f"is {_shown(v)}, must not be one of {opts}"
def _gte(v, n):         return isinstance(v, (int, float)) and v >= n, f"is {_shown(v)}, want >= {n}"
def _lte(v, n):         return isinstance(v, (int, float)) and v <= n, f"is {_shown(v)}, want <= {n}"


def _present(v, _):
    ok = v is not MISSING and v is not None and v != "" and v != []
    return ok, f"is {_shown(v)}"


def _absent(v, _):
    ok = v is MISSING or v is None or v == "" or v == []
    return ok, f"is {_shown(v)}"


def _is_true(v, _):     return v is True, f"is {_shown(v)}"
def _is_false(v, _):    return v is False, f"is {_shown(v)}"


def _mentions_any(v, needles):
    hay = _text_of(v).lower()
    hit = [n for n in needles if n.lower() in hay]
    return bool(hit), (f"found {hit}" if hit else f"none of {needles} in {_shown(_text_of(v))}")


def _mentions_all(v, needles):
    hay = _text_of(v).lower()
    miss = [n for n in needles if n.lower() not in hay]
    return not miss, (f"missing {miss}" if miss else "all present")


def _mentions_none(v, needles):
    hay = _text_of(v).lower()
    hit = [n for n in needles if n.lower() in hay]
    return not hit, (f"found {hit} and should not have" if hit else "none present")


def _matches(v, pattern):
    ok = bool(re.search(pattern, _text_of(v), re.I))
    return ok, f"{'matched' if ok else 'did not match'} /{pattern}/ in {_shown(_text_of(v))}"


def _min_words(v, n):
    c = len(_text_of(v).split())
    return c >= n, f"{c} words, want >= {n}"


def _max_words(v, n):
    c = len(_text_of(v).split())
    return c <= n, f"{c} words, want <= {n}"


def _len_gte(v, n):
    c = len(v) if isinstance(v, (list, dict, str)) else 0
    return c >= n, f"length {c}, want >= {n}"


def _len_lte(v, n):
    c = len(v) if isinstance(v, (list, dict, str)) else 0
    return c <= n, f"length {c}, want <= {n}"


#: op -> (function, takes an argument per path)
OPS = {
    "equals": (_equals, True), "not_equals": (_not_equals, True),
    "in": (_in, True), "not_in": (_not_in, True),
    "gte": (_gte, True), "lte": (_lte, True),
    "present": (_present, False), "absent": (_absent, False),
    "is_true": (_is_true, False), "is_false": (_is_false, False),
    "mentions_any": (_mentions_any, True), "mentions_all": (_mentions_all, True),
    "mentions_none": (_mentions_none, True), "matches": (_matches, True),
    "min_words": (_min_words, True), "max_words": (_max_words, True),
    "len_gte": (_len_gte, True), "len_lte": (_len_lte, True),
}


class BadAssertion(ValueError):
    """A scenario file asks for an operator that does not exist. Fails loudly at load,
    not silently at run — a typo'd operator that quietly passes is worse than no test."""


def evaluate(output: dict[str, Any], expect: dict[str, Any]) -> list[Check]:
    checks: list[Check] = []
    for op, spec in expect.items():
        if op not in OPS:
            raise BadAssertion(f"unknown operator {op!r}; have: {', '.join(sorted(OPS))}")
        fn, takes_arg = OPS[op]
        if takes_arg:
            if not isinstance(spec, dict):
                raise BadAssertion(f"{op} takes a mapping of path -> expected, got {type(spec).__name__}")
            for path, want in spec.items():
                ok, detail = fn(resolve(output, path), want)
                checks.append(Check(op, path, ok, detail))
        else:
            paths = spec if isinstance(spec, list) else [spec]
            for path in paths:
                ok, detail = fn(resolve(output, path), None)
                checks.append(Check(op, path, ok, detail))
    return checks


def validate_expect(expect: dict[str, Any]) -> list[str]:
    """Load-time check so a malformed scenario is caught before any model is called."""
    problems = []
    for op, spec in expect.items():
        if op not in OPS:
            problems.append(f"unknown operator {op!r}")
            continue
        _, takes_arg = OPS[op]
        if takes_arg and not isinstance(spec, dict):
            problems.append(f"{op} needs a mapping of path -> expected")
        if not takes_arg and not isinstance(spec, (list, str)):
            problems.append(f"{op} needs a path or list of paths")
    return problems
