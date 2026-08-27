#!/usr/bin/env python3
"""Generate the photography for the customer deck.

Same art direction as `gen_task_images.py` and `gen_podcast_hero.py`, widened to 16:9, so the
deck, the carousel and the podcast frame read as one company rather than three. Held to the
same rules for the same reasons: no text, because a generated sign says nothing and models
garble lettering; no faces, because a stock stranger standing in for a technician is exactly
the fake authenticity this product argues against; no logos, because `docs/rules/rules.md:147`
bars third-party marks.

    python3 scripts/gen_deck_images.py [--force]
"""
import base64, json, os, subprocess, sys, time, urllib.error, urllib.request

PROJECT = os.environ.get("GCP_PROJECT", "warrent-505918")
REGION = "us-central1"
MODEL = "gemini-2.5-flash-image"
OUT = os.path.join(os.path.dirname(__file__), "..", "demo-video", "deck", "img")

DIRECTION = (
    "Editorial photograph, documentary realism, cinematic. Wide 16:9 landscape composition. "
    "One hard directional key light from the upper left, deep unfilled shadow falling right, a "
    "faint cool rim light separating the subject from the background. Muted desaturated palette "
    "— charcoal, gunmetal, worn steel — with at most one restrained warm accent. Shallow depth "
    "of field, background well out of focus. 35mm lens, natural grain, no HDR look. "
    "Generous empty negative space on one side for text to be placed later. "
    "Absolutely no text, no lettering, no numerals, no logos, no brand names, no packaging, no "
    "people, no faces, no hands."
)

SUBJECTS = {
    "clipboard": (
        "A worn metal clipboard holding a blank ruled carbon-copy form, lying face up on a "
        "greasy steel workbench beside a stub of pencil. The paper is smudged and dog-eared. "
        "The form is completely blank — ruled lines and boxes only, no writing of any kind."
    ),
    "safetywire": (
        "Extreme macro of two hexagonal bolt heads joined by twisted stainless safety wire on a "
        "dark machined aluminium housing, the wire catching the key light."
    ),
    "tag": (
        "A small blank unmarked metal inspection tag hanging on a wire loop from a machined "
        "steel component, unlit background falling to black. The tag surface is entirely blank."
    ),
    "torque": (
        "A click-type torque wrench engaged on a large hexagonal fastener deep inside a machine "
        "housing, unbranded, lit by a single worklight from above left."
    ),
}


def token() -> str:
    return subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()


def generate(subject: str, tok: str) -> bytes:
    url = (f"https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT}"
           f"/locations/{REGION}/publishers/google/models/{MODEL}:generateContent")
    body = {
        "contents": [{"role": "user", "parts": [{"text": f"{subject}\n\n{DIRECTION}"}]}],
        "generationConfig": {"responseModalities": ["IMAGE"],
                             "imageConfig": {"aspectRatio": "16:9"}},
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
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
                raise RuntimeError(f"{e.code}: {e.read().decode()[:300]}") from e
            last = e
        print(f"    retry {attempt + 1} after {last}", flush=True)
        time.sleep(3 * (attempt + 1))
    raise last  # type: ignore[misc]


def main() -> int:
    force = "--force" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    tok = token()
    for name, subject in SUBJECTS.items():
        path = os.path.join(OUT, f"{name}.png")
        if not force and os.path.exists(path) and os.path.getsize(path) > 0:
            print(f"  {name}: already present, skipping")
            continue
        print(f"  {name}: generating…", flush=True)
        open(path + ".part", "wb").write(generate(subject, tok))
        os.replace(path + ".part", path)
        print(f"  {name}: {os.path.getsize(path)//1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
