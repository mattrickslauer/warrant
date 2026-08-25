#!/usr/bin/env python3
"""The takes, as data.

SCRIPT.md gives every section an in-point, an out-point and a length. This file is where
those numbers become something a machine can hit exactly, so re-timing a shot is editing a
number here rather than re-shooting until a hand moves on cue.

Only §9 and §10 are split takes. Everything else in the film is full frame and is shot the
way the shot list says — this harness has no opinion about those.

  §9   phone | operator view. The seal on one side and the five departments firing on the
       other, in one 40s take with no cuts, which is what shot 33 asks for and is the only
       thing in the submission a competitor cannot fake.
  §10  two web takes: the brake procedure against the foil procedure. That is shot 37, and
       it is why neither pane in this harness is assumed to be a phone.

`Hands(...)` marks the seconds a person is doing something to the machine. The harness will
not pretend to perform those — it prints what is needed, waits exactly that long, and moves
on. Every second of a take is therefore either automated or named.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Sequence

import phone as P
import web as W

RULE_PX = 2


def _even(n: float) -> int:
    return max(2, int(round(n / 2)) * 2)


@dataclass(frozen=True)
class Pane:
    kind: str                 # "web" | "phone"
    label: str
    beats: Sequence[object]
    open_at: str = "/"        # web only
    footage: str | None = None  # web only — a clip name from footage.py's WANTED or REELS
    aspect: float | None = None  # web only — force this pane's shape (w/h), e.g. 9/16
    width: int = 0            # filled in by Take.sized_for
    height: int = 0

    @property
    def slug(self) -> str:
        return self.label.lower().replace(" ", "-")


@dataclass(frozen=True)
class Take:
    key: str
    section: str
    title: str
    seconds: float
    left: Pane
    right: Pane

    @property
    def needs_phone(self) -> bool:
        return any(p.kind == "phone" for p in (self.left, self.right))

    def sized_for(self, phone_px: tuple[int, int], frame: tuple[int, int]) -> "Take":
        """Give every web pane the exact pixel size it will occupy in the finished frame.

        Recording the browser at the pane's real width means its text is never resampled on
        the way into the composite — the one thing that makes a screen recording look like a
        screen recording.
        """
        W_, H_ = frame
        usable = W_ - RULE_PX
        sides = [self.left, self.right]

        if all(p.kind == "web" for p in sides):
            # A pane that declares an aspect is a surface with a real shape — the technician's
            # view is a phone and looks wrong at any other ratio. It takes its natural width
            # and the other pane gets the rest, which is how §9 works with a real handset and
            # is the same arithmetic here without one.
            shaped = [p.aspect for p in sides]
            if shaped[0] and not shaped[1]:
                lw = _even(H_ * shaped[0])
            elif shaped[1] and not shaped[0]:
                lw = usable - _even(H_ * shaped[1])
            elif shaped[0] and shaped[1]:
                lw = _even(usable * shaped[0] / (shaped[0] + shaped[1]))
            else:
                lw = _even(usable / 2)
            sized = [replace(sides[0], width=lw, height=H_),
                     replace(sides[1], width=usable - lw, height=H_)]
        else:
            pw, ph = phone_px
            phone_w = _even(H_ * pw / ph)
            sized = [replace(p, width=usable - phone_w, height=H_) if p.kind == "web" else p
                     for p in sides]
        return replace(self, left=sized[0], right=sized[1])


# ─── §9 · THE CHAIN ──────────────────────────────────────────────────────────────────
#
# "UNEDITED. ONE TAKE. NO CUTS. 40 seconds." — so there is exactly one Dwell budget here
# and it sums to 40. Do not add a beat without taking the seconds out of another one.
#
# The phone taps are authored from `./take.py probe`, which prints every labelled node on
# the current screen with its centre. Re-probe after any layout change rather than nudging
# coordinates: a tap that lands two pixels off a Compose card is a take you cannot use.
#
# Every label below was read off the running app, not guessed. `Cut a banana` is the card
# this was proved against — swap it for the procedure actually being filmed and re-probe,
# because the carousel snaps and a card that is off-screen cannot be tapped by name.

CHAIN_PHONE = (
    P.Dwell(2.5, "the home screen settles after the cold start"),
    P.Tap("Cut a banana"),                  # ← the procedure being filmed, by its card text
    P.WaitText("Step 1"),
    P.Hands(4.0, "frame the work for step 1"),
    P.Tap("Capture"),
    P.Dwell(4.0, "INSPECTOR and SKEPTIC land on it"),
    # The step does not advance itself. It settles — "Verification is running behind you" —
    # and the technician moves on, which is the whole point of the product and is worth
    # having on camera rather than editing around.
    P.WaitText("Next step", timeout=30.0),
    P.Tap("Next step"),
    # And the fleet is allowed to branch: a capture the Inspector wants more from raises a
    # field instead of advancing. Both are the product working; neither ends the take.
    P.WaitAny(("Step 2", "One more thing needed")),
    P.Hands(4.0, "frame the work for step 2"),
    P.Tap("Capture"),
    P.Dwell(4.0, "the gate resolves"),
    P.Hands(3.0, "the last step cannot be done — say why, out loud"),
    P.Tap("Can't do this step"),
    P.Dwell(5.0, "the reason goes in and the record seals"),
    P.Dwell(10.0, "let it run silent — the sweep, the Instructor, the Foreman"),
)

CHAIN_WEB = (
    W.WaitFor(".fleet__entry", "the operator view has decisions in it"),
    W.Dwell(3.0, "hold the headline count before anything arrives"),
    W.Scroll(420, over=2.0),
    W.Dwell(4.0, "who ruled — the seven agents, named"),
    W.Scroll(520, over=2.0),
    W.Dwell(5.0, "which models, and what they cost"),
    W.Scroll(600, over=2.5),
    W.Dwell(6.0, "what they said — verbatim reasons"),
    W.Scroll(700, over=3.0),
    W.Dwell(13.5, "the log, filling. Five departments, one take"),
)

# ─── §10 · A SECOND COMPANY ──────────────────────────────────────────────────────────
#
# Shot 37: the two procedures side by side. Left is the brake service — a measured field, a
# paired instrument, tier `instrumented`. Right is the foil — photographs, a tag, tier
# `open`. Same seven agents named down the side of both.
#
# Deliberately NOT a phone take. §10's argument is that the same fleet compiles a different
# SHAPE of procedure, and that argument lives on the procedure pages.

SECOND_COMPANY_LEFT = (
    W.Dwell(2.5, "the brake service, whole"),
    W.Scroll(500, over=2.5),
    W.Dwell(5.0, "the measured field and the paired instrument"),
    W.Scroll(500, over=2.5),
    W.Dwell(15.5, "tier `instrumented`, and the agents down the side"),
)

SECOND_COMPANY_RIGHT = (
    W.Dwell(2.5, "his, whole — and it is a different shape"),
    W.Scroll(500, over=2.5),
    W.Dwell(5.0, "photographs, choices, a tag. Not one number in it"),
    W.Scroll(500, over=2.5),
    W.Dwell(15.5, "tier `open`, earned rather than assigned"),
)

# ─── the funnel — the take that shows the product doing its job ──────────────────────
#
# A job from the picker to a sealed record, on one side, while the operator view fills with
# the decisions that job is producing on the other. No hardware, and nothing scripted: the
# capture is the app's own live camera with a real photograph of real work in front of it,
# and the verdicts are the deployed fleet ruling on that photograph.
#
# `pickup-two-step` is a REEL rather than a still: it shows the object on the bench for the
# first twenty seconds and in a hand after that, because the procedure asks for two different
# photographs and one image would make the Skeptic dissent for a reason about the harness
# rather than about the evidence.

FUNNEL_TECHNICIAN = (
    W.Dwell(2.0, "the picker — five tasks, no account, no install"),
    W.Click('.card[data-i="1"]'),
    W.Dwell(1.5, "Pick up an object — two steps, two photographs"),
    W.Click(".cta__go"),
    W.WaitFor(".w-capture--live", "a LIVE camera, not an upload", timeout=90.0),
    W.Dwell(3.5, "the step, its acceptance rule, and the viewfinder"),
    W.Click(".w-capture__shutter"),
    W.Dwell(9.0, "INSPECTOR and SKEPTIC rule on the photograph"),
    W.Click(".w-capture__shutter"),
    W.Dwell(9.0, "the second step, and the object is now in a hand"),
    W.Dwell(10.0, "the gate resolves and the record seals"),
)

FUNNEL_OPERATOR = (
    W.WaitFor(".fleet__entry", "the operator view has decisions in it"),
    W.Dwell(4.0, "what the fleet has decided, before this job touches it"),
    W.Scroll(700, over=2.5),
    W.Dwell(5.0, "who ruled, and what it cost"),
    W.Scroll(900, over=3.0),
    W.Dwell(23.5, "the log — the rows this job is making, as it makes them"),
)


# ─── the harness proving itself ──────────────────────────────────────────────────────
#
# Two web panes and no hardware, so the clap, the alignment and the stack can be checked on
# any machine in twenty seconds. If this take composes cleanly the harness is working and
# anything that then fails is the shot, not the tooling.

# The phone half of the same idea: a take that needs no hands, so scrcpy, the cold-start
# clap, the adb driving and the alignment against a web pane can all be proved on real
# hardware before a shot depends on them. Every label here came from `./take.py probe`.

PHONE_SMOKE = (
    P.Dwell(2.5, "the home screen settles after the cold start"),
    P.Tap("Cut a banana"),
    P.WaitText("Step 1"),
    P.Dwell(2.5, "the step, its acceptance rule, and the live viewfinder"),
    P.Tap("Capture"),
    P.Dwell(6.0, "the fleet rules on it"),
)

PHONE_SMOKE_WEB = (
    W.WaitFor(".fleet__entry", "the operator view rendered"),
    W.Dwell(3.0),
    W.Scroll(700, over=2.5),
    W.Dwell(6.0),
)

SMOKE_LEFT = (
    W.WaitFor(".fleet__entry", "the operator view rendered"),
    W.Dwell(2.0),
    W.Scroll(600, over=2.0),
    W.Dwell(4.0),
)

SMOKE_RIGHT = (
    W.Dwell(2.0),
    W.Scroll(400, over=2.0),
    W.Dwell(4.0),
)


def planned_seconds(pane: Pane) -> float | None:
    """What a pane's beats add up to, where that is knowable before shooting.

    Only the beats that spend a fixed amount of time count. A tap or a wait takes as long
    as the app takes, so a pane containing them has no predictable length and says None
    rather than a number that would be wrong.
    """
    total = 0.0
    for beat in pane.beats:
        if isinstance(beat, (W.Dwell, P.Dwell, P.Hands)):
            total += beat.seconds
        elif isinstance(beat, W.Scroll):
            total += beat.over
        else:
            return None
    return total


TAKES: dict[str, Take] = {
    "9": Take(
        key="9", section="§9", title="The chain — unedited, one take", seconds=40.0,
        left=Pane("phone", "phone", CHAIN_PHONE),
        right=Pane("web", "operator", CHAIN_WEB, open_at="/fleet"),
    ),
    "10": Take(
        key="10", section="§10", title="A second company — the two procedures", seconds=28.0,
        left=Pane("web", "brake", SECOND_COMPANY_LEFT, open_at="/library"),
        right=Pane("web", "foil", SECOND_COMPANY_RIGHT, open_at="/library"),
    ),
    "phone-smoke": Take(
        key="phone-smoke", section="—", title="Harness self-check on real hardware",
        seconds=13.0,
        left=Pane("phone", "phone", PHONE_SMOKE),
        right=Pane("web", "operator", PHONE_SMOKE_WEB, open_at="/fleet"),
    ),
    "funnel": Take(
        key="funnel", section="—", title="A job end to end, beside the fleet deciding it",
        seconds=38.0,
        left=Pane("web", "technician", FUNNEL_TECHNICIAN, open_at="/",
                  footage="pickup-two-step", aspect=9 / 16),
        right=Pane("web", "operator", FUNNEL_OPERATOR, open_at="/fleet"),
    ),
    "smoke": Take(
        key="smoke", section="—", title="Harness self-check, no hardware", seconds=8.0,
        left=Pane("web", "fleet", SMOKE_LEFT, open_at="/fleet"),
        right=Pane("web", "home", SMOKE_RIGHT, open_at="/"),
    ),
}
