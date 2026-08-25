#!/usr/bin/env python3
"""Veo, generating the six inserts in §2 and §3 that have nothing to film.

    ./gen_shots.py --dry-run          # what it would ask for, and why
    ./gen_shots.py                    # generate what is missing
    ./gen_shots.py --only 11          # one shot
    ./gen_shots.py --force            # regenerate everything
    ./gen_shots.py --split-only       # rebuild 13/14 from plates already on disk

WHY THESE SIX AND NOT THE REST OF THE FILM.

`SCRIPT.md` §2 and §3 are the only beats in the cut that are *about* something rather than
*of* something. §2 is a paper service sheet with a column of identical biro ticks — the
record this product exists to replace. §3 is the two frames the argument sits between: an
aviation logbook that works and costs more than the motorcycle, and a courier flow that
costs pennies. Everything after 0:26 is the running system, a real phone, a real workshop
and a real instrument, and none of it is generated or ever will be.

So the six here are:

    8   macro push on a paper service sheet, a biro tick goes in a box
    9   same sheet, pull back — a whole column of identical ticks
    11  insert: a technical logbook, a signature, a part tag
    12  cut back to the tick, same framing as 8
    13  split screen — stylised courier flow left, the paper sheet right
    14  left side keeps advancing, right side stays a tick

WHY GENERATING THEM IS CONSISTENT WITH A FILM ABOUT NOT FABRICATING READINGS.

The corpus rule (`agents/evals/manifest.py`, and `gen_fraud.py` restates it at length) is
that **evidence** must be real: a generated instrument display is a fabricated reading, and
a synthetic number in the test corpus is the one mistake it would be fair to hold against
us. Nothing this script writes is evidence. It is never judged by the Inspector, never
satisfies an acceptance rule, and never enters the corpus. It is B-roll standing in for the
problem statement — the paper the product replaces — which is ordinary re-enactment.

The rule is still doing work here, and it is enforced in the prompts: **no shot below
contains a number, a gauge, a display, a measurement or a legible word.** A generated
torque figure on screen for one frame would cost more than the whole section is worth.

WHAT THE COLD OPEN LOOKS LIKE, because these have to cut against it.

`cold-open-1.mov` is 1920×1080, 23.976, live action: one person playing five departments in
an ordinary room — patterned wallpaper, flat window daylight, no key, no grade, no music,
room tone only, the camera locked off or barely drifting. It is deliberately unglamorous.
So every prompt below asks for **overcast window light, flat contrast, slightly desaturated,
shallow depth of field, micro handheld drift, no studio lighting, no gloss, no camera moves
a person could not do**, and `NEGATIVE` refuses the commercial look Veo reaches for by
default. Cinematic B-roll here would read as stock, and stock is the one texture this film
cannot afford.

CONTINUITY. Shots 8, 9 and 12 are the same sheet on the same bench and 12 is explicitly
*"same framing as shot 8"*. Veo will not draw the same sheet twice from the same words, so
both are conditioned on a frame of 8 rather than on adjectives. **Both take its LAST frame**
— the one where the tick is in the box and the hand is leaving. 9 continues the pull-back
out of it; 12 returns to it and holds. Conditioning 12 on the *first* frame is the obvious
guess and it is wrong: the first frame is before the pen arrives, so it comes back with
every box empty and no tick to cut to, which is the one thing that shot is of. 8 must
therefore be generated before either, which `--only` respects and the ordering guarantees.

RIGHTS, which §3 already flags. `rules.md:149` bars content violating a third party's
publicity or privacy rights, so the logbook in shot 11 is mocked up: no engineer's name, no
signature that resolves into letters, no operator, no manufacturer's mark on the part tag.
The courier flow in 13/14 is a motion graphic drawn by `courier_pane()` below and not a
generated frame at all — partly because real app iconography is a third-party trademark, and
partly because Veo cannot render four lines of legible UI text and the whole point of that
pane is that you can read the steps.

COST. Veo bills per second. This is four clips of four to six seconds, run by hand, and
nothing in the test suite or the product calls it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "generated"
PROVENANCE = OUT / "PROVENANCE.json"
COLD_OPEN = HERE / "cold-open-1.mov"

#: Same id and region as `agents/evals/gen_fraud.py`, and for the same reason recorded there:
#: every `-preview` and every 2.0/3.0 spelling 404s on this project while this one starts an
#: operation immediately. Veo on Vertex is regional and is not on the `global` endpoint.
VEO_MODEL = os.environ.get("VEO_MODEL", "veo-3.1-generate-001")
PROJECT = os.environ.get("GCP_PROJECT", "warrent-505918")
VEO_LOCATION = os.environ.get("VEO_LOCATION", "us-central1")
OUTPUT_BUCKET = os.environ.get("VEO_OUTPUT_BUCKET", f"gs://{PROJECT}-agents/veo")

POLL_SECONDS = 15
POLL_LIMIT = 40           # ten minutes

#: The look the cold open already established, said once so every prompt agrees.
LOOK = (
    "Shot on a full-frame camera at 24fps, 50mm, shallow depth of field. Flat overcast "
    "daylight through a window, no artificial key light, no colour grade, slightly "
    "desaturated and slightly cool. Very slight handheld drift, nothing smooth or "
    "motorised. Ordinary, unglamorous, documentary."
)

#: What Veo reaches for by default and must not have. The text clauses matter most: a
#: generated word is either garbled — which looks like a fake — or legible, which is a
#: fabricated record in a film about fabricated records.
NEGATIVE = (
    "legible text, readable words, readable handwriting, numbers, digits, gauge, dial, "
    "display, screen, meter reading, logos, brand names, company names, trademarks, "
    "faces, portrait, studio lighting, softbox, rim light, teal and orange grade, "
    "glossy commercial advert look, stock footage look, lens flare, bokeh balls, drone "
    "shot, gimbal move, crane move, speed ramp, slow motion, music, on-screen graphics, "
    "subtitles, captions, watermark, timecode, vignette"
)


@dataclass(frozen=True)
class Shot:
    #: Its number in `SCRIPT.md`'s shot list. That file is the authority; this is a renderer.
    number: int
    slug: str
    #: The line from SCRIPT.md this stands in for, verbatim, so a drift between the two is
    #: visible in a diff rather than only in the cut.
    script: str
    prompt: str
    seconds: int = 6
    #: Continuity. `("8", "last")` means: condition on the last frame of shot 8.
    after: tuple[int, str] | None = None
    #: Veo refuses `dont_allow` for anything with a hand in it, and half of these are hands.
    #: No face is ever framed — the prompts say so and `NEGATIVE` says so again.
    person: str = "allow_adult"

    @property
    def path(self) -> Path:
        return OUT / f"{self.number:02d}-{self.slug}.mp4"


SHOTS: tuple[Shot, ...] = (
    Shot(
        number=8,
        slug="service-sheet-tick",
        script="Macro push on a paper service sheet. A biro tick goes in a box.",
        seconds=6,
        prompt=(
            "Extreme close-up, slowly pushing in on a sheet of printed paper lying on a "
            "scuffed wooden workbench: a pre-printed inspection checklist with ruled rows "
            "and small empty square checkboxes running down one side. The paper is a "
            "little creased and slightly grubby at one corner. A bare hand holding a cheap "
            "blue ballpoint pen comes in from the right and draws one tick into a single "
            "empty checkbox, then lifts away. Only the hand and the pen, no arm above the "
            "wrist, no person visible. The printed wording on the sheet is far too small "
            "and too soft to read. " + LOOK
        ),
    ),
    Shot(
        number=9,
        slug="column-of-ticks",
        script="Same sheet, pull back — a whole column of identical ticks.",
        seconds=6,
        after=(8, "last"),
        prompt=(
            "The camera pulls slowly and steadily back from the same checklist on the same "
            "workbench until the whole sheet is in frame. Revealed down the right-hand "
            "column is a long run of a dozen or more blue ballpoint ticks, one in every "
            "box, all of them made the same way with the same stroke, none of them "
            "different from any other. The pen lies still on the paper. Nobody in frame. "
            "The printed wording stays too small and too soft to read. " + LOOK
        ),
    ),
    Shot(
        number=11,
        slug="logbook-and-part-tag",
        script="Insert: an aviation logbook, a signature, a part tag.",
        seconds=6,
        prompt=(
            "Close-up insert of a heavy hardbound technical maintenance logbook lying open "
            "on a desk, thick ruled pages divided into narrow columns. A hand holding a "
            "black fountain pen signs one line with a fast looping mark that never "
            "resolves into letters, then lifts away. In the front of frame, resting on the "
            "open page and clearly in focus, is a small buff-brown cardboard part tag with "
            "a brass eyelet and a twisted wire tie — a plain blank luggage-label shape, "
            "completely unmarked, no printing and no writing on it at all. The tag is the "
            "second subject of the shot and must be unmistakable. Only the hand, no arm, "
            "no person visible. Nothing in frame is legible: no names, no words, no "
            "printed marks. Serious, archival, slightly worn. " + LOOK
        ),
    ),
    Shot(
        number=12,
        slug="back-to-the-tick",
        script="Cut back to your biro tick. Same framing as shot 8.",
        seconds=4,
        # The LAST frame of 8, not the first. The first frame is before the pen arrives, so
        # conditioning on it returns a sheet with every box still empty — which is what the
        # first take of this shot actually came back as. Shot 12's whole content is that the
        # tick is already there and nothing has happened since.
        after=(8, "last"),
        prompt=(
            "The same checklist on the same workbench in the same framing, locked off and "
            "still. The single blue ballpoint tick is already sitting in its box. Nothing "
            "moves except the faintest drift of the handheld camera and a slow change in "
            "the daylight. No hand, no pen, nobody in frame. " + LOOK
        ),
    ),
)

#: 13 and 14 are one three-second split screen, not two generated clips — see the docstring.
#: The right pane comes out of shot 12's plate, the left is drawn.
SPLIT = OUT / "13-14-split-screen.mp4"
SPLIT_SECONDS = 4.0
FPS = 24


# ── the courier pane ─────────────────────────────────────────────────────────────────────
#
# Stylised on purpose. Real courier iconography is a third-party trademark and `SCRIPT.md`
# §3's note says to keep it stylised; the deeper reason is that this pane's whole job is
# that a judge can read four steps land in four seconds, and generated UI text cannot be
# read. Nothing here names a carrier and nothing here is a real product's interface.

STEPS = (
    ("Collected", "09:41"),
    ("Out for delivery", "11:02"),
    ("Photo taken at door", "11:57"),
    ("Delivered", "11:58"),
)


def _font(size: int, weight: int = 400, mono: bool = False):
    from PIL import ImageFont
    path = ("/usr/share/fonts/google-noto-vf/NotoSansMono[wght].ttf" if mono
            else "/usr/share/fonts/google-noto-vf/NotoSans[wght].ttf")
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass                                  # a static build of the face; size is enough
    return f


def courier_pane(w: int, h: int, frames: int, out_dir: Path) -> None:
    """One PNG per frame: four steps arriving one at a time, then holding.

    The timing is the argument. Four steps land inside the first two thirds of the clip and
    the last third holds — because the VO over it is *"a stranger proves they delivered a
    parcel in four seconds, for pennies"*, and the pane has to be visibly finished while the
    sheet beside it is visibly not.
    """
    from PIL import Image, ImageDraw

    out_dir.mkdir(parents=True, exist_ok=True)
    ink, dim, rule, ok = (24, 26, 30), (128, 132, 138), (222, 224, 228), (32, 122, 72)
    title_f, step_f, time_f = _font(38, 600), _font(40, 500), _font(30, 400, mono=True)

    pad = int(w * 0.11)
    top = int(h * 0.30)
    gap = int(h * 0.095)
    # Each step gets its own arrival frame; the tail is dead hold.
    arrive = [int(frames * t) for t in (0.06, 0.22, 0.38, 0.54)]

    for i in range(frames):
        img = Image.new("RGB", (w, h), (247, 247, 245))
        d = ImageDraw.Draw(img)
        d.text((pad, int(h * 0.17)), "PARCEL #4471", font=title_f, fill=dim)
        d.line([(pad, int(h * 0.235)), (w - pad, int(h * 0.235))], fill=rule, width=2)

        for n, ((label, stamp), at) in enumerate(zip(STEPS, arrive)):
            if i < at:
                continue
            # A short slide-and-fade in, so a step visibly *arrives* rather than blinking.
            k = min(1.0, (i - at) / 7.0)
            y = top + n * gap + int((1 - k) * 22)
            def mix(c):
                return tuple(int(247 + (v - 247) * k) for v in c)
            r = 13
            cx, cy = pad + r, y + 20
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=mix(ok))
            d.line([(cx - 6, cy), (cx - 2, cy + 5), (cx + 6, cy - 6)],
                   fill=(247, 247, 245), width=3)
            d.text((pad + 2 * r + 18, y), label, font=step_f, fill=mix(ink))
            d.text((w - pad - 96, y + 6), stamp, font=time_f, fill=mix(dim))

        img.save(out_dir / f"{i:04d}.png")


def build_split(force: bool = False) -> None:
    """Shots 13 and 14: the courier pane left, shot 12's sheet right, unchanged."""
    plate = next((s for s in SHOTS if s.number == 12), None).path
    if not plate.exists():
        raise SystemExit(f"shot 12's plate is missing — generate it first:\n  {plate}")
    if SPLIT.exists() and not force:
        print(f"  have    {SPLIT.name}")
        return

    frames = int(SPLIT_SECONDS * FPS)
    pane = OUT / ".courier-frames"
    print(f"  drawing courier pane — {frames} frames")
    courier_pane(960, 1080, frames, pane)

    print(f"  stacking {SPLIT.name}")
    # Left: the drawn pane. Right: shot 12 centre-cropped to 8:9 and held on its last frame
    # if the plate is shorter than the split (Veo's 4s at 24fps is exactly 4s, but a
    # re-generated plate may not be, and a black tail would be a real edit mistake).
    subprocess.run([
        "ffmpeg", "-v", "error", "-y",
        "-framerate", str(FPS), "-i", str(pane / "%04d.png"),
        "-stream_loop", "-1", "-i", str(plate),
        "-filter_complex",
        "[1:v]scale=1920:1080:force_original_aspect_ratio=increase,"
        "crop=960:1080,setsar=1,fps=24[r];"
        "[0:v]setsar=1,fps=24[l];"
        "[l][r]hstack=inputs=2,format=yuv420p[v]",
        "-map", "[v]", "-t", str(SPLIT_SECONDS),
        "-c:v", "libx264", "-crf", "16", "-preset", "slow",
        str(SPLIT),
    ], check=True)

    for f in pane.glob("*.png"):
        f.unlink()
    pane.rmdir()
    print(f"  wrote   {SPLIT.name}")

    # Recorded even though no model drew it: half of it is Veo's, and a file in this folder
    # with no provenance row is exactly the ambiguity the rest of the repo refuses to leave.
    write_provenance([{
        "file": SPLIT.name,
        "shot": "13-14",
        "script": ("Split screen. Left: a stylised courier flow, steps appearing one at a "
                   "time. Right: your paper sheet, unchanged, staying a tick."),
        "synthetic": True,
        "never_evidence": "B-roll for §3. Never judged, never in the corpus.",
        "model": None,
        "location": None,
        "prompt": None,
        "negative_prompt": None,
        "duration_seconds": SPLIT_SECONDS,
        "conditioned_on": None,
        "built_from": {
            "left": ("courier_pane() in demo-video/gen_shots.py — drawn, not generated, "
                     "because real carrier iconography is a third-party trademark and "
                     "generated UI text cannot be read"),
            "right": f"{plate.name}, centre-cropped to 8:9, unchanged",
        },
        "sha256": hashlib.sha256(SPLIT.read_bytes()).hexdigest(),
        "bytes": SPLIT.stat().st_size,
    }])


