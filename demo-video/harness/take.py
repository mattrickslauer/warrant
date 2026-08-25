#!/usr/bin/env python3
"""Run a take: both surfaces at once, clapped together, then composed.

    ./take.py probe                    what the phone is showing, so beats can be written
    ./take.py list                     the takes this harness knows
    ./take.py record 9                 shoot §9 — phone and operator view, one clock
    ./take.py compose takes/9-1        stack a take that has already been shot
    ./take.py record 9 --compose       both, which is the usual way

Panes run on threads that meet at a barrier before either claps, so the two markers are
issued within milliseconds of each other. Everything after that is each pane's own script,
and the alignment in post is done against the markers rather than against the clock.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import traceback
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import beats as beatlib          # noqa: E402
import compose as composer       # noqa: E402
import phone as phonelib         # noqa: E402
import web as weblib             # noqa: E402

HERE = Path(__file__).parent
TAKES = HERE / "takes"
DEFAULT_URL = "http://localhost:3200"
PHONE_FALLBACK = (1080, 2400)


def _next_dir(key: str) -> Path:
    """Takes are numbered, never overwritten. The one you want is rarely the last one."""
    TAKES.mkdir(parents=True, exist_ok=True)
    n = 1 + max((int(p.name.rsplit("-", 1)[1])
                 for p in TAKES.glob(f"{key}-*") if p.name.rsplit("-", 1)[1].isdigit()),
                default=0)
    d = TAKES / f"{key}-{n}"
    d.mkdir()
    return d


def cmd_probe(args) -> int:
    serial = phonelib.require_device(args.serial)
    w, h = phonelib.screen_size(serial)
    pkg, act = phonelib.launcher(serial)
    print(f"{serial} · {w}×{h} · {pkg}/{act}\n")
    nodes = phonelib.snapshot(serial)
    if not nodes:
        print("nothing labelled on screen — Compose may not be exposing semantics here; "
              "use phone.TapAt(fx, fy) for this screen")
        return 0
    print(f"{'label':<44} {'centre':>12}  class")
    print("-" * 88)
    for n in sorted(nodes, key=lambda n: (n.bounds[1], n.bounds[0])):
        x, y = n.centre
        print(f"{n.label[:43]:<44} {f'{x},{y}':>12}  {n.cls.rsplit('.', 1)[-1]}")
    return 0


def cmd_roll(args) -> int:
    """Record the phone screen while a person does the job, and clap so it can be synced.

    The screen is captured from the framebuffer at native resolution rather than filmed off
    the glass, which is the difference between a readable record and a moiré pattern.

    The clap is the app cold-starting. Hold the phone in the camera's frame while it happens:
    that launch is visible in BOTH the screen recording and the camera footage, which is what
    a clapperboard is for. Everything after it is one clock.
    """
    serial = phonelib.require_device(args.serial)
    w, h = phonelib.screen_size(serial)
    package, _ = phonelib.launcher(serial)
    out_dir = _next_dir("roll")
    print(f"phone {serial} · {w}×{h} · {package}")
    print(f"→ {out_dir}\n")
    print("  Hold the phone in frame — the app relaunching IS the clap.\n")

    path = phonelib.record(
        serial=serial, beats=(phonelib.Rolling(args.minutes * 60),),
        out=out_dir / "phone.mp4",
    )
    (out_dir / "take.json").write_text(json.dumps({
        "take": "roll", "shot": datetime.now().astimezone().isoformat(timespec="seconds"),
        "left": {"file": path.name, "clap": "launch", "label": "phone", "kind": "phone"},
    }, indent=2) + "\n")
    print(f"\nrecorded {path} — {path.stat().st_size / 1e6:.0f}MB")
    print(f"stack it against camera footage with:\n"
          f"  ./take.py compose {out_dir.relative_to(HERE)}  (after adding the camera file)")
    return 0


def cmd_list(args) -> int:
    for key, take in beatlib.TAKES.items():
        print(f"{key:>4}  {take.section} · {take.title}  ({take.seconds:g}s)")
        for side, pane in (("left", take.left), ("right", take.right)):
            print(f"        {side:<6} {pane.kind:<5} {pane.label} — {len(pane.beats)} beats")
    return 0


def _run_pane(pane, *, base_url, serial, out_dir, phone_px, barrier, results):
    tag = f"[{pane.label}]"
    phone = pane.kind == "phone"
    path = out_dir / (f"{pane.slug}.mp4" if phone else f"{pane.slug}.webm")
    kind = "launch" if phone else "flash"

    def log(msg: str) -> None:
        print(f"{tag} {msg}", flush=True)

    try:
        if phone:
            phonelib.record(serial=serial, beats=pane.beats, out=path,
                            on_clap=barrier.wait, log=log)
        else:
            footage = (HERE / "footage" / f"{pane.footage}.y4m") if pane.footage else None
            weblib.record(base_url=base_url, beats=pane.beats, out=path,
                          width=pane.width, height=pane.height, open_at=pane.open_at,
                          footage=footage, on_clap=barrier.wait, log=log)
        results[pane.slug] = {"path": path, "clap": kind, "ok": True}
    except Exception:
        barrier.abort()
        log("FAILED\n" + traceback.format_exc())
        # Both recorders finalise their file in a finally, so the footage up to the
        # failure survives. Keeping it is the difference between a beat you re-time and a
        # shoot you repeat.
        kept = path.exists() and path.stat().st_size > 64 * 1024
        results[pane.slug] = {"path": path, "clap": kind, "ok": False, "kept": kept}
        if kept:
            log(f"kept {path.name} anyway — {path.stat().st_size / 1e6:.1f}MB")


def cmd_record(args) -> int:
    take = beatlib.TAKES.get(args.key)
    if not take:
        print(f"no take {args.key!r}. Known: {', '.join(beatlib.TAKES)}", file=sys.stderr)
        return 2

    serial = None
    phone_px = PHONE_FALLBACK
    if take.needs_phone:
        serial = phonelib.require_device(args.serial)
        phone_px = phonelib.screen_size(serial)
        print(f"phone {serial} · {phone_px[0]}×{phone_px[1]}")

    # The web pane is recorded at exactly the pixels it will occupy, so its text is never
    # resampled on the way into the frame.
    take = take.sized_for(phone_px, args.frame)
    for side in (take.left, take.right):
        if side.kind == "web":
            print(f"web pane {side.label} recorded at {side.width}×{side.height}")

    for side, pane in (("left", take.left), ("right", take.right)):
        planned = beatlib.planned_seconds(pane)
        if planned is not None and abs(planned - take.seconds) > 1.5:
            print(f"⚠  the {side} pane's beats sum to {planned:.1f}s but the take is "
                  f"{take.seconds:g}s — the shorter pane is what the composite gets")

    out_dir = _next_dir(args.key)
    print(f"→ {out_dir}\n")

    barrier = threading.Barrier(2, timeout=180)
    results: dict[str, object] = {}
    threads = [
        threading.Thread(target=_run_pane, args=(p,), kwargs=dict(
            base_url=args.url, serial=serial, out_dir=out_dir, phone_px=phone_px,
            barrier=barrier, results=results), name=p.slug)
        for p in (take.left, take.right)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    panes = [results.get(p.slug) or {} for p in (take.left, take.right)]
    failed = [p for p in panes if not p.get("ok")]
    usable = all(r.get("ok") or r.get("kept") for r in panes)

    manifest = {
        "take": args.key,
        "section": take.section,
        "title": take.title,
        "seconds": take.seconds,
        "shot": datetime.now().astimezone().isoformat(timespec="seconds"),
        "frame": list(args.frame),
    }
    for side, pane in (("left", take.left), ("right", take.right)):
        r = results[pane.slug]
        manifest[side] = {"file": r["path"].name, "clap": r["clap"], "label": pane.label,
                          "kind": pane.kind, "complete": bool(r.get("ok"))}
    (out_dir / "take.json").write_text(json.dumps(manifest, indent=2) + "\n")

    if failed and not usable:
        print(f"\na pane failed and left nothing usable — {out_dir}", file=sys.stderr)
        return 1
    if failed:
        print(f"\na pane failed part-way, but both files are on disk — {out_dir}\n"
              f"the take is short, not lost: compose it and see how far it got",
              file=sys.stderr)

    print(f"\nrecorded {out_dir}")
    if args.compose:
        print("\ncomposing:")
        composer.from_manifest(out_dir, layout=args.layout, seconds=None)
    else:
        print(f"compose it with:  ./take.py compose {out_dir.relative_to(HERE)}")
    return 1 if failed else 0


def cmd_compose(args) -> int:
    composer.from_manifest(Path(args.dir), layout=args.layout)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--serial", help="which phone, when more than one is attached")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("probe", help="print what the phone is showing").set_defaults(fn=cmd_probe)
    sub.add_parser("list", help="the takes defined in beats.py").set_defaults(fn=cmd_list)

    rl = sub.add_parser("roll", help="record the phone while a person does the job")
    rl.add_argument("--minutes", type=float, default=20.0)
    rl.set_defaults(fn=cmd_roll)

    r = sub.add_parser("record", help="shoot a take")
    r.add_argument("key")
    r.add_argument("--url", default=DEFAULT_URL)
    r.add_argument("--compose", action="store_true")
    r.add_argument("--layout", default="fit", choices=("fit", "equal"))
    r.add_argument("--frame", default="1920x1080",
                   type=lambda s: tuple(int(x) for x in s.split("x")))
    r.set_defaults(fn=cmd_record)

    c = sub.add_parser("compose", help="stack a take already shot")
    c.add_argument("dir")
    c.add_argument("--layout", default="fit", choices=("fit", "equal"))
    c.set_defaults(fn=cmd_compose)

    args = ap.parse_args()
    try:
        return args.fn(args)
    except (phonelib.NoDevice, phonelib.NotOnScreen, RuntimeError) as exc:
        print(f"\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
