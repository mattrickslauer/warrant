#!/usr/bin/env python3
"""Cut two takes against their claps and stand them side by side.

The alignment is the whole point. Both files are trimmed by their OWN clap rather than by a
shared start time, so whatever each recorder spent warming up is discarded and the two run
on one clock from the first composited frame.

§9 stacks the phone against the operator view: the seal on one side and the five
departments firing on the other, in one take. §10 shot 37 stacks two web takes — the brake
procedure against the foil procedure — which is the same machinery with a different pair of
inputs, and is why neither pane is assumed to be a phone.

Panes are sized from what they actually are. A portrait phone forced into half of a 16:9
frame is 470 pixels of content and 490 of black either side; `fit` gives each pane width in
proportion to its own aspect ratio so the frame is full and nothing is stretched.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import clap

FRAME = (1920, 1080)
RULE_PX = 2
RULE_COLOUR = "0x2A2A2A"


@dataclass(frozen=True)
class Source:
    """One pane: a recording and the kind of marker it opens with."""
    path: Path
    clap_kind: str          # "flash" (web) | "launch" (phone)
    label: str = ""

    def find_clap(self) -> clap.Clap:
        finder = clap.find_flash if self.clap_kind == "flash" else clap.find_launch
        return finder(str(self.path))


def _even(n: float) -> int:
    """h264 and prores both want even dimensions; odd ones fail at the filter graph."""
    return max(2, int(round(n / 2)) * 2)


def probe(path: Path) -> tuple[int, int, float]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    d = json.loads(out)
    s = d["streams"][0]
    return int(s["width"]), int(s["height"]), float(d["format"]["duration"])


def _panes(l: tuple[int, int], r: tuple[int, int], frame: tuple[int, int],
           layout: str, rule_px: int) -> tuple[tuple[int, int], tuple[int, int]]:
    """Width and height for each pane, filling the frame without distorting either."""
    W, H = frame
    usable = W - rule_px

    if layout == "equal":
        half = _even(usable / 2)
        return (half, H), (usable - half, H)

    nat_l, nat_r = H * (l[0] / l[1]), H * (r[0] / r[1])
    scale = usable / (nat_l + nat_r)
    ph = _even(min(H, H * scale))
    pw_l = _even(nat_l * scale)
    return (pw_l, ph), (usable - pw_l, ph)


def compose(
    left: Source,
    right: Source,
    out: Path,
    *,
    seconds: float | None = None,
    lead: float = (clap.FLASH_TOTAL_MS / 1000.0) + 0.35,
    frame: tuple[int, int] = FRAME,
    layout: str = "fit",
    rule: bool = True,
    log=print,
) -> Path:
    """Trim each source by its own clap, stack them, write `out`.

    `lead` is how long after the clap the composite begins. It must outlast the pulse
    train itself, or the finished cut opens on the marker rather than on the shot.
    """
    lc, rc = left.find_clap(), right.find_clap()
    log(f"  left  {left.path.name}: {lc}")
    log(f"  right {right.path.name}: {rc}")
    for side, c in (("left", lc), ("right", rc)):
        if c.confidence < 0.35:
            log(f"  ⚠  the {side} clap is ambiguous — eyeball the first second of the cut "
                f"before trusting the sync")

    lw, lh, ldur = probe(left.path)
    rw, rh, rdur = probe(right.path)
    l_from, r_from = lc.seconds + lead, rc.seconds + lead

    have = min(ldur - l_from, rdur - r_from)
    if have <= 0:
        raise RuntimeError("one of the takes ends before its clap — nothing to compose")
    run = min(seconds, have) if seconds else have
    if seconds and have < seconds - 0.05:
        log(f"  ⚠  asked for {seconds:g}s but only {have:.1f}s is aligned in both takes")

    W, H = frame
    rule_px = RULE_PX if rule else 0
    (lpw, lph), (rpw, rph) = _panes((lw, lh), (rw, rh), frame, layout, rule_px)
    log(f"  panes {lpw}×{lph} | {rpw}×{rph} in {W}×{H} ({layout})")

    def pane(w: int, h: int) -> str:
        return (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1")

    parts = [f"[0:v]{pane(lpw, lph)}[L]", f"[1:v]{pane(rpw, rph)}[R]"]
    if rule:
        parts.append(f"color=c={RULE_COLOUR}:s={rule_px}x{H}:d={run:.3f},setsar=1[bar]")
        parts.append("[L][bar][R]hstack=inputs=3[v]")
    else:
        parts.append("[L][R]hstack=inputs=2[v]")

    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{l_from:.3f}", "-i", str(left.path),
        "-ss", f"{r_from:.3f}", "-i", str(right.path),
        "-filter_complex", ";".join(parts), "-map", "[v]", "-t", f"{run:.3f}",
        # ProRes, not h264: this is an intermediate going into an edit, and a lossy one
        # throws away detail the grade still needs.
        "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
        "-r", "30", str(out),
    ], check=True)
    log(f"  wrote {out} — {run:.1f}s at {W}×{H}")
    return out


def from_manifest(take_dir: Path, out: Path | None = None, **kw) -> Path:
    """Compose a take recorded by take.py, which wrote down what each file is."""
    m = json.loads((take_dir / "take.json").read_text())
    sides = []
    for key in ("left", "right"):
        p = m[key]
        sides.append(Source(take_dir / p["file"], p["clap"], p.get("label", "")))
    # An explicit seconds= from the caller wins over what the take was shot for.
    kw.setdefault("seconds", m.get("seconds"))
    return compose(sides[0], sides[1], out or take_dir / "split.mov", **kw)