# ── Veo ──────────────────────────────────────────────────────────────────────────────────

def _client():
    from google import genai
    return genai.Client(vertexai=True, project=PROJECT, location=VEO_LOCATION)


def _conditioning(shot: Shot):
    """The still shot 9 and shot 12 hang off, pulled out of shot 8's plate."""
    if not shot.after:
        return None
    from google.genai import types

    number, which = shot.after
    source = next(s for s in SHOTS if s.number == number).path
    if not source.exists():
        raise RuntimeError(
            f"shot {shot.number} is conditioned on shot {number}, which is not on disk yet. "
            f"Run without --only, or generate shot {number} first.")

    still = OUT / f".{shot.slug}-seed.jpg"
    args = ["-sseof", "-0.2"] if which == "last" else ["-ss", "0"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args, "-i", str(source),
                    "-frames:v", "1", "-q:v", "2", str(still)], check=True)
    print(f"          conditioned on the {which} frame of shot {number}")
    return types.Image(image_bytes=still.read_bytes(), mime_type="image/jpeg")


def _save(video, dest: Path) -> int:
    data = getattr(video, "video_bytes", None)
    if data:
        dest.write_bytes(data)
        return len(data)
    uri = getattr(video, "uri", None)
    if not uri:
        raise RuntimeError("the operation returned a video with neither bytes nor a uri")
    proc = subprocess.run(["gcloud", "storage", "cp", uri, str(dest)],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"could not fetch {uri}: {proc.stderr.strip()[:300]}. The clip IS generated and "
            f"is in the bucket — copy it to {dest} by hand rather than paying again.")
    return dest.stat().st_size


