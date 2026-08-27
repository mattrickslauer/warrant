#!/usr/bin/env python3
"""Generate the static hero frame for the audio-only interview upload.

The interview video was unusable, so the podcast cut is one still image for 76 minutes.
That image is on screen longer than any other frame this project ships, so it is generated
with the same art direction as the task carousel and held to the same rules: no text, no
logos, no brand marks, no faces. `docs/rules/rules.md:147` bars third-party trademarks, and
a hero shot for an interview about somebody's career must not put a stranger's face on it.

    python3 scripts/gen_podcast_hero.py [--force] [--variants N]
"""
import base64, json, os, subprocess, sys, time, urllib.error, urllib.request

PROJECT = os.environ.get("GCP_PROJECT", "warrent-505918")
REGION = "us-central1"
MODEL = "gemini-2.5-flash-image"
OUT = os.path.join(os.path.dirname(__file__), "..", "demo-video", "bank", "03-john", "hero")

# Same grammar as scripts/gen_task_images.py — one hard key light, deep unfilled shadow,
# desaturated charcoal palette — widened to 16:9 and given depth, because this one has to
# hold a viewer's eye rather than sit in a carousel.
DIRECTION = (
    "Editorial photograph, documentary realism, cinematic. Wide 16:9 landscape composition. "
    "One hard directional key light from the upper left, deep unfilled shadow falling right, "
    "a faint cool rim light separating the subject from the background. Muted desaturated "
    "palette — charcoal, gunmetal, worn steel, with one restrained warm accent from the "
    "worklight. Shallow depth of field, the background falling well out of focus. Shot at "
    "eye level with a 35mm lens, natural grain, no HDR look. "
    "Absolutely no text, no lettering, no numerals, no logos, no brand names, no packaging, "
    "no people, no faces, no hands."
)

SUBJECTS = {
    "bench": (
        "A maintenance technician's workbench at the end of a shift. A heavy beam-type torque "
        "wrench lies across the scarred steel benchtop, a set of feeler gauges fanned open "
        "beside it, a pair of worn leather gloves set down where they were pulled off. The "
        "bulk of a large industrial machine looms far out of focus behind."
    ),
    "locomotive": (
        "The underside of a locomotive traction motor housing seen from a maintenance pit, "
        "heavy unbranded steel castings and cable runs overhead, a single worklight on a hook "
        "throwing one hard shadow across the metal."
    ),
    "panel": (
        "An open industrial electrical control panel, unbranded, dense with wiring looms and "
        "terminal blocks, a technician's insulated screwdriver resting on the sill of the "
        "cabinet where it was left."
    ),
}


def token() -> str:
    return subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()


def generate(subject: str, tok: str) -> bytes:
    url = (f"https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT}"
           f"/locations/{REGION}/publishers/google/models/{MODEL}:generateContent")
    body = {
        "contents": [{"role": "user", "parts": [{"text": f"{subject}\n\n{DIRECTION}"}]}],
        # The aspect ratio is asked for in the config AND in the prompt. The config is what
        # actually binds; the prompt matters because the model composes for the shape it is
        # told about, and a 16:9 frame composed as a square crops badly.
        "generationConfig": {"responseModalities": ["IMAGE"],
                             "imageConfig": {"aspectRatio": "16:9"}},
    }
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
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
                raise RuntimeError(f"{e.code}: {e.read().decode()[:400]}") from e
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
        data = generate(subject, tok)
        tmp = path + ".part"
        open(tmp, "wb").write(data)
        os.replace(tmp, path)
        print(f"  {name}: {os.path.getsize(path)//1024} KB -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
