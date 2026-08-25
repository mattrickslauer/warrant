#!/usr/bin/env python3
"""The clapperboard — one instant both recordings can be cut against.

Two recorders start independently and neither can say when its first frame actually
landed. scrcpy reports nothing useful about it and Playwright's video begins whenever the
browser context does, so a split screen assembled from wall-clock start times drifts by up
to a second. In §9 that is the difference between the seal and the five departments firing
together, and one of them arriving late — in the one shot SCRIPT.md says must never be cut.

So every take opens with a marker, the way a crew claps before action, and the marker is
found again by reading the recordings back rather than by trusting a start time.

  web    a full white frame painted from inside the page for 200ms. Unmistakable: the
         detector looks for a luma spike and nothing else in a dark UI can produce one.

  phone  the app cold-starting. Nothing is installed and the app is not modified — a
         force-stop and a relaunch is the largest scene change a phone screen can make,
         and adb issues it at an instant we know.

Both detectors return seconds into their own file. The compositor trims each stream by its
own offset and from there the two run on one clock.

If you ever want frame-exact rather than within-a-frame on the phone side, see
`--clap=flash` in README.md — it costs fifteen lines in MainActivity and upgrades the phone
to the same luma-spike detector the web uses. It is deliberately not the default, because a
recording harness should not require a product change to run.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass

# The clap is a PULSE TRAIN, not a single flash, and that is not decoration.
#
# A page paints white for a moment before the dark theme lands, so the head of a web take
# already contains a white span that looks exactly like a marker. The first version of this
# file aligned §9's smoke take against one of those and put the two panes 0.8s apart —
# which is the whole failure this module exists to prevent, arriving through the detector
# rather than through the recorder.
#
# Three evenly spaced pulses cannot be produced by a page load. The detector matches the
# rhythm, so an incidental white frame is not a candidate however bright it is.
FLASH_PULSES = 3
FLASH_ON_MS = 160
FLASH_OFF_MS = 160
FLASH_PERIOD_MS = FLASH_ON_MS + FLASH_OFF_MS
FLASH_TOTAL_MS = FLASH_PULSES * FLASH_PERIOD_MS

FLASH_FLOOR = 150.0     # a peak under this is not a white frame, it is a bright UI
FLASH_RATIO = 0.80      # fraction of the peak-to-floor swing that counts as "lit"
PERIOD_TOLERANCE = 0.10 # seconds of slack per gap, against a 0.32s period
SEARCH_WINDOW = 12.0    # only ever look for the clap in the head of a take


class ClapNotFound(RuntimeError):
    """The take has no usable marker, so it cannot be cut against another one."""


@dataclass(frozen=True)
class Clap:
    """Where the marker sits inside one recording."""
    seconds: float
    kind: str
    confidence: float

    def __str__(self) -> str:
        return f"{self.kind} clap at {self.seconds:.3f}s (confidence {self.confidence:.2f})"


# ─── emitting ────────────────────────────────────────────────────────────────────────

# Painted into the page itself rather than drawn over the browser, so it lands in
# Playwright's recording and not merely on a screen nobody is capturing.
WEB_FLASH_JS = """
async ([pulses, onMs, offMs]) => {
  const el = document.createElement('div');
  el.id = '__warrant_clap';
  el.style.cssText = [
    'position:fixed', 'inset:0', 'background:#fff', 'z-index:2147483647',
    'pointer-events:none', 'margin:0', 'opacity:0',
  ].join(';');
  document.documentElement.appendChild(el);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const started = performance.now();
  for (let i = 0; i < pulses; i += 1) {
    el.style.opacity = '1';
    await sleep(onMs);
    el.style.opacity = '0';
    await sleep(offMs);
  }
  el.remove();
  return started;
}
"""


def phone_clap(package: str, activity: str, serial: str | None = None) -> None:
    """Cold-start the app. The biggest scene change a phone screen can make, on cue."""
    head = ["adb"] + (["-s", serial] if serial else [])
    subprocess.run([*head, "shell", "am", "force-stop", package], check=True)
    subprocess.run(
        [*head, "shell", "am", "start", "-S", "-n", f"{package}/{activity}"],
        check=True, capture_output=True,
    )


# ─── finding it again ────────────────────────────────────────────────────────────────

def _metadata(path: str, vf: str, key: str, window: float) -> list[tuple[float, float]]:
    """Run one ffmpeg metadata pass over the head of a file and pair times with values."""
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-t", str(window), "-i", path,
         "-vf", f"{vf},metadata=print:key={key}:file=-", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stdout

    samples: list[tuple[float, float]] = []
    now = 0.0
    for line in out.splitlines():
        if (m := re.search(r"pts_time:([0-9.]+)", line)):
            now = float(m.group(1))
        elif (m := re.search(rf"{re.escape(key)}=([0-9.]+)", line)):
            samples.append((now, float(m.group(1))))
    return samples


def _lit_spans(samples: list[tuple[float, float]], threshold: float) -> list[tuple[float, float]]:
    """Contiguous runs of frames at or above `threshold`, as (start, end) in seconds."""
    spans: list[tuple[float, float]] = []
    start: float | None = None
    previous = 0.0
    for t, y in samples:
        if y >= threshold and start is None:
            start = t
        elif y < threshold and start is not None:
            spans.append((start, previous))
            start = None
        previous = t
    if start is not None:
        spans.append((start, previous))
    return spans


def find_flash(path: str, window: float = SEARCH_WINDOW) -> Clap:
    """The web clap: the first run of evenly spaced white pulses.

    Matching the rhythm rather than the brightness is what keeps a page-load white frame
    from being mistaken for the marker.
    """
    samples = _metadata(path, "signalstats", "lavfi.signalstats.YAVG", window)
    if not samples:
        raise ClapNotFound(f"{path}: ffmpeg read no frames")

    peak = max(y for _, y in samples)
    floor = min(y for _, y in samples)
    if peak < FLASH_FLOOR:
        raise ClapNotFound(
            f"{path}: brightest frame in the first {window:g}s averages {peak:.0f}, "
            f"which is not a white flash. Was the take recorded without a clap?"
        )

    spans = _lit_spans(samples, floor + (peak - floor) * FLASH_RATIO)
    period = FLASH_PERIOD_MS / 1000.0

    for i in range(len(spans) - FLASH_PULSES + 1):
        run = spans[i:i + FLASH_PULSES]
        gaps = [b[0] - a[0] for a, b in zip(run, run[1:])]
        if all(abs(g - period) <= PERIOD_TOLERANCE for g in gaps):
            drift = max(abs(g - period) for g in gaps) if gaps else 0.0
            fit = 1.0 - (drift / PERIOD_TOLERANCE)
            swing = min(1.0, (peak - floor) / 255.0)
            return Clap(run[0][0], "flash", min(swing, fit))

    raise ClapNotFound(
        f"{path}: found {len(spans)} white span(s) in the first {window:g}s but no run of "
        f"{FLASH_PULSES} spaced {period:.2f}s apart. Either the take was recorded before "
        f"the pulse clap existed, or the browser dropped frames — re-shoot it."
    )


def find_launch(path: str, window: float = SEARCH_WINDOW) -> Clap:
    """The phone clap: the sharpest cut in the head of the take, which is the cold start."""
    samples = _metadata(path, "select='gt(scene,0)'", "lavfi.scene_score", window)
    if not samples:
        raise ClapNotFound(f"{path}: ffmpeg found no scene changes to clap against")

    at, score = max(samples, key=lambda s: s[1])
    runner_up = max((s for s in samples if abs(s[0] - at) > 0.5), key=lambda s: s[1],
                    default=(0.0, 0.0))[1]
    if score < 0.2:
        raise ClapNotFound(
            f"{path}: nothing in the first {window:g}s changes the screen enough to be a "
            f"cold start (best score {score:.2f})"
        )
    # Two comparable cuts means we may have picked the wrong one. Report it rather than
    # silently aligning the take half a second out.
    return Clap(at, "launch", 1.0 - (runner_up / score if score else 1.0))