def generate(shot: Shot, *, force: bool) -> dict | None:
    if shot.path.exists() and not force:
        print(f"  have    {shot.path.name}")
        return None

    from google.genai import types

    print(f"  asking  shot {shot.number} · {shot.slug} — {shot.seconds}s, a few minutes")
    image = _conditioning(shot)
    client = _client()
    config = types.GenerateVideosConfig(
        number_of_videos=1,
        duration_seconds=shot.seconds,
        aspect_ratio="16:9",
        resolution="1080p",                    # the cold open is 1920×1080
        negative_prompt=NEGATIVE,
        person_generation=shot.person,
        # No generated speech or score under a shot that carries VO. Room tone is welcome
        # and is the only thing these prompts could produce anyway.
        generate_audio=True,
        output_gcs_uri=OUTPUT_BUCKET,
    )
    source = types.GenerateVideosSource(prompt=shot.prompt, image=image)
    operation = client.models.generate_videos(model=VEO_MODEL, source=source, config=config)

    for _ in range(POLL_LIMIT):
        if operation.done:
            break
        time.sleep(POLL_SECONDS)
        operation = client.operations.get(operation)
    else:
        raise RuntimeError(
            f"shot {shot.number}: still running after {POLL_LIMIT * POLL_SECONDS}s — check "
            f"the operation in the console rather than assuming it failed")

    if getattr(operation, "error", None):
        raise RuntimeError(f"shot {shot.number}: {operation.error}")

    videos = getattr(operation.response, "generated_videos", None) or []
    if not videos:
        raise RuntimeError(
            f"shot {shot.number}: finished with no video — most likely a safety filter on "
            f"the prompt. Rewrite it rather than retrying. Response: {operation.response}")

    OUT.mkdir(parents=True, exist_ok=True)
    size = _save(videos[0].video, shot.path)
    print(f"  wrote   {shot.path.name}  {size / 1_000_000:.1f} MB")

    return {
        "file": shot.path.name,
        "shot": shot.number,
        "script": shot.script,
        "synthetic": True,
        "never_evidence": ("B-roll for §2/§3. Never judged, never in the corpus, and "
                           "carries no number, reading, display or legible word."),
        "model": VEO_MODEL,
        "location": VEO_LOCATION,
        "prompt": shot.prompt,
        "negative_prompt": NEGATIVE,
        "duration_seconds": shot.seconds,
        "conditioned_on": (f"shot {shot.after[0]}, {shot.after[1]} frame"
                           if shot.after else None),
        "sha256": hashlib.sha256(shot.path.read_bytes()).hexdigest(),
        "bytes": size,
    }


