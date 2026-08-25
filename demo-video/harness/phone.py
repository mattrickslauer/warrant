#!/usr/bin/env python3
"""Record a scripted take of the phone, on real hardware.

There is no emulator option here and that is deliberate rather than a limitation of the
machine. §7 and §8 are CameraX and the platform BLE stack against a real instrument, which
is precisely what an emulator does not have — so the surface that cannot be substituted in
the product cannot be substituted in the filming either.

scrcpy captures the framebuffer, so the camera preview and the BLE screens arrive at native
resolution rather than filmed off the glass. Everything a hand must do — holding the phone,
pointing it at the work — is still a hand. What is automated is every tap that only exists
to advance the app, and those are the taps that make takes inconsistent.

Beats address elements by the text on them, resolved through uiautomator at the moment the
beat runs. Coordinates baked in at authoring time survive exactly one layout change.
"""
from __future__ import annotations

import re
import signal
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol, Sequence

import clap

# The debug build carries an applicationIdSuffix, so the package on the phone is not the
# package in the source tree. Resolved rather than assumed — filming against a stale release
# build while a fresh debug one sits beside it is a very quiet way to lose an afternoon.
PACKAGES = ("ink.warrant.debug", "ink.warrant")
DUMP_PATH = "/sdcard/warrant-ui.xml"


class NoDevice(RuntimeError):
    """Nothing to film. Said plainly rather than a stack trace out of adb."""


class NotOnScreen(RuntimeError):
    """A beat asked for something the screen does not have."""


def _adb(serial: str | None, *args: str, check: bool = True) -> str:
    head = ["adb"] + (["-s", serial] if serial else [])
    r = subprocess.run([*head, *args], capture_output=True, text=True, check=False)
    if check and r.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def devices() -> list[str]:
    out = subprocess.run(["adb", "devices"], capture_output=True, text=True).stdout
    return [ln.split()[0] for ln in out.splitlines()[1:]
            if ln.strip() and ln.split()[-1] == "device"]


def require_device(serial: str | None = None) -> str:
    found = devices()
    if serial and serial in found:
        return serial
    if not found:
        raise NoDevice(
            "no phone on adb. Plug it in, unlock it, accept the USB-debugging prompt, "
            "then `adb devices` should list it as `device` rather than `unauthorized`."
        )
    if len(found) > 1 and not serial:
        raise NoDevice(f"more than one device: {', '.join(found)} — pass --serial")
    return found[0]


def launcher(serial: str) -> tuple[str, str]:
    """The package and activity actually installed, asked of the phone."""
    for pkg in PACKAGES:
        out = _adb(serial, "shell", "cmd", "package", "resolve-activity", "--brief", pkg,
                   check=False)
        for line in out.splitlines():
            line = line.strip()
            if line.startswith(pkg + "/"):
                package, activity = line.split("/", 1)
                return package, activity
    raise NoDevice(
        f"none of {', '.join(PACKAGES)} is installed. Build and install it:\n"
        f"  cd android && ./gradlew assembleDebug \\\n"
        f"    && adb install -r app/build/outputs/apk/debug/app-debug.apk"
    )


def screen_size(serial: str) -> tuple[int, int]:
    """Native framebuffer size, which is what scrcpy will record and the compositor needs."""
    out = _adb(serial, "shell", "wm", "size")
    # An overridden size wins — it is what is actually on screen.
    sizes = re.findall(r"(?:Physical|Override) size:\s*(\d+)x(\d+)", out)
    if not sizes:
        raise RuntimeError(f"could not read the screen size from: {out.strip()!r}")
    w, h = sizes[-1]
    return int(w), int(h)


# ─── reading the screen ──────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Node:
    text: str
    desc: str
    cls: str
    bounds: tuple[int, int, int, int]

    @property
    def centre(self) -> tuple[int, int]:
        l, t, r, b = self.bounds
        return (l + r) // 2, (t + b) // 2

    @property
    def label(self) -> str:
        return self.text or self.desc


def snapshot(serial: str, tries: int = 4) -> list[Node]:
    """Every labelled node on screen right now.

    uiautomator refuses while the screen is animating, which is most of the time during a
    take, so this waits for the window to settle rather than failing the shot.
    """
    last = ""
    for attempt in range(tries):
        out = _adb(serial, "shell", "uiautomator", "dump", DUMP_PATH, check=False)
        if "dumped to" in out:
            xml = _adb(serial, "shell", "cat", DUMP_PATH)
            try:
                root = ET.fromstring(xml)
            except ET.ParseError as exc:
                last = f"the dump did not parse: {exc}"
            else:
                return _nodes(root)
        else:
            last = out.strip() or "uiautomator said nothing"
        time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(f"could not read the screen after {tries} tries — {last}")


