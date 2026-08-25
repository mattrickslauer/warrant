#!/usr/bin/env python3
"""Turn the eval corpus into camera footage the web surface can actually see.

    ./footage.py list                    what the corpus holds
    ./footage.py build pads-seated-sharp brake/pads-seated-sharp.jpg
    ./footage.py build-all               every still the takes reference

Chrome will play a Y4M file as though it were the camera
(`--use-file-for-fake-video-capture`), so `getUserMedia` hands the app a real photograph of
real work instead of a rolling test pattern or a black frame. The capture path in
`CaptureTile.tsx` is untouched and does not know the difference — which is the point: what
is being filmed is the product's own capture, with something real in front of it.

This is for the WEB surface only. The phone's camera cannot be substituted this way, and
should not be — see README.md.

Y4M is uncompressed, so a still is held for a couple of seconds and left to loop rather
than written out as a long clip. Two seconds of 1280×720 is about 40MB; forty would be 800.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
CORPUS = HERE.parent.parent / "agents" / "evals" / "media"
OUT = HERE / "footage"

WIDTH, HEIGHT, FPS, SECONDS = 1280, 720, 10, 2


def build(name: str, relative: str) -> Path:
    """One corpus still (or clip) → one loopable Y4M at camera resolution."""
    src = CORPUS / relative
    if not src.exists():
        raise SystemExit(f"not in the corpus: {src}")
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / f"{name}.y4m"

    still = src.suffix.lower() in {".jpg", ".jpeg", ".png"}
    pre = ["-loop", "1", "-t", str(SECONDS)] if still else []
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", *pre, "-i", str(src), "-r", str(FPS),
         "-vf", f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
                f"crop={WIDTH}:{HEIGHT}",
         "-pix_fmt", "yuv420p", str(dst)],
        check=True,
    )
    print(f"  {dst.name:<34} {dst.stat().st_size / 1e6:>6.1f}MB  ← {relative}")
    return dst


# The stills the takes reference, by the name a beat calls them. Kept here rather than in
# beats.py so a shot can change its footage without touching its timing.
WANTED = {
    "pads-seated-sharp": "brake/pads-seated-sharp.jpg",
    "pads-worn-to-backing": "brake/pads-worn-to-backing.jpg",
    "caliper-rear-not-front": "brake/caliper-rear-not-front.jpg",
    "part-number-legible": "label/part-number-legible.jpg",
    "part-number-glare": "label/part-number-glare.jpg",
    "wrench-setting-in-spec": "torque/wrench-setting-in-spec.jpg",
    "wrench-setting-over-spec": "torque/wrench-setting-over-spec.jpg",
    "workshop-interior": "scene/workshop-interior.jpg",
}


def reel(name: str, segments: list[tuple[str, float]]) -> Path:
    """A timed reel: one clip, changing what the camera sees as the take proceeds.

    The fake camera is a launch flag, so a browser cannot be handed a new photograph
    mid-take. A procedure with two steps wants two different photographs — the object on the
    bench, then the object in a hand — and pointing both captures at one image makes the
    Skeptic dissent for a reason that is about the harness rather than the product.

    So the reel changes on a clock and the beats are written to match it. `segments` is
    [(corpus path, seconds)] in order.
    """
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / f"{name}.y4m"
    parts = []
    for i, (relative, secs) in enumerate(segments):
        src = CORPUS / relative
        if not src.exists():
            raise SystemExit(f"not in the corpus: {src}")
        part = OUT / f".{name}.{i}.y4m"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-loop", "1", "-t", f"{secs}", "-i", str(src),
             "-r", str(FPS),
             "-vf", f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
                    f"crop={WIDTH}:{HEIGHT}",
             "-pix_fmt", "yuv420p", str(part)],
            check=True,
        )
        parts.append(part)

    # Y4M concatenates as a byte stream: every part shares one header format, so the frames
    # simply follow one another. No re-encode, and no container to rewrite.
    with dst.open("wb") as out:
        for i, part in enumerate(parts):
            data = part.read_bytes()
            if i:  # every part after the first repeats the stream header — drop it
                data = data[data.index(b"\n") + 1:]
            out.write(data)
            part.unlink()

    total = sum(s for _, s in segments)
    print(f"  {dst.name:<34} {dst.stat().st_size / 1e6:>6.1f}MB  {total:g}s, "
          f"{len(segments)} segment(s)")
    return dst


# Reels, by the name a beat calls them: what the camera shows and for how long.
REELS = {
    # "Pick up an object": the bench first, then the object in a hand, changing at 20s so a
    # two-step capture gets the two photographs the procedure actually asks for.
    "pickup-two-step": [("desk/object-on-desk.jpg", 20), ("desk/object-in-hand.jpg", 40)],
}


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] == "list":
        for p in sorted(CORPUS.rglob("*")):
            if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".mp4", ".mov"}:
                print(f"  {p.relative_to(CORPUS)}")
        return 0
    if args[0] == "build-all":
        print(f"building {len(WANTED)} clips and {len(REELS)} reel(s) into {OUT}/")
        for name, rel in WANTED.items():
            build(name, rel)
        for name, segments in REELS.items():
            reel(name, segments)
        return 0
    if args[0] == "build" and len(args) == 3:
        build(args[1], args[2])
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
