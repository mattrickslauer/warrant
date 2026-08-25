"""Veo, generating the fraud the Skeptic is tested against.

    python3 -m evals.gen_fraud --dry-run     # what it would ask for, and why
    python3 -m evals.gen_fraud               # generate what is missing
    python3 -m evals.gen_fraud --force       # regenerate everything

WHY GENERATED MEDIA IS ALLOWED HERE AND NOWHERE ELSE IN THE CORPUS.

`evals/manifest.py` is emphatic that evidence must be real photographs, and the first reason it
gives is the one that matters: *"a generated instrument display is a fabricated reading… a
synthetic number in the test corpus is the one mistake that would be fair to hold against
us."* That rule is not relaxed by this file. Nothing generated here is ever evidence of
anything, is ever judged by the Inspector, or ever satisfies an acceptance rule.

These files are the ATTACK. The precedent is already in the repo:
`brake/caliper-editorial-stockish.webp` was generated, and the corpus keeps it precisely
because *"a studio-lit, immaculate product shot is what a lifted stock image looks like. The
Skeptic has to reject it. It is the thing being refused, never evidence being judged."* Every
file this script writes is in that category, and `PROVENANCE.json` records it as synthetic
next to the bytes so nobody can later mistake one for a photograph.

WHY IT IS WORTH GENERATING AT ALL, rather than staging more fraud with a camera.

The cheapest fraud available today is photographing a screen, and `torque/photo-of-a-screen.jpg`
covers it. The cheapest fraud available in two years is asking a model for the photograph, and
no camera can stage that — a real clip of a real caliper is a real clip of a real caliper
however it is framed. Generated evidence is a genuinely new attack on a maintenance record and
it is the one attack this product will certainly face, so the corpus has to contain it and the
Skeptic has to refuse it.

WHAT THE SKEPTIC IS BEING ASKED. Not "is this AI-generated" — that is a detector, it is a
losing arms race, and it is not what the contract asks. The question is the one the Skeptic
always asks: does this evidence belong to THIS machine, on THIS job, at THIS moment? A
generated clip belongs to no machine. It carries none of the asset's marks, and the honest
dissent is `asset` or `scene`, not a claim about the pixels' origin. A Skeptic that refuses
these for the right reason also refuses next year's better generator; one that refuses them
by spotting artefacts does not.

COST. Veo is billed per second of video and this asks for a handful of short clips. It is
offline, run by hand, and nothing in the test suite or the deployed product depends on it —
`python3 -m evals run` replays cassettes and never calls this.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

MEDIA = Path(__file__).resolve().parent / "media"
FRAUD = MEDIA / "fraud"
PROVENANCE = FRAUD / "PROVENANCE.json"

#: Veo, on Vertex.
#:
#: `veo-3.1-generate-001` is the id this project actually serves, verified by calling it. The
#: distinction matters more than it looks: a wrong Veo id returns
#:
#:     404 Publisher model `…/models/veo-3.1-generate-preview` was not found or your project
#:         does not have access to it
#:
#: which reads exactly like Veo being unavailable to the project. It is not — every `-preview`
#: spelling and every 2.0/3.0 spelling 404s here while `veo-3.1-generate-001` starts an
#: operation immediately. Probing by calling is free when the answer is 404, because nothing is
#: generated, so the way to settle this is to try the id rather than to read a docs page.
VEO_MODEL = os.environ.get("VEO_MODEL", "veo-3.1-generate-001")
PROJECT = os.environ.get("GCP_PROJECT", "warrent-505918")
#: Veo on Vertex is regional and is NOT published to the `global` endpoint the Gemini 3 family
#: uses, so this deliberately does not read GEMINI_LOCATION.
VEO_LOCATION = os.environ.get("VEO_LOCATION", "us-central1")
#: Vertex writes the result to Cloud Storage for some model versions and returns bytes inline
#: for others. Both are handled; this is only used when the service asks for a destination.
OUTPUT_BUCKET = os.environ.get("VEO_OUTPUT_BUCKET", f"gs://{PROJECT}-agents/veo")

POLL_SECONDS = 15
POLL_LIMIT = 40           # ten minutes; Veo is slow and a stalled operation should say so


@dataclass(frozen=True)
class Fraud:
    slug: str
    #: What Veo is asked for. Deliberately describes a PLAUSIBLE workshop clip and never
    #: mentions a number, a gauge reading or a part label — a generated instrument display
    #: would be a fabricated reading, which is the one thing the corpus forbids outright.
    prompt: str
    #: Why the Skeptic must refuse it, in the words the scenario asserts against.
    refused_because: str
    seconds: int = 6

    @property
    def path(self) -> Path:
        return FRAUD / f"{self.slug}.mp4"


FRAUDS: tuple[Fraud, ...] = (
    Fraud(
        slug="generated-caliper-clip",
        prompt=(
            "Handheld close-up video, shot on a phone, of a motorcycle front brake caliper "
            "with new brake pads seated in it, wheel removed, bike on a paddock stand in a "
            "small workshop. Cluttered bench and tools blurred in the background, mixed "
            "overhead fluorescent and daylight, slight camera shake, no people in frame, no "
            "text or numbers visible anywhere."
        ),
        refused_because=(
            "It carries none of XYBER-07's marks — no scuff on the left fork lower, no "
            "sticker on the yoke — so it cannot be established as this machine."
        ),
    ),
    Fraud(
        slug="generated-workshop-scene",
        prompt=(
            "Handheld video panning slowly across a small motorcycle workshop: one bike on a "
            "stand, a workbench with hand tools, concrete floor, roller door partly open. "
            "Ordinary daylight, phone camera, slight shake, nobody in frame, no signage and "
            "no readable text."
        ),
        refused_because=(
            "A generic workshop that is not the workshop this job names, with nothing in it "
            "tying the scene to the asset or the job."
        ),
    ),
    Fraud(
        slug="generated-wrench-on-fastener",
        prompt=(
            "Handheld close-up video of a plain chrome socket wrench engaged on a bolt head on "
            "a motorcycle brake caliper mount, a gloved hand steadying it, workshop light. "
            "The wrench barrel is out of frame. No dials, no displays, no numbers and no "
            "text anywhere in shot."
        ),
        refused_because=(
            "A tool on a fastener that could be any fastener on any machine. Nothing in the "
            "frame identifies the asset, and the barrel — the only thing that would carry a "
            "setting — is deliberately not shown."
        ),
    ),
)


def _client():
    from google import genai
    return genai.Client(vertexai=True, project=PROJECT, location=VEO_LOCATION)


def _save(video, dest: Path) -> int:
    """Bytes to disk, whichever way Vertex chose to hand them over."""
    data = getattr(video, "video_bytes", None)
    if data:
        dest.write_bytes(data)
        return len(data)

    uri = getattr(video, "uri", None)
    if not uri:
        raise RuntimeError("the operation returned a video with neither bytes nor a uri")

    # Written to Cloud Storage instead, which is what Veo on Vertex does whenever
    # `output_gcs_uri` is set. Pull it down rather than leaving the corpus pointing at an
    # object: the eval harness inlines media from disk, so a gs:// path in a scenario would
    # make offline replay depend on a bucket and a credential.
    return _download(uri, dest)


def _download(uri: str, dest: Path) -> int:
    """A gs:// object onto disk, without adding a dependency to replay the corpus.

    `google-cloud-storage` is tried first and is NOT in `requirements.txt` on purpose — the
    whole point of that file is that replaying the suite needs nothing but the standard
    library, and a generator run by hand three times ever does not get to change that. So the
    fallback is `gcloud storage cp`, which is the same tool `model.py` already falls back to
    for a credential and is therefore already assumed present by anyone deploying this.
    """
    try:
        from google.cloud import storage
        bucket, _, blob = uri.removeprefix("gs://").partition("/")
        storage.Client(project=PROJECT).bucket(bucket).blob(blob).download_to_filename(str(dest))
        return dest.stat().st_size
    except ImportError:
        pass

    proc = subprocess.run(["gcloud", "storage", "cp", uri, str(dest)],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"could not fetch {uri}: {proc.stderr.strip()[:300]}. The clip IS generated and "
            f"is sitting in the bucket — copy it to {dest} by hand rather than paying to "
            f"generate it again.")
    return dest.stat().st_size


def generate(fraud: Fraud, *, force: bool) -> dict | None:
    """One clip. Returns its provenance row, or None if it was already there."""
    if fraud.path.exists() and not force:
        print(f"  have    {fraud.slug}.mp4")
        return None

    from google.genai import types

    print(f"  asking  {fraud.slug} — {fraud.seconds}s, this takes a few minutes")
    client = _client()
    config = types.GenerateVideosConfig(number_of_videos=1,
                                        duration_seconds=fraud.seconds,
                                        output_gcs_uri=OUTPUT_BUCKET,
                                        # Nobody in frame, in every clip. These files live in
                                        # a public repository and a generated likeness is a
                                        # publicity-rights problem nobody needs; the prompts
                                        # say "no people" as well, and this enforces it.
                                        person_generation="dont_allow")
    # `source=` rather than `prompt=`. The bare prompt argument is deprecated in google-genai
    # 2.19 with a removal date already behind us, and it warns on every call.
    operation = client.models.generate_videos(
        model=VEO_MODEL, source=types.GenerateVideosSource(prompt=fraud.prompt), config=config)

    for _ in range(POLL_LIMIT):
        if operation.done:
            break
        time.sleep(POLL_SECONDS)
        operation = client.operations.get(operation)
    else:
        raise RuntimeError(
            f"{fraud.slug}: still running after {POLL_LIMIT * POLL_SECONDS}s — check the "
            f"operation in the console rather than assuming it failed")

    if getattr(operation, "error", None):
        raise RuntimeError(f"{fraud.slug}: {operation.error}")

    videos = getattr(operation.response, "generated_videos", None) or []
    if not videos:
        # Veo refuses prompts its own filters dislike, and a refusal is not a crash. Say which
        # so the prompt can be rewritten rather than the script retried.
        raise RuntimeError(
            f"{fraud.slug}: the operation finished with no video — most likely a safety "
            f"filter on the prompt. Response: {operation.response}")

    FRAUD.mkdir(parents=True, exist_ok=True)
    size = _save(videos[0].video, fraud.path)
    digest = hashlib.sha256(fraud.path.read_bytes()).hexdigest()
    print(f"  wrote   {fraud.slug}.mp4  {size / 1_000_000:.1f} MB")

    return {
        "file": f"fraud/{fraud.slug}.mp4",
        "synthetic": True,
        "never_evidence": "Generated. The thing being refused, never evidence being judged.",
        "model": VEO_MODEL,
        "location": VEO_LOCATION,
        "prompt": fraud.prompt,
        "duration_seconds": fraud.seconds,
        "sha256": digest,
        "bytes": size,
        "refused_because": fraud.refused_because,
    }


def write_provenance(rows: list[dict]) -> None:
    """Provenance beside the bytes.

    The corpus is evidence about the agents, so the corpus itself needs the property the
    product demands of everything else: you can tell where each file came from. A generated
    clip with no record saying so is exactly the failure mode this repository argues against.
    """
    existing = {}
    if PROVENANCE.exists():
        existing = {r["file"]: r for r in json.loads(PROVENANCE.read_text())["files"]}
    for row in rows:
        existing[row["file"]] = row
    PROVENANCE.write_text(json.dumps({
        "//": "SYNTHETIC MEDIA. Generated by Veo for `python3 -m evals.gen_fraud`. Every file "
              "here is an ATTACK the Skeptic must refuse. None of it is evidence, none of it "
              "is judged by the Inspector, and none of it satisfies any acceptance rule. See "
              "the module docstring and evals/manifest.py.",
        "generator": "agents/evals/gen_fraud.py",
        "files": sorted(existing.values(), key=lambda r: r["file"]),
    }, indent=2) + "\n")
    print(f"\nprovenance → {PROVENANCE.relative_to(MEDIA.parent)}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="print what would be asked for, and call nothing")
    ap.add_argument("--force", action="store_true", help="regenerate clips already on disk")
    ap.add_argument("--only", metavar="SLUG", help="just this one")
    args = ap.parse_args(argv)

    wanted = [f for f in FRAUDS if not args.only or f.slug == args.only]
    if not wanted:
        print(f"no fraud named {args.only!r}; have: "
              f"{', '.join(f.slug for f in FRAUDS)}", file=sys.stderr)
        return 2

    print(f"Veo   {VEO_MODEL} @ {VEO_LOCATION}")
    print(f"into  {FRAUD}")
    print("\nEVERY FILE BELOW IS AN ATTACK, NEVER EVIDENCE.\n")

    if args.dry_run:
        for f in wanted:
            mark = "have" if f.path.exists() else "want"
            print(f"  {mark}    {f.slug}.mp4  ({f.seconds}s)")
            print(f"          prompt:  {f.prompt[:96]}…")
            print(f"          refused: {f.refused_because}\n")
        return 0

    rows: list[dict] = []
    failed: list[str] = []
    for f in wanted:
        try:
            row = generate(f, force=args.force)
        except Exception as e:                       # one bad prompt must not lose the others
            print(f"  FAILED  {f.slug}: {e}", file=sys.stderr)
            failed.append(f.slug)
            continue
        if row:
            rows.append(row)

    if rows:
        write_provenance(rows)
    if failed:
        print(f"\n{len(failed)} failed: {', '.join(failed)}", file=sys.stderr)
        return 1
    print("\nok — now add or update the scenarios that use these, then "
          "`python3 -m evals run --live` to record verdicts against them")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
