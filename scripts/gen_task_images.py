#!/usr/bin/env python3
"""Generate the task images for the carousel with Gemini image generation on Vertex AI.

One art direction, one set of subjects, so the whole carousel reads as one thing. Re-runnable: it skips
anything already on disk. Deliberately no logos, no branding and no faces — the hosted page
is the submission and the contest rules bar third-party trademarks and publicity rights.

    python3 scripts/gen_task_images.py [--force]
"""
import base64, json, os, subprocess, sys, time, urllib.error, urllib.request

PROJECT = os.environ.get("GCP_PROJECT", "warrent-505918")
REGION = "us-central1"
MODEL = "gemini-2.5-flash-image"
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "public", "tasks")

DIRECTION = (
    "Editorial still-life photograph, documentary realism. Single subject, centred, on a dark "
    "charcoal-teal surface. One hard directional light from the upper left, deep unfilled shadow "
    "falling to the right. Muted, desaturated palette — no bright saturated colour except the "
    "subject itself. Shallow depth of field. Shot square-on, 4:3. "
    "Absolutely no text, no lettering, no logos, no brand names, no packaging, no people, no faces, no hands."
)

TASKS = {
    "banana": "A single ripe banana, whole and unpeeled, resting on the surface.",
    "brake": "A motorcycle front brake caliper and disc, unbranded, freshly serviced, resting on the surface.",
    "lightbulb": "A single clear glass incandescent light bulb lying on the surface, filament visible.",
    "tyre": "A close crop of a worn rubber tyre tread with a plain unmarked coin inserted upright into one groove.",
    "pickup": "A single plain unglazed ceramic mug, empty and unmarked, standing alone on the surface.",
    "smile": "A small round hand mirror with a plain unadorned metal rim, lying face-up on the surface, its glass reflecting only empty ceiling.",
}


def token() -> str:
    return subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()


def generate(subject: str, tok: str) -> bytes:
    url = (f"https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT}"
           f"/locations/{REGION}/publishers/google/models/{MODEL}:generateContent")
    body = {
        "contents": [{"role": "user", "parts": [{"text": f"{subject}\n\n{DIRECTION}"}]}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
    # The endpoint 502s intermittently under load. Retry rather than leaving a hole in the set.
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                payload = json.load(r)
            for part in payload["candidates"][0]["content"]["parts"]:
                if "inlineData" in part:
                    return base64.b64decode(part["inlineData"]["data"])
            last = RuntimeError("no image in response")
        except urllib.error.HTTPError as e:
            if e.code < 500:
                raise
            last = e
        print(f"    retry {attempt + 1} after {last}", flush=True)
        time.sleep(3 * (attempt + 1))
    raise last  # type: ignore[misc]


def main() -> int:
    force = "--force" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    tok = token()
    for name, subject in TASKS.items():
        path = os.path.join(OUT, f"{name}.png")
        shipped = os.path.join(OUT, f"{name}.webp")
        if not force and any(os.path.exists(q) and os.path.getsize(q) > 0 for q in (path, shipped)):
            print(f"  {name}: already present, skipping")
            continue
        print(f"  {name}: generating…", flush=True)
        data = generate(subject, tok)
        # Write via a temp file so a failure never leaves a zero-byte image behind.
        tmp = path + ".part"
        open(tmp, "wb").write(data)
        os.replace(tmp, path)
        print(f"  {name}: {os.path.getsize(path)//1024} KB -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
