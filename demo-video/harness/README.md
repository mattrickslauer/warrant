# demo-video/harness/

**Automated takes for the two split-screen sections.** §9 and §10 are the only shots in
SCRIPT.md that put two surfaces on screen at once, and they are the two where hand-timing
fails: §9 is *"UNEDITED. ONE TAKE. NO CUTS. 40 seconds."* and a split screen assembled from
two hand-started recorders drifts by up to a second.

Everything else in the film is full frame and is shot the way the shot list says. This
harness has no opinion about those.

---

## What it does and does not do

Being precise about this matters more than the takes looking good.

| | |
|---|---|
| **Automated** | Every tap that only exists to advance the app. Every dwell, to the frame. Both recorders, started together and clapped together. The alignment, the pane geometry and the stack. |
| **Still a person** | Holding the phone. Pointing it at the work. Speaking the reason. Anything the camera does. These are `Hands(...)` beats — the harness prints what is needed, waits exactly that long, and moves on. |
| **Never** | The camera and the BLE stack. There is no emulator option here on purpose: §7 and §8 are CameraX and the platform BLE stack against a real instrument, which is exactly what an emulator does not have. |

Every second of a take is therefore either automated or named. Nothing is fudged in
between.

---

## Run it

The app is built `output: standalone`, and `next start` does **not** serve that correctly —
chunks fail and the page half-hydrates, which is a very quiet way to film a broken app. Run
the server Next actually builds:

```bash
cd web
cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public
set -a; . ./.env.local; set +a            # ← or every agent call fails, silently
(cd .next/standalone && PORT=3200 node server.js) &

cd demo-video/harness
./footage.py build-all                # real photographs for the web camera

./take.py list                        # the takes defined
./take.py probe                       # what the phone is showing, with tap targets
./take.py record smoke --compose      # self-check, no hardware, ~20 seconds
./take.py record 9 --compose          # §9 · phone | operator view
./take.py compose takes/9-3           # re-stack a take already shot
```

Takes are numbered and never overwritten — `takes/9-1`, `takes/9-2`. The one you want is
rarely the last one.

Default URL is `http://localhost:3200`; pass `--url` for anything else.\n\nNeeds: `scrcpy`, `adb`, `ffmpeg`/`ffprobe`, and `pip install playwright` with a chromium.
The phone must be unlocked, on adb, and carrying a build of the app:

