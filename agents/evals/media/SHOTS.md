# The shot list

Eighteen photographs. They are the corpus the Inspector and the Skeptic are tested against,
and they have to be **real photographs** — not renders and not stock.

Three reasons, in order of how much they matter:

1. **A generated instrument display is a fabricated reading.** This is a product whose whole
   claim is that a record is evidence. A synthetic number in the test corpus is the one
   mistake that would be fair to hold against us.
2. Generated imagery is uniformly lit and uniformly sharp. It is wrong in none of the ways a
   workshop phone is wrong, so an agent that passes on it has been tested on nothing.
3. Half these shots are defined by a *defect* — glare across a label, focus missed by a hand
   still moving. Those are properties of a camera in a workshop, not of a prompt.

## How to shoot all of them

- **Use the phone that will be the capture device.** Handheld, workshop light, as it falls.
- **Do not tidy the bench, do not fix the lighting, do not edit afterwards.** JPEG straight
  off the phone. The mess is the point.
- **Nothing identifying in frame** — no faces, no number plates, no customer names, no
  paperwork, no third-party logos where you can avoid them. This repository is public.
- Filenames below are exact. Drop each one at `agents/evals/media/<path>`.
- `python3 -m evals media` tells you what is still outstanding.

**Never type a number that was not on the wrench.** If a shot needs a reading, pull the
reading. Everything else here can be staged; the measurements cannot.

**And there is no reading on a click wrench.** See *The torque shots* below before you shoot
any of them — the four slots were rewritten around the tool this workshop owns, and the
rewrite is the interesting part, not a concession.

---

## 1 · A front brake job, in progress · ~18 min

Do these during a service you were doing anyway. Bike on the stand, wheel out, caliper off.
All four wrench readings come off the caliper mounting bolts, so they happen here rather than
at the bench.

| File | What |
|---|---|
| `brake/pads-seated-sharp.jpg` | New pads seated in the **front** caliper before the wheel goes back on. Close, sharp, both pad faces visible. |
| `brake/pads-seated-blurred.jpg` | The same shot **taken while your hand is still moving.** Genuinely out of focus — do not blur the sharp one afterwards, the artefacts are different and the test would be measuring the wrong thing. |
| `brake/caliper-rear-not-front.jpg` | The **rear** caliper, sharp and well lit, with the swingarm or chain in frame so it is unmistakably the rear. Nothing is wrong with this photo except that it is the wrong component. |
| `label/part-number-legible.jpg` | The printed part code on the pad box, readable. |
| `label/part-number-glare.jpg` | The same label with the overhead light reflecting straight off the code. Label obviously present, code unreadable. |
| `torque/wrench-setting-in-spec.jpg` | The **barrel** of the click wrench set to the middle of the band, square on, the number **and the scale it sits on** both legible. |
| `torque/wrench-setting-over-spec.jpg` | The same barrel wound well above the upper bound. **Wind it back down afterwards** — a click wrench stored under tension loses its calibration. |
| `torque/wrench-setting-wrong-scale.jpg` | The barrel set on the wrench's **secondary** scale — lb-ft or kgf·m, whichever yours carries — to a number that looks in-spec if you do not notice which scale it is. |
| `torque/wrench-on-fastener.jpg` | The wrench engaged on a caliper bolt, wide enough to show it is the right fastener. **Already shot.** |

## 2 · Scrap parts on the bench · ~3 min

| File | What |
|---|---|
| `brake/pads-worn-to-backing.jpg` | Scrap pads worn to or near the backing plate, in a caliper if you have a spare. |
| `brake/disc-contaminated-fluid.jpg` | A wet run of fluid down a disc face. Scrap disc, squirt of brake fluid. This is a *condition*, not a reading, so staging it is fine. |

## 3 · Two bikes, side by side · ~5 min

The hardest thing the Skeptic does is tell twelve identical bikes apart.

| File | What |
|---|---|
| `asset/bike-a-fork.jpg` | The left fork lower and yoke of one bike, framed on **whatever actually marks it out** — a scuff, a chip, a sticker, a cable tie. If it has no marks, pick a different bike. |
| `asset/bike-b-fork.jpg` | The same part of a **different bike of the same model and colour**, framed the same way, without bike A's marks. |
| `scene/workshop-interior.jpg` | A bike on a stand, wide enough to place the scene — bench, tools, floor. |