def _nodes(root: ET.Element) -> list[Node]:
    found: list[Node] = []
    for el in root.iter("node"):
        text, desc = el.get("text", ""), el.get("content-desc", "")
        if not (text or desc):
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", el.get("bounds", ""))
        if not m:
            continue
        found.append(Node(text, desc, el.get("class", ""),
                          tuple(int(g) for g in m.groups())))
    return found


def find(serial: str, needle: str) -> Node:
    """Case-insensitive substring match, shortest label first — the most specific hit."""
    want = needle.casefold()
    nodes = snapshot(serial)
    hits = [n for n in nodes if want in n.label.casefold()]
    if not hits:
        on = ", ".join(sorted({n.label for n in nodes})[:12]) or "nothing labelled"
        raise NotOnScreen(f"no element matching {needle!r}. On screen: {on}")
    return min(hits, key=lambda n: len(n.label))


def find_settled(serial: str, needle: str, tries: int = 4) -> Node:
    """Resolve a target twice and only accept it once it has stopped moving.

    The home screen is a snapping carousel. Reading the tree takes a second or so, and a
    card that is still settling has moved on by the time the tap lands — which taps the gap
    between two cards, opens nothing, and costs the take. Whatever a tap is worth, it is
    worth one more dump to know the coordinates are still true.
    """
    seen = find(serial, needle)
    for _ in range(tries):
        again = find(serial, needle)
        if again.bounds == seen.bounds:
            return again
        seen = again
        time.sleep(0.4)
    raise NotOnScreen(
        f"{needle!r} is still moving after {tries} reads — the screen never settled"
    )


# ─── beats ───────────────────────────────────────────────────────────────────────────

class PhoneBeat(Protocol):
    def apply(self, serial: str) -> None: ...
    def describe(self) -> str: ...


@dataclass(frozen=True)
class Tap:
    """Tap whatever currently carries this text or content description."""
    text: str
    def apply(self, serial: str) -> None:
        x, y = find_settled(serial, self.text).centre
        _adb(serial, "shell", "input", "tap", str(x), str(y))
    def describe(self) -> str: return f"tap {self.text!r}"


@dataclass(frozen=True)
class TapAt:
    """For a target uiautomator cannot see — a camera shutter drawn by Compose canvas.

    Fractions of the screen, not pixels, so it survives being run on a second handset.
    """
    fx: float
    fy: float
    what: str = ""
    def apply(self, serial: str) -> None:
        w, h = screen_size(serial)
        _adb(serial, "shell", "input", "tap", str(int(w * self.fx)), str(int(h * self.fy)))
    def describe(self) -> str:
        return f"tap at {self.fx:.2f},{self.fy:.2f}" + (f" ({self.what})" if self.what else "")


@dataclass(frozen=True)
class WaitText:
    text: str
    timeout: float = 20.0
    def apply(self, serial: str) -> None:
        deadline = time.time() + self.timeout
        last: list[str] = []
        while time.time() < deadline:
            try:
                nodes = snapshot(serial)
            except RuntimeError:
                continue
            last = sorted({n.label for n in nodes})
            if any(self.text.casefold() in n.label.casefold() for n in nodes):
                return
            time.sleep(0.5)
        on = ", ".join(last[:10]) or "nothing labelled"
        raise NotOnScreen(
            f"{self.text!r} never appeared in {self.timeout:g}s. On screen: {on}"
        )
    def describe(self) -> str: return f"wait for {self.text!r}"


@dataclass(frozen=True)
class WaitAny:
    """Wait for whichever of these the app reaches first, and say which it was.

    The fleet is allowed to branch. A capture that passes advances the step; one the
    Inspector wants more from raises a field instead, and both are correct behaviour. A
    take that dies on the branch it did not expect is a take lost to the product working.
    """
    texts: tuple[str, ...]
    timeout: float = 25.0
    def apply(self, serial: str) -> None:
        deadline = time.time() + self.timeout
        last: list[str] = []
        while time.time() < deadline:
            try:
                nodes = snapshot(serial)
            except RuntimeError:
                continue
            last = sorted({n.label for n in nodes})
            for want in self.texts:
                if any(want.casefold() in n.label.casefold() for n in nodes):
                    print(f"      → {want!r}", flush=True)
                    return
            time.sleep(0.5)
        raise NotOnScreen(
            f"none of {', '.join(repr(t) for t in self.texts)} appeared in "
            f"{self.timeout:g}s. On screen: {', '.join(last[:10])}"
        )
    def describe(self) -> str:
        return "wait for any of " + ", ".join(repr(t) for t in self.texts)