```bash
cd android && ./gradlew assembleDebug \
  && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

> **Load `.env.local` before starting the standalone server.** `next start` reads env files;
> `server.js` does not. Without it `WARRANT_FLEET_ENGINE` is unset, every adjudication fails
> with *"WARRANT_FLEET_ENGINE is not set"*, no verdict ever lands and no job ever seals — and
> the browser shows none of that, it just sits there. It looks exactly like a slow fleet.

---

## The takes

| key | what it shows | hardware |
|---|---|---|
| `funnel` | A job from the picker to a sealed record beside the operator view filling with the decisions that job is making. **This is the one that demonstrates the product.** | none |
| `9` | §9 — the phone against the operator view, 40s, no cuts | a phone |
| `10` | §10 shot 37 — the brake procedure against the foil procedure | none |
| `smoke` | harness self-check | none |
| `phone-smoke` | harness self-check on real hardware | a phone |

---

## The camera

**The web surface takes real footage. The phone must see reality.**

`./footage.py build-all` turns the eval corpus in `agents/evals/media/` into Y4M clips, and
`web.py` hands one to Chrome as the camera device. `CaptureTile.tsx` is untouched — same
`getUserMedia`, same live stream, same shutter — so what gets filmed is the product's own
capture path with a real photograph of real work in front of it, and the agents rule on the
same images the eval suite rules on.

```python
Pane("web", "technician", BEATS, open_at="/", footage="pads-seated-sharp")
```

Without it the fake device is a rolling test pattern, which photographs as nothing.

**The phone cannot be substituted this way, and should not be.** There is no virtual camera
on a stock Android, but the better reason is that the product forbids the shortcut:
`agents/evals/scenarios/inspector/photo-of-a-screen-refused.json` exists precisely so that
*"a photograph of a monitor showing a photograph of a reading"* never reaches the record —
*"the cheapest fraud available"*. Pointing the phone at a screen showing corpus footage is
the exact fraud §6 is about, and the Inspector is built to refuse it.

So the phone half of §9 is filmed in reality, against real work, and the harness's job there
is to make sure the take runs clean first time: every tap that only advances the app is
automated, and `Hands(...)` names the seconds a person is acting.

---

## The clap, which is the whole trick

Two recorders start independently and neither can say when its first frame actually landed.
scrcpy reports nothing useful about it and Playwright's video begins whenever the browser
context does. Align on wall-clock start times and §9 drifts.

So both panes meet at a barrier, and then each lays down a marker the compositor finds
again by reading the recording back:

- **web** — three white pulses, 160ms on, 160ms off, painted from inside the page.
- **phone** — the app cold-starting, which is the largest scene change a phone screen can
  make. Nothing is installed and the app is not modified. It also guarantees every take
  opens on the same screen, which is worth having on its own.

`compose.py` trims each file by **its own** clap, so whatever each recorder spent warming
up is discarded and the two run on one clock from the first composited frame. Measured on
real hardware: the residual is around two frames.

> **Why the web clap is a pulse train and not one flash.** A page paints white for a moment
> before the dark theme lands, so the head of a web take already contains a white span that
> looks exactly like a marker. The first version of this harness aligned against one of
> those and put the two panes 0.8s apart — the exact failure the clap exists to prevent,
> arriving through the detector instead of the recorder. Three evenly spaced pulses cannot
> be produced by a page load, so the detector matches the rhythm rather than the brightness.

---

## Beats are data

`beats.py` is the file you edit. A shot that runs two seconds long is a two-character
change, not a re-shoot — which is the entire reason to automate this rather than film it
twice.

```python
CHAIN_WEB = (
    W.WaitFor(".fleet__entry", "the operator view has decisions in it"),
    W.Dwell(3.0, "hold the headline count before anything arrives"),
    W.Scroll(420, over=2.0),
    ...
)
```

Web beats: `Goto` `Dwell` `WaitFor` `Click` `Fill` `Scroll`. Scrolling is eased over a
duration rather than jumped, because a cut that teleports reads as a glitch.

Phone beats: `Tap` `TapAt` `WaitText` `Dwell` `Swipe` `Hands`. `Tap` addresses elements by
the text on them, resolved through uiautomator at the moment the beat runs — coordinates
baked in at authoring time survive exactly one layout change. Use `TapAt(fx, fy)` only for
what uiautomator cannot see, and in fractions of the screen rather than pixels.

`./take.py record` warns before rolling if a pane's beats do not sum to the take's length.
The shorter pane is what the composite gets.

---

## Panes are sized from what they are

A portrait phone forced into half of a 16:9 frame is 486 pixels of content with 470 of
black either side. `--layout fit` (the default) gives each pane width in proportion to its
own aspect ratio: against a 1080×2400 phone that is **484 | 1434** in a 1920×1080 frame.

The browser is then recorded at *exactly* the pane width it will occupy, so its text is
never resampled on the way into the composite — the one thing that makes a screen recording
look like a screen recording. `--layout equal` gives two true halves, which is right for
§10 where both panes are web.

Output is ProRes 422 HQ, because this is an intermediate going into an edit and a lossy one
throws away detail the grade still needs.

---

## The web cannot be adjudicated yet — shoot the funnel on the phone

The fleet is deployed and healthy: a direct `query` to the Inspector returns a valid verdict
in ~3s on `gemini-3.5-flash`, and the engine exposes `query, roster, screen` with all seven
agents on the roster. But a capture made on the **web** never reaches Cloud Storage.

`CaptureInput.mediaRef` says it plainly — *"Object URL, data URL, or a storage ref **once
live**"*. The browser writes the capture document and keeps the bytes in the page;
`run.ts` then builds `gs://{bucket}/tenants/{t}/captures/{job}/{capture}` for an object that
was never uploaded, the model fetches it, and the engine raises `404 NOT_FOUND` — which
arrives at the web server as `fleet returned 400`. Every object in the evidence bucket was
put there by Android.

So the step still advances (an unreachable fleet is recorded as a fact, which is the right
behaviour) but no real verdict lands, and a web funnel take shows captures with nothing ruling
on them.

**The phone does the whole loop today.** A capture taken on the handset uploads, the fleet
rules on it, and the decision appears in the operator view within seconds — that is already
proved: a `phone-smoke` take earlier produced a real `SKEPTIC · DISSENT` reading *"the
submitted image is completely black … a covered lens or a blank capture"*, which was the
Skeptic correctly refusing a phone lying face-down on a desk.

That is what §9 was always written to be, and it is the take to shoot. The `funnel` take
below stays useful for everything that does not need adjudication, and becomes a full
demonstration the moment web capture uploads its bytes.

---

## Known rough edges

- **A pane can die with `TargetClosedError`.** Seen once in a dozen runs, from the browser
  side, mid-take. The take is numbered, so re-run it.
- **A failed beat no longer costs you the footage.** Both recorders finalise their file in a
  `finally`, and `take.json` is written even when a pane stops early, so a take that dies at
  beat 7 still composes up to beat 7. It is short, not lost.
- **The fleet branches, and `WaitAny` is how a beat survives it.** A capture the Inspector
  wants more from shows `One more thing needed` instead of advancing the step. That is the
  product working; §9 waits for either.
- **§9's phone beats are a scaffold, not a shooting script.** They were proved end to end
  against the `Cut a banana` card. Swap in whichever procedure is actually being filmed and
  **re-probe** — the carousel snaps, and a card that is off-screen cannot be tapped by name.
- **§10 opens both panes on `/library`.** Shot 37 wants the brake procedure against the foil
  procedure; point each pane at its own procedure URL once the second tenant is seeded.
- **The web clap needs a dark UI to be unambiguous.** `find_flash` reports its confidence
  and `compose.py` warns below 0.35. A white-on-white page would need the pulse count raised.