## 4 · Bike A again, later · ~2 min

| File | What |
|---|---|
| `asset/bike-a-fork-later.jpg` | The **same fork on the same bike**, later in the day or the next day. Different angle, different light, a bit more grime. Identity must still be establishable. Genuinely later is better than moved-and-reshot — the light changing is what makes this a real test. |

## 5 · Outdoors · ~2 min

| File | What |
|---|---|
| `scene/outdoors-away-from-workshop.jpg` | A bike somewhere obviously not the workshop — roadside, gravel, weather, no building. |

## 6 · Tyres · ~3 min

| File | What |
|---|---|
| `tyre/tread-coin-deep.jpg` | A coin stood upright in the main groove of a good tyre, most of its edge swallowed. |
| `tyre/tread-coin-shallow.jpg` | The same on a worn tyre — coin standing proud, surrounding rubber smooth. |

## 7 · One staged fraud · ~2 min

| File | What |
|---|---|
| `torque/photo-of-a-screen.jpg` | Photograph a monitor or a second phone that is **displaying one of the torque shots above.** Let the bezel, the moire banding and the room reflection all show. |

This one is deliberately fake and that is its whole function: it is the cheapest fraud
available, and the Inspector has to refuse it even when the number on the screen is correct.
It is labelled as staged everywhere it appears and it is never evidence of anything.

---

## The torque shots

The wrench here is a **mechanical click type**. You set a bound on the barrel and pull until
it clicks. It has no display and it never reports what the bolt received.

That is not a hole in the corpus. It is the sharpest test in it.

|  | what it is | tier |
|---|---|---|
| A paired instrument notifying a value over BLE | nobody's hand touched the number | **measured** |
| A photograph of a wrench barrel | what the tool was *set to*, before the bolt was pulled | **asserted** |
| A number typed into the app | a claim | **asserted** |

A click wrench setting looks like a measurement from every angle — the number is real, it is
in spec, and it came off the tool in a photograph rather than out of someone's head. It is
still not a measurement, and `inspector/wrench-setting-is-not-a-reading` exists to catch an
agent that cannot tell the difference. Its control,
`inspector/wrench-setting-photo-passes`, shows the honest version: a procedure that asks for
the setting, gets it, and files it as asserted.

The `measured` tier is carried by the BLE reference instrument in `firmware/`, which needs no
photograph at all — the instrument is the evidence. `SCRIPT.md` reaches the same conclusion
from the other end: *"a number in newton-metres arriving from something that is not measuring
torque is a fabricated reading in a film about not fabricating readings."*

**Three shots outstanding, about five minutes with the wrench you already own:** set it in
spec, wind it over spec, then set it on the secondary scale. Frame each one like
`unfiled/wrench-barrel-framing-reference.jpg`, but closer and square on — that reference is
the right composition and the value is not legible in it, which is exactly the failure to
avoid.

## What is already shot

The 2026-08-20 brake session filled **eight** of the nineteen: `brake/pads-seated-sharp`,
`brake/pads-seated-blurred`, `brake/caliper-rear-not-front`, `brake/pads-worn-to-backing`,
`label/part-number-legible`, `label/part-number-glare`, `scene/workshop-interior`
and `torque/wrench-on-fastener`.

Eight more real photographs from that session are in `unfiled/`, with a README saying what each
one is and why it has no slot. Read it before reshooting anything — two of the outstanding
slots were attempted and missed, and it says how.

**The corpus is resized and stripped on the way in.** Long edge 2048, quality 88, all metadata
removed. Not a treatment: the agent inlines each file as base64 into the request, so a 16 MB
phone JPEG exceeds the inline limit outright, and phone EXIF carries GPS — this repository is
public. Content is untouched. The blur, the glare and the workshop light are all as shot.

## Already here

`brake/caliper-editorial-stockish.webp` was generated for the landing page, and that is
exactly why it earns a place: a studio-lit, immaculate product shot is what a lifted stock
image looks like. The Skeptic has to reject it. It is the thing being refused, never
evidence being judged.

## What you do not need to photograph

The timestamp scenario (`skeptic/capture-predates-the-job`) reuses `asset/bike-a-fork-later.jpg`
and changes the recorded capture time in the scenario file. The photograph is fine; the
metadata is the lie, and that is the point of the test.