def write_provenance(rows: list[dict]) -> None:
    existing = {}
    if PROVENANCE.exists():
        existing = {r["file"]: r for r in json.loads(PROVENANCE.read_text())["files"]}
    for row in rows:
        existing[row["file"]] = row
    PROVENANCE.write_text(json.dumps({
        "//": ("SYNTHETIC MEDIA. Generated by Veo for `demo-video/gen_shots.py`. These are "
               "the §2 and §3 inserts of the film and nothing else. None of it is evidence, "
               "none of it is judged by any agent, and none of it is in the eval corpus — "
               "see `agents/evals/manifest.py` for the rule that governs the corpus and the "
               "module docstring here for why these six are outside it."),
        "generator": "demo-video/gen_shots.py",
        "files": sorted(existing.values(), key=lambda r: r["file"]),
    }, indent=2) + "\n")
    print(f"\nprovenance → {PROVENANCE.relative_to(HERE.parent)}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="print the asks, call nothing")
    ap.add_argument("--force", action="store_true", help="regenerate clips already on disk")
    ap.add_argument("--only", metavar="N", type=int, help="just this shot number")
    ap.add_argument("--split-only", action="store_true",
                    help="rebuild 13/14 from the plates already on disk")
    args = ap.parse_args(argv)

    if args.split_only:
        build_split(force=args.force)
        return 0

    wanted = [s for s in SHOTS if args.only is None or s.number == args.only]
    if not wanted:
        print(f"no shot {args.only} here; have: "
              f"{', '.join(str(s.number) for s in SHOTS)} (and 13/14, which are built)",
              file=sys.stderr)
        return 2

    print(f"Veo   {VEO_MODEL} @ {VEO_LOCATION}")
    print(f"into  {OUT}")
    print("\nB-ROLL FOR §2 AND §3. NEVER EVIDENCE, NEVER IN THE CORPUS.\n")

    if args.dry_run:
        for s in wanted:
            mark = "have" if s.path.exists() else "want"
            print(f"  {mark}    {s.path.name}  ({s.seconds}s)")
            print(f"          script:  {s.script}")
            if s.after:
                print(f"          after:   shot {s.after[0]}, {s.after[1]} frame")
            print(f"          prompt:  {s.prompt[:110]}…\n")
        print(f"  build   {SPLIT.name}  ({SPLIT_SECONDS}s) — shots 13 and 14")
        print( "          left:    courier pane, drawn, four steps in four seconds")
        print( "          right:   shot 12's plate, unchanged\n")
        return 0

    rows: list[dict] = []
    failed: list[str] = []
    for s in wanted:                             # ordered, so 8 lands before 9 and 12
        try:
            row = generate(s, force=args.force)
        except Exception as e:
            print(f"  FAILED  shot {s.number}: {e}", file=sys.stderr)
            failed.append(str(s.number))
            continue
        if row:
            rows.append(row)

    if rows:
        write_provenance(rows)

    if args.only is None and not failed:
        print()
        try:
            build_split(force=args.force)
        except Exception as e:
            print(f"  FAILED  13/14: {e}", file=sys.stderr)
            failed.append("13/14")

    if failed:
        print(f"\n{len(failed)} failed: {', '.join(failed)}", file=sys.stderr)
        return 1
    print(f"\nok — six shots in {OUT.name}/. Watch them against `cold-open-1.mov` before "
          f"cutting; a take that reads as stock is a re-ask, not a keep.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
