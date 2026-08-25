#!/usr/bin/env python3
"""Record a scripted take of the web surface.

The reason this exists rather than a screen recorder pointed at a browser: a take made of
explicit waits is repeatable. Run it fifty times and every one is the same length with the
same beat in the same second, so the budget table in SCRIPT.md can be met by editing a
number here instead of by re-shooting until a hand moves at the right moment.

It records headless, so it needs no compositor and no display — which is also why it can
run on a machine that is busy being filmed.

Beats are data. A shot that runs two seconds long is a two-character edit in beats.py.
"""
from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol, Sequence

import clap

# The same fakes smoke_funnel.py uses. The capture path in CaptureTile.tsx is real code
# either way — getUserMedia, a live stream, the same shutter — this only decides what is in
# front of the lens on a machine that has no camera.
CHROME_ARGS = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
]


def camera_args(footage: Path | None) -> list[str]:
    """Put a real photograph of real work in front of the app's camera.

    Without this the fake device is a rolling test pattern, which photographs as nothing and
    tells a judge nothing. With it the corpus in `agents/evals/media/` becomes the viewfinder
    and the agents rule on the same images the eval suite rules on.

    Build the clips with `./footage.py build-all`.
    """
    if footage is None:
        return list(CHROME_ARGS)
    if not footage.exists():
        raise FileNotFoundError(
            f"no footage at {footage} — build it with ./footage.py build-all"
        )
    return [*CHROME_ARGS, f"--use-file-for-fake-video-capture={footage}"]


class WebBeat(Protocol):
    """One instruction in a web take."""
    def apply(self, page) -> None: ...
    def describe(self) -> str: ...


@dataclass(frozen=True)
class Goto:
    path: str
    def apply(self, page) -> None:
        page.goto(page.context.base_url_hint + self.path, wait_until="load")
    def describe(self) -> str: return f"go to {self.path}"


@dataclass(frozen=True)
class Dwell:
    """Hold the frame. The only beat that exists purely to spend time, so it says why."""
    seconds: float
    because: str = ""
    def apply(self, page) -> None:
        page.wait_for_timeout(self.seconds * 1000)
    def describe(self) -> str:
        return f"hold {self.seconds:g}s" + (f" — {self.because}" if self.because else "")


@dataclass(frozen=True)
class WaitFor:
    selector: str
    because: str = ""
    timeout: float = 15.0
    def apply(self, page) -> None:
        page.wait_for_selector(self.selector, timeout=self.timeout * 1000)
    def describe(self) -> str:
        return f"wait for {self.selector}" + (f" — {self.because}" if self.because else "")


@dataclass(frozen=True)
class Click:
    selector: str
    def apply(self, page) -> None:
        page.locator(self.selector).first.click()
    def describe(self) -> str: return f"click {self.selector}"


@dataclass(frozen=True)
class Fill:
    selector: str
    text: str
    def apply(self, page) -> None:
        page.locator(self.selector).first.fill(self.text)
    def describe(self) -> str: return f"type {self.text!r} into {self.selector}"


@dataclass(frozen=True)
class Scroll:
    """Scroll smoothly rather than jumping — a cut that teleports reads as a glitch."""
    pixels: int
    over: float = 1.0
    selector: str = "window"
    def apply(self, page) -> None:
        target = ("window" if self.selector == "window"
                  else f"document.querySelector({self.selector!r})")
        page.evaluate(
            f"""async ([px, ms]) => {{
                const el = {target};
                const from = el === window ? window.scrollY : el.scrollTop;
                const t0 = performance.now();
                await new Promise(done => {{
                    const step = () => {{
                        const k = Math.min(1, (performance.now() - t0) / ms);
                        const eased = k < 0.5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;
                        const y = from + px * eased;
                        el === window ? window.scrollTo(0, y) : (el.scrollTop = y);
                        k < 1 ? requestAnimationFrame(step) : done();
                    }};
                    requestAnimationFrame(step);
                }});
            }}""",
            [self.pixels, self.over * 1000],
        )
    def describe(self) -> str: return f"scroll {self.pixels:+d}px over {self.over:g}s"


def record(
    *,
    base_url: str,
    beats: Sequence[WebBeat],
    out: Path,
    width: int,
    height: int,
    open_at: str = "/",
    footage: Path | None = None,
    on_clap: Callable[[], None] | None = None,
    log: Callable[[str], None] = print,
) -> Path:
    """Record one take to `out`, clapping once the caller says both recorders are rolling.

    `on_clap` is the barrier. take.py passes one that blocks until the phone is also
    recording, so the two markers are issued within a few milliseconds of each other and
    the alignment in post has something honest to work with.
    """
    from playwright.sync_api import sync_playwright

    scratch = out.parent / f".{out.stem}.raw"
    scratch.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(args=camera_args(footage))
        ctx = browser.new_context(
            viewport={"width": width, "height": height},
            record_video_dir=str(scratch),
            record_video_size={"width": width, "height": height},
            permissions=["camera"],
        )
        # Beats address the app by path; the context carries where that is.
        ctx.base_url_hint = base_url
        page = ctx.new_page()

        if footage:
            log(f"  camera · {footage.stem}")
        page.goto(base_url + open_at, wait_until="load")
        page.wait_for_timeout(400)

        if on_clap:
            on_clap()
        # Blocks for the whole pulse train — evaluate awaits the promise, so the beats
        # below cannot start until the marker is fully in the recording.
        page.evaluate(clap.WEB_FLASH_JS,
                      [clap.FLASH_PULSES, clap.FLASH_ON_MS, clap.FLASH_OFF_MS])
        log(f"  clap · {clap.FLASH_PULSES} pulses at {width}×{height}")

        video = page.video
        try:
            for i, beat in enumerate(beats, 1):
                log(f"  {i:>2}. {beat.describe()}")
                beat.apply(page)
        finally:
            # Closing the context is what finalises the file. A beat that raises must not
            # take the footage with it — everything up to the failure is still a take.
            ctx.close()
            browser.close()
        produced = Path(video.path())

    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(produced), str(out))
    shutil.rmtree(scratch, ignore_errors=True)
    return out