@dataclass(frozen=True)
class Dwell:
    seconds: float
    because: str = ""
    def apply(self, serial: str) -> None:
        time.sleep(self.seconds)
    def describe(self) -> str:
        return f"hold {self.seconds:g}s" + (f" — {self.because}" if self.because else "")


@dataclass(frozen=True)
class Hands:
    """A beat the harness will not perform: someone has to do this to the machine.

    It prints, waits the time the shot list gives it, and moves on. Naming it keeps the
    take honest about which seconds are automated and which are a person.
    """
    seconds: float
    what: str
    def apply(self, serial: str) -> None:
        print(f"\n      ⏸  {self.what.upper()} — {self.seconds:g}s", flush=True)
        time.sleep(self.seconds)
    def describe(self) -> str: return f"HANDS: {self.what} ({self.seconds:g}s)"


@dataclass(frozen=True)
class Rolling:
    """Record, and stay out of the way.

    For a take where the app is being used by a person doing real work. Nothing is tapped,
    nothing is timed — the harness holds the recorder open and prints the clock so whoever is
    filming knows how long they have been rolling. Stop it early with Ctrl-C; the container is
    finalised either way.
    """
    seconds: float
    def apply(self, serial: str) -> None:
        end = time.time() + self.seconds
        print(f"\n      ● ROLLING — {self.seconds / 60:.0f} min, Ctrl-C to stop early\n",
              flush=True)
        while time.time() < end:
            left = end - time.time()
            print(f"\r      ● {int(left) // 60:02d}:{int(left) % 60:02d} remaining ",
                  end="", flush=True)
            time.sleep(1)
        print("\r      ● time up" + " " * 20, flush=True)
    def describe(self) -> str: return f"roll for {self.seconds / 60:.0f} min, hands off"


@dataclass(frozen=True)
class Swipe:
    fx1: float; fy1: float; fx2: float; fy2: float; ms: int = 400
    def apply(self, serial: str) -> None:
        w, h = screen_size(serial)
        _adb(serial, "shell", "input", "swipe",
             str(int(w * self.fx1)), str(int(h * self.fy1)),
             str(int(w * self.fx2)), str(int(h * self.fy2)), str(self.ms))
    def describe(self) -> str: return f"swipe {self.fx1:.2f},{self.fy1:.2f} → {self.fx2:.2f},{self.fy2:.2f}"


# ─── recording ───────────────────────────────────────────────────────────────────────

def record(
    *,
    serial: str,
    beats: Sequence[PhoneBeat],
    out: Path,
    on_clap: Callable[[], None] | None = None,
    settle: float = 6.0,
    log: Callable[[str], None] = print,
) -> Path:
    """Roll scrcpy, clap by cold-starting the app, run the beats, close the container."""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.unlink(missing_ok=True)

    proc = subprocess.Popen(
        ["scrcpy", "--serial", serial, "--no-audio", "--no-window", "--no-control",
         "--record", str(out)],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
    )

    # Rolling means frames on disk, not a process that has been spawned. scrcpy takes a
    # second or two to negotiate the encoder and a clap issued before that is simply lost.
    deadline = time.time() + settle
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"scrcpy exited early: {(proc.stderr.read() or '').strip()}")
        if out.exists() and out.stat().st_size > 4096:
            break
        time.sleep(0.2)
    else:
        proc.send_signal(signal.SIGINT)
        raise RuntimeError(f"scrcpy wrote nothing in {settle:g}s — is the screen unlocked?")

    try:
        package, activity = launcher(serial)
        if on_clap:
            on_clap()
        clap.phone_clap(package, activity, serial)
        log(f"  clap · phone cold-started {package}")

        for i, beat in enumerate(beats, 1):
            log(f"  {i:>2}. {beat.describe()}")
            beat.apply(serial)
    finally:
        # SIGINT, not kill: scrcpy finalises the container on interrupt and an mp4 killed
        # mid-write has no moov atom and will not open in anything.
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()

    return out
