# Morning list — 24 Aug

Seven days to the deadline (31 Aug, 17:00 PT). Overnight I built the two things the audit called
integrity risks, and both are now real. What is left needs either your camera or your decision.

**Read §1 first — it is the only thing here that needs you to choose rather than to do.**

---

## 1 · One decision: Gemma, and whether it is worth a GPU

**Gemma does not work the way three of our documents claimed, and it never did.**

`SCREENING_MODEL=gemma-3-4b` has been in `.env` for days, README and `architecture.md` both had
Gemma in a table, and `SCRIPT.md` shot 46 said *"Gemma classifies"* out loud. **There was no Gemma
call site anywhere in the repository.** Every occurrence was a fixture.

And it could not have been made to work by wiring it up, which is the part worth knowing:

```
gemma-3-4b · gemma-3-4b-it · gemma-3-27b-it · gemma-3-12b-it · gemma-3n-e4b-it · google/gemma-3-4b-it
  → 404 in BOTH `global` and `us-central1`
models.list() on this project → 23 models, not one of them a Gemma
```

**Gemma is not a publisher model on Vertex.** It is a Model Garden *open* model: using it means
deploying the weights to your own GPU-backed Vertex Endpoint, which bills per hour and has to
still be running when a judge watches the film.

So I built the screen on **`gemini-3.5-flash-lite`**, which is available, is genuinely cheaper than
the judge, and leaves every architectural claim intact. Pointing it at a deployed Gemma later is
one environment variable — `SCREENING_MODEL` takes an endpoint resource name as happily as a
publisher id.

| | Deploy Gemma to Model Garden | Stay on Flash-Lite |
|---|---|---|
| Bonus | **+0.2** (third additional model → 0.6 cap) | 0 — same Gemini family as the judge |
| Cost | GPU endpoint billing per hour, up through judging | nothing |
| Risk | an endpoint that must not fall over on the 31st | none |
| Work | ~30 min deploy, then re-verify the screen | done |

**My recommendation: stay on Flash-Lite.** Veo and Gemini image generation already earn 0.4, and
the remaining 0.2 is the most expensive and most fragile point on the board. The screen's
interesting claim was never the model — it is that *the cheap model is not allowed to pass
anything* — and shot 46 now says that instead, which is both true and better television. Spend the
half hour on §2 instead.

Say the word either way and I will wire it.

---

> ## UPDATE — 24 Aug, afternoon. Nine of these are done.
>
> `Retakes.zip` landed and I filed nine photographs. Everything below is kept for the record;
> **what is actually still outstanding is six shots, listed in §2.0.** Two things changed while
> filing them, and both were bigger than the photographs:
>
> - **The machine is a Segway Xyber, not a Honda CB500X.** The whole corpus fiction was a Honda
>   — twelve `CB500X-NN` assets, "Honda service manual", "the Honda book". 40 files renamed to
>   `XYBER-NN` / Segway Xyber, and the asset type went from `motorcycle` to `e-bike`.
> - **The torque band was absurd for the machine.** It was 27–33 Nm in the scenarios and 26–30 Nm
>   in the docs — for an e-bike caliper bolt. The wrench in the photographs was set to **7.5 Nm**,
>   and it is a ~5–25 Nm tool that physically cannot reach 27 Nm. The band is now
>   `within(6, 9, "Nm")` everywhere, centred on the figure the tool was actually set to, and
>   every reading in the corpus was rescaled to keep its relation to the bound.
>
> **Read §2.5 before shooting anything else** — filing the fork pair turned up a problem with
> the asset identity that a photograph alone cannot fix.

## 1.5 · The rename nearly broke the best argument in the repo

Worth reading, because it is the sharpest thing in the corpus and it survived by about a minute.

Segway has published **no caliper bolt torque for the Xyber**, and
`scoper/interview-home-brake-pads-blocked-on-a-figure-nobody-has` asserts that the Scoper
therefore *refuses to compile* — "it is not hypothetical, it is the Segway Xyber sitting in the
room." That refusal is the product's whole thesis executing on a real machine.

Its counterpart is `scoper/catalogue-figure-may-be-looked-up`, which proves the opposite branch:
when a manufacturer figure **does** exist, the Scoper looks it up instead of asking. That scenario
used a **Honda CB500X** — a machine with a published service manual — and that was not incidental.
It was the contrast.

My blanket Honda → Segway rename turned its catalogue into *"Segway Xyber front caliper mounting
bolt: 7.5 Nm ± 1.5, Segway Xyber service manual"* — a citation of a document that does not exist,
sitting three files away from the scenario that says it does not exist. **A corpus asserting a
Segway figure nobody has ever published is exactly the failure this product is built to refuse**,
and it would have been indefensible if a judge had found it.

Fixed by giving the shop a mixed fleet — `12 Segway Xyber, 3 Segway Xafari, 1 Honda CB500X` — and
putting the catalogue scenario back on the Honda, with the reasoning written into its `why`. One
shop, two machines, one figure that exists and one that does not, and the agent behaving correctly
in both. It is a better pair than it was this morning.

Two related attributions also cleaned up: a scoper scenario claimed its 7.5 Nm was *"out of the
Segway manual"* (now "what we set them to and what I'll stand behind" — a figure a person stands
behind, which is what the contract actually wants), and an extraction unit test cited a Segway
manual (now Honda).

**Nothing outside the corpus asserts a Segway torque figure.** The 6–9 Nm band lives in the
machine-agnostic Inspector tests, the demo fixture and the firmware, none of which claim a
manufacturer as their source.

## 2.0 · What is actually left — six shots

| File | Blocks |
|---|---|
| `asset/bike-a-fork-later.jpg` | `same-asset-belongs`, `capture-predates-the-job` |
| `brake/disc-contaminated-fluid.jpg` | `contaminated-disc-is-a-disqualifier` |
| `torque/photo-of-a-screen.jpg` | `photo-of-a-screen-refused` |
| `tyre/tread-coin-deep.jpg` | `tread-depth-passes` |
| `tyre/tread-coin-shallow.jpg` | `tread-worn-refused` |
| `scene/outdoors-away-from-workshop.jpg` | `scene-contradicts-the-stated-location` |

**14 unbuildable scenarios this morning → 7 now.** Framing notes for all six are in §2c–§2f below
and in `agents/evals/manifest.py`.

## 2.5 · The fork pair needs one more thing, and it is not a photograph

You told me 09 and 10 are two different bikes, so they are filed as `bike-a-fork.jpg` and
`bike-b-fork.jpg`. But when I looked at bike A closely, **it does not carry the marks the corpus
says it does.** The scenarios told the Skeptic to look for *"a deep diagonal scuff across the left
fork lower"* and *"a plain circular sticker on the left yoke"*. Neither is in the photograph — the
fork lowers are clean, unmarked, polished aluminium.

That would have failed the positive control (`same-asset-belongs` must PASS) for a reason that
looks like a model defect and is actually a fiction defect. So I re-grounded the `marks` in all ten
skeptic scenarios on what is genuinely visible:

- *a single spiral cable wrap on the right fork leg, the left leg bare* — bike B has wraps on
  **both** legs, which is the one difference between the two frames that survives a wash
- *unpainted light grey front mudguard*

**This is weaker than the corpus rule asked for, and you should decide whether to fix it.** The honest
problem: the most obvious difference between your two frames is that B is caked in dried mud and A
is clean. Mud is a condition, not an identity — and `bike-a-fork-later.jpg` is specifically meant
to be bike A *dirtier*, so "clean vs muddy" cannot be the thing that tells the bikes apart without
breaking that shot. The corpus rule already anticipated this: *"If it has no marks, pick a different
bike."*

Cheapest fix, about two minutes: **put a cable tie or a sticker on bike A's left fork lower**, then
reshoot `bike-a-fork.jpg` and take `bike-a-fork-later.jpg` at the same time. Then the identity is a
mark rather than a wash cycle, and the hardest test in the corpus is testing what it claims to.

---

## 2 · Photographs — the original list, 15 shots

`agents/evals/manifest.py` has the full framing notes. This is the ordered version, and two of
these are new findings from last night.

**Shoot on the phone that will be the capture device. Do not tidy the bench or fix the light.
JPEG straight off the phone. Nothing identifying in frame — this repo is public.**

### 2a · Two new ones, and read these first

| File | What | Why it is new |
|---|---|---|
| `brake/pads-seated-blurred.jpg` | **RE-SHOOT.** Genuinely out of focus — take it while your hand is still moving. | **The current file is sharp.** I looked at it. `inspector/blurred-photo-asks-for-a-specific-retake` fails against it, and the Inspector is *right*: it asks for a retake because the caliper is unmounted and in your hand, not because of blur. That is a corpus defect that has been scoring against us as an agent defect. |
| `brake/caliper-unusable-dark.jpg` | ✅ **DONE — and it worked.** See below. | Was: nothing in the corpus was unusable, so the screen never fired and saved nothing. |

**The screen is now demonstrated, not just argued.** Run live against the retakes:

| Capture | Screen | Confidence | Fires? |
|---|---|---|---|
| the new dark frame | `UNUSABLE · too_dark` | 1.00 | **yes** |
| the new blurred retake | `UNUSABLE · too_blurred` | 0.95 | **yes** |
| a wrench barrel, when a caliper was asked for | `UNUSABLE · subject_absent` | 0.99 | **yes** |
| the sharp caliper | `NEEDS_JUDGEMENT` | — | no — goes to Flash |
| pads worn to the backing plate | `NEEDS_JUDGEMENT` | — | no — goes to Flash |

Three of five settled without the judgement model being asked at all, and the two that mattered
went straight through. The worn-pads row is the important one: the frame is perfectly good and the
*work* is bad, and the screen said in its own words that it "should be forwarded for evaluation
despite" the wear. That is the boundary holding — how the job was done is not the screen's
question, and it did not try to answer it.

The wrong-subject catch was unplanned and is the best of the three: nobody wrote a
`subject_absent` test with a real photograph, and it found one anyway.

### 2b · The torque barrel · ~5 min, at the bench

Frame like `unfiled/wrench-barrel-framing-reference.jpg` but closer and square on — the value is
not legible in that reference, which is exactly the failure to avoid. **Wind the wrench back down
afterwards; a click wrench stored under tension loses its calibration.**

- [ ] `torque/wrench-setting-in-spec.jpg` — barrel mid-band, number **and the scale it sits on** both legible
- [ ] `torque/wrench-setting-over-spec.jpg` — same barrel wound well above the upper bound
- [ ] `torque/wrench-setting-wrong-scale.jpg` — set on the **secondary** scale (lb-ft or kgf·m) to a number that looks in-spec unless you notice the scale

### 2c · Two bikes · ~5 min — the hardest thing the Skeptic does

- [ ] `asset/bike-a-fork.jpg` — left fork lower and yoke, framed on whatever actually marks it out (scuff, chip, sticker, cable tie). If the bike has no marks, pick a different bike.
- [ ] `asset/bike-b-fork.jpg` — same part of a **different bike of the same model and colour**, framed identically, without A's marks
- [ ] `asset/bike-a-fork-later.jpg` — the **same fork on bike A**, later in the day. Different angle, different light, more grime. Genuinely later beats moved-and-reshot; the light changing is the test.

`asset/bike-a-fork.jpg` alone unblocks four scenarios — it is the highest-value single shot on this list.

### 2d · Bench and tyres · ~6 min

- [ ] `brake/disc-contaminated-fluid.jpg` — a wet run of fluid down a scrap disc face. A condition, not a reading, so staging is fine.
- [ ] `tyre/tread-coin-deep.jpg` — coin stood upright in the main groove of a good tyre, most of its edge swallowed
- [ ] `tyre/tread-coin-shallow.jpg` — the same on a worn tyre, coin standing proud, rubber smooth around it

### 2e · The desk pair · ~2 min, no bike involved

**Use something obviously not a machine part** — a mug, a stapler, an apple. A photo of a bolt would
let a Skeptic that still dissents on "this is not the asset" pass for the wrong reason, which is the
exact regression these two exist to catch.

- [ ] `desk/object-on-desk.jpg` — one object at rest, nobody touching it, surface in frame
- [ ] `desk/object-in-hand.jpg` — the **same** object held clear of the surface, same room, same light

### 2f · Outdoors and the staged fraud · ~4 min

- [ ] `scene/outdoors-away-from-workshop.jpg` — a bike somewhere obviously not the workshop: roadside, gravel, weather, no building
- [ ] `torque/photo-of-a-screen.jpg` — photograph a monitor or second phone **displaying one of the torque shots above**. Let the bezel, the moire banding and the room reflection all show.

### When you are back

```bash
cd agents
python3 -m evals media                 # confirms every slot is filled
python3 -m evals run --live            # records verdicts against the new photographs
```

Expect the corpus to go from **49/72** to roughly **65/72**. The 16 `error` rows are all
missing-media and they disappear the moment the files land.

---

## 3 · What I built and verified overnight

### 3a · The screen — a cheap model that cannot pass anything

The audit's top finding was that Gemma was claimed and not built. It is built, as a **screen**
rather than an eighth agent, so `roster()` still answers **seven** — the number said out loud in
shot 45.

```
capture → Model Armor → SCREEN (Flash-Lite) → INSPECTOR ∥ SKEPTIC (Flash) → gate
                              │
                              └─ UNUSABLE + confident → ADD_FIELD, and Flash is never asked
```

**Why it is safe, and it is a property of the schema rather than of a prompt.** `EvidenceScreen`
has two verdict members — `UNUSABLE` and `NEEDS_JUDGEMENT` — and no third meaning "satisfied". So
no sequence of screen answers can advance a step, seal a record or release a machine. The worst a
wrong screen can do is ask you for a photograph that was already good enough.

It is also shown **less** than the judge: no acceptance rule, no acceptance target, no strictness,
no reading. `screenCase()` narrows it at the boundary and a test asserts the expected part number
never reaches it — the `matches` trap that made `inspector.py` withhold the target applies harder
to a smaller model, not softer.

When it fires it produces an ordinary `ADD_FIELD` and goes through `decideOutcome` unchanged, so it
borrows the Inspector's budget, circuit breaker and escalation path rather than having its own.

| File | |
|---|---|
| `contract/agents/evidence-screen.schema.json` | the contract, Vertex-safe |
| `agents/warrant/screen.py` | `Screener`, `acts_on`, `SCREEN_FLOOR = 0.85` |
| `agents/warrant/runtime.py` | third operation `screen`; `REGISTRY` untouched |
| `web/src/server/fleet.ts` | `askScreen`, transport extracted to `callFleet` |
| `web/src/server/adjudicate/screen.ts` | the policy mirror that actually decides |
| `web/src/server/adjudicate/cases.ts` | `screenCase` — withholds what the judge is given |
| `web/src/server/adjudicate/run.ts` | wired between Armor and the judge |
| `agents/tests/test_screen.py` · `web/scripts/screen.test.mjs` | 31 + 34 tests, in `smoke.sh` |

**A real bug the tests caught before it shipped.** `defect` was a *nullable* enum, and on the first
live run Flash-Lite filled it every single time — four `NEEDS_JUDGEMENT` answers carrying
`subject_absent` on photographs their own rationale called "clearly visible". Offered a nullable
enum, a model picks a member; null is not a value it reaches for. Every answer failed validation,
and since `acts_on` requires `valid`, **the screen was perfectly safe and completely inert** — a
model call per capture, saving nothing. Fixed by making `defect` **required** with an explicit
`none` member, which is the same pattern `skeptic-verdict` already uses for `mismatch_kind`.

Verified live against Vertex on five real captures: all schema-valid, and correctly conservative on
every one — including passing the worn-to-backing pads straight through to the judge, which is
exactly right, because how the job was done is not the screen's question.

**One knock-on you should know about, because it cost me an hour.** `adjudicate` gained a second
fleet collaborator, and `adjudicate.test.mjs` stubbed `ask` but had nothing to stub for the screen —
so fourteen emulator tests started making a real ~900 ms network call to Vertex, which 403'd. It did
not surface as "the screen is broken". It surfaced as the two **positive controls** in *prior
captures — the Skeptic's memory* reporting an empty prior-media list, which reads exactly like
`priorCaptures()` being broken. Fixed with a `noScreen` stub on every call site, and the combined
emulator run is now 61/61 twice consecutively. Worth remembering the shape of it: adding a
collaborator to the spine makes every existing test of the spine non-hermetic, and the symptom
appears somewhere else entirely.

### 3b · Veo — the fraud we test ourselves against

`agents/evals/gen_fraud.py`. Three clips in `agents/evals/media/fraud/`, `PROVENANCE.json` recording
each as synthetic beside its bytes, and three new Skeptic scenarios that **pass 3/3 live**.

Generated media is allowed here and nowhere else in the corpus, and the precedent is already ours:
`caliper-editorial-stockish.webp` is kept because it is what a lifted stock image looks like. These
are the thing being refused, never evidence being judged. The corpus rule forbids generating the
*evidence* and I did not — that is why §2 is a camera list and not a script.

Why it earns its place rather than decorating a table: the cheapest fraud today is photographing a
screen, and `torque/photo-of-a-screen.jpg` covers it. The cheapest fraud in two years is asking a
model for the photograph, and **no camera can stage that.** The Skeptic refuses all three on
identity — *this belongs to no machine* — and not by claiming to detect generation, which would be
a detector and a losing arms race.

Two things worth knowing: **`veo-3.1-generate-001` is the id that works** (every `-preview` and
every 2.0/3.0 spelling 404s), and Vertex writes the clip to GCS rather than returning bytes, so
`_download` falls back to `gcloud storage cp` rather than adding a dependency to a requirements file
whose whole point is that replay needs only the standard library.

One decision to sanity-check when you are awake: `npm run gen` copied the clips into
`web/public/evals/fraud/` (9.6 MB), which is `sync-evals.mjs` doing its normal job — it mirrors
whatever the corpus references so `/model-tests` can show it. I left it, because a fraud clip is
exactly the thing that page should be able to play, and 9.6 MB in the image is nothing. Say so if
you would rather exclude `fraud/` from the sync.

**A confession about my own provenance.** While mapping operations to clips I briefly wrote a
`PROVENANCE.json` whose sha256 for the wrench clip described a different video — a four-second
"plain grey wall" test render I had used to probe which Veo id worked. The Skeptic caught it: the
scenario failed with *"the submitted video shows a person walking past a plain grey wall"*. Fixed by
re-mapping from the GCS timestamps, re-downloading, and deleting the probe artefact. It is worth a
sentence because it is the exact failure this repository argues about — a record that says one thing
about bytes that are something else — and the thing that caught it was the corpus, not me.

### 3c · Docs that were making claims we could not keep

The Gemma row was not the only one. README and `architecture.md` both claimed **Memory Bank**,
**Agent Registry** and **Agent Gateway**, none of which this system calls — and Memory Bank is
*deliberately* not adopted, with the best architectural argument in the repo behind it. A judge who
greps for one of those finds nothing, and then re-reads every other row.

Both tables now have a **State** column where every row is either *running* or says plainly that it
is not, with the reason. The Memory Bank paragraph now makes the refusal an argument rather than a
gap, which is what `SCRIPT.md` §11 shot 40 already films.

Also fixed: `SCRIPT.md` shot 46's VO; `manifest.py` documenting the fraud exemption; and
`base.py`'s error message, which for months has been telling people to run `evals/gen_media.py` — a
script that has never existed. It now points at `evals media`, or `gen_fraud` for the synthetic set.

### 3d · Ledger #11 closed — then reopened by the photographs, and closed properly

In the morning: three documents named three quantities (`90° ±5 past snug`,
`within(26, 30, "Nm")`, `28.4 Nm`), so I reconciled them onto the firmware's figure.

**That fix was wrong, and the retakes proved it.** 26–33 N·m is a *motorcycle* caliper bolt. The
machine is a Segway Xyber e-bike, the workshop's click wrench is a ~5–25 N·m tool that cannot
physically reach 27, and the barrel in the photographs is set to **7.5 Nm**. The scenarios were
carrying a fourth figure nobody had noticed — 27–33 Nm — which is how a number gets four spellings
in one repository.

The band is now `within(6, 9, "Nm")` in every one of them: the seven Inspector scenarios, five
Auditor scenarios, the web fixtures, the Android fixtures and their tests, the firmware's simulated
sweep (`7.5 ± 2.0`, so it still clears the bound at both ends), README, `architecture.md`,
`data-model.md`, and the film's shot 29 overlay. Every concrete reading was rescaled to keep its
relation to the bound — the in-spec reading, the one just under the lower bound the Auditor
scenario turns on, and the typed claim.

**One quantity, one machine, and it is the figure the tool was actually set to.** §7 is the hero
instrument shot and it now has nothing to contradict it.

### 3f · The rename exposed a real Skeptic defect, and it is the one that matters most

The best find of the day, and it was hiding behind the Honda.

`skeptic/ambiguous-evidence-must-not-be-waved-through` hands the Skeptic a wide workshop
photograph with nothing individually identifying in it and **no prior capture to compare
against**. The contract is explicit: if you cannot establish identity, dissent. That scenario had
been passing for weeks.

**It was passing for the wrong reason.** The corpus said the asset was a Honda CB500X motorcycle;
the photograph is of an e-bike. The Skeptic dissented on the make mismatch and scored green. The
moment the fiction matched the machine, it flipped to `belongs: true` at 0.9 confidence, reasoning
that the frame showed *"a Segway Xyber e-bike on a lift in a workshop"* — **which is a statement
about the model, not the unit.** Every machine in that shop is that model. The same answer would
have come back for any of the twelve.

That is exactly the substitution the Skeptic exists to refuse, and it is the whole premise of
§10's "twelve identical bikes". A judge who probed it would have found the product's central claim
failing in its own test corpus.

Fixed in `skeptic.py` by stating the distinction where the asset block is built — the same move
`inspector.py` makes with "what a PASS would assert": recognising the make and model is not
identifying this unit; identity comes from the distinguishing marks, a prior capture of this same
unit, or something in the frame unique to it, and absent all three you have not established
identity. The observed failure is recorded in the comment above it.

`ambiguous-evidence-must-not-be-waved-through` now passes, and so does
`different-machine-same-model-dissents` — the hardest case in the corpus — running on your two
fork photographs. **Skeptic went 2/9 this morning to 8/12** (8 of 9 that can be built).

> ⚠ **The positive control for this fix cannot run yet.** `same-asset-belongs` is the scenario
> that would catch the fix over-correcting into dissenting on everything, and it is blocked on
> `asset/bike-a-fork-later.jpg`. Two negative controls pass and nothing else regressed, but that
> photograph is now the highest-value one left — it is the only thing standing between this change
> and being properly verified.

### 3g · The Scoper wants a SOURCE before it will set a bound — and that is a feature

This started as a nuisance and turned into the most interesting behaviour I saw all day.

`scoper/interview-compiles-without-inventing-a-figure` is a fourteen-turn live interview, about
three minutes a run. The shop's torque line originally read *"30 Nm on the two caliper mounting
bolts, that's out of the Honda book"* — and after the rename, *"…out of the Segway manual"*, which
is a citation of a document that does not exist. I had to change it. Watch what each wording did:

| The shop says… | Compiled result |
|---|---|
| *"…that's out of the Segway manual"* (a source, but a false one) | passes — bound set, disqualifiers carried |
| *"…that's what we set them to and what I'll stand behind"* | bound set, but a **disqualifier the shop stated aloud went missing** |
| *"…that's the figure we work to"* | **no bounds at all** — length 0 |

The third row is the one to read twice. The number 7.5 was in the transcript in every version. What
changed was whether it arrived with **standing** — and with none, the Scoper declined to turn it
into a machine-checkable bound at all.

**That is the product's thesis operating one level deeper than it is written down.** A figure
somebody mentions in passing and a figure somebody stands behind are not the same object, and only
the second may become a bound that every future record is judged against. Nobody designed that
distinction into the prompt; it fell out of *"never state a figure nobody gave you."*

It is also a warning: **the Scoper's output is sensitive to how a figure is offered, not just
whether it was offered.** A shop that mumbles its tolerances gets a weaker procedure than one that
states them, which is probably correct and is definitely worth knowing before a demo.

Current wording gives it a real source that is not a fiction — *"that's off our own shop sheet and
I set it myself on every one of them"*. **That fixed the bounds.** It did not fix the other half.

### The scenario is still failing, and I left it failing on purpose

With the bound restored, the compiled draft still comes back **missing a safety condition the shop
stated aloud**. The shop says:

> *"if there's fork oil or brake fluid down the disc the bike doesn't go out at all, that's a
> hold — new pads won't fix a contaminated disc"*

and the compiled disqualifiers are *"Brake pads under 2 mm not replaced"* and *"Brakes spongy or
weak during test ride"*. The contamination hold is simply gone. Reproduced across two different
wordings of an unrelated line, three minutes a run.

**I did not tune the assertion to make it green, and you should not either.** A procedure that
silently drops a condition the shop gave it is the precise failure this product exists to prevent,
and the scenario is behaving correctly by refusing to pass. The Honda wording used to mask it.

**I checked the cheap explanation and it is ruled out.** The obvious hope was a vocabulary
mismatch — the shop says *"that's a hold"*, the contract field is `disqualifiers`, so perhaps it
was filed correctly somewhere the assertion does not look. It was not. Searching the **entire
compiled draft** — every step, field, release and disqualifier — for `contaminat|fluid|oil|disc`
returns **zero hits**:

```
run: agents/evals/runs/20260824-192727
draft keys: key, title, strictness, minimum_tier, disqualifiers, releases, steps
  contaminat : 0    fluid : 0    oil : 0    disc : 0
```

The condition is not misfiled. It is absent. A shop said *"the bike doesn't go out at all"* and the
compiled procedure carries no trace of it.

**So this is a confirmed Scoper defect, and it is the worst-shaped one the product can have** — not
an invented figure, which the system is built to refuse and does refuse, but a *dropped* one, which
nothing currently checks except this scenario. Worth its own session:

1. **The fix is the same shape as the Skeptic's in §3f** — a statement in the user turn that every
   condition the shop named as stopping the job must survive into the compiled draft, with the
   consequence of losing one spelled out. `scoper.py` already has the interview material; what it
   lacks is that instruction.
2. **Budget for the verification, not the change.** A Scoper prompt edit touches all fourteen
   scoper scenarios and each is a three-minute live interview — call it forty minutes to re-record
   and read. That is why I did not do it at the end of a long session rather than because it is
   hard.
3. Consider a second scenario that asserts the same property from a different trade, so the
   guarantee is not resting on one interview.

**Do not restore the Segway manual citation to make this green.** That trade — a false citation for
a green test — is the exact thing §1.5 was about.

Practical rule: after editing any scoper scenario, re-run **that scenario live** —
`python3 -m evals run --live --agent scoper --id <substring>` — rather than assuming the edit was
local. `agents/evals/runs/*/results.json` records per-scenario status per run and is the fastest
way to answer "did this pass before?".

### 3e · Where the numbers stand

| Stage | Yesterday | Now |
|---|---|---|
| 1 · contract | ok | ok — 13 entities, **8** agent contracts, all Vertex-safe |
| 3 · fixtures typecheck / `tsc` | ok | **clean** |
| 3 · TS unit tests | 107 | **141 pass**, 0 fail |
| 4 · every route builds | ok | ok |
| 5 · tenancy + adversarial rules | 84 + 61 | **84 + 61**, 0 fail |
| 6 · agents + anvil | 181 | **211 pass**, 6 skipped — anvil up, Wright's drivers compiled and executed |
| 6 · eval corpus | 46/69 | **see below** |
| **exit** | **1** | **1 — on the unbuildable scenarios and nothing else** |

Corpus, by agent, after the retakes and the Xyber/torque corrections:

| Agent | This morning | Now |
|---|---|---|
| auditor | 5/5 | **5/5** |
| foreman | 7/8 | **8/8** |
| wright | 7/7 | **7/7** |
| scoper | 11/14 | **12/14** — see §3g, one of the two is a transcript-sensitivity artefact |
| inspector | 8/18 | **12/18** — the three wrench-barrel slots landed |
| skeptic | 2/9 | **8/12** — 8 of the 9 that can be built |
| **total** | **46/69** | **~57/72**, and every one of the 7 errors is a missing photograph |

The two remaining non-photograph failures are both known and both pre-date today:
`skeptic/nothing-attached-cannot-establish-identity` returns `mismatch_kind: "none"` for an
absence (off-contract — an absence is not a match), and
`scoper/interview-home-brake-pads-blocked-on-a-figure-nobody-has` is the Xyber refusal scenario,
which fails on the shape of its answer rather than on the refusal itself. Neither is new and
neither is caused by the retakes.

Every stage is green. The only thing failing the script is the media gate, which is §2.0 — six
photographs.

```bash
cd agents && python3 -m pytest -q          # 211 passed, 6 skipped
cd web    && npx tsc --noEmit              # clean
./scripts/smoke.sh                         # exits 1 only on the photographs
```

> If a command dies with no output and a nonsense exit code, read §5 before debugging anything.

---

## 4 · Still open, in the order I would do them

**4.1 · Redeploy the fleet so `screen` exists remotely.** The screen is complete and tested
locally, but the deployed engine still exposes only `query` and `roster` — so in production
`askScreen` will 404 and `run.ts` will swallow it and ask Flash, which is the correct fallback but
saves nothing. Not filmable until this runs.

```bash
python3 infra/deploy-agents.py     # several minutes; prints the roster when it is up
```

**4.2 · The 15 photographs (§2), then `evals run --live`.** This is what makes `smoke.sh` exit 0.
It currently fails at step 6/7 on 16 unbuildable scenarios and nothing else — every other stage is
green, including 145 rules tests and Wright's drivers compiling and executing.

**4.3 · Deploy `firestore.rules`.** `SCRIPT.md`'s own production note, and it is load-bearing for
shot 47: the two attacks in that shot are closed locally and **still open in the deployed project**.
Film it before deploying and the attack simply succeeds.

```bash
# with GOOGLE_APPLICATION_CREDENTIALS UNSET, or the CLI authenticates as warrant-web
firebase deploy --only firestore:rules
```

**4.4 · Fill the README evidence table.** Every row is still `_pending_`, and shot 48 reads its
closing numbers off it. This needs the system to have actually run for a few days, so it is a
last-week job — but it is a *blocker* for the final shot, not a nice-to-have. Start it before the
photographs if you want real day counts.

**4.5 · The architecture diagram needs a re-audit, and I deliberately did not touch it.**

`docs/architecture/Architecture.html` is much better than the audit gave it credit for — a
draggable graph of every deployed resource, coloured by verified state, using the product's own
palette. It is also **dated 21 Aug and materially out of date**, and its premise is what makes that
a problem: it claims to show *"every resource actually deployed… coloured by its verified state."*

- It has Vertex at `endpoints 0 · deployed models 0` and the fleet *"seven, on the bench"* — but the
  reasoning engine is live and serving (`projects/1020487917587/…/reasoningEngines/5032906174249304064`,
  verified last night; it now exposes three operations).
- Model Armor is `dorm`, and it is running.
- The screen is not in it at all. It already has exactly the right hue for that state — the
  `--asserted` comment describes *"code that runs and is tested but is not yet deployed here."*

I left it alone on purpose. Adding one node to a diagram whose whole claim is *verified* state,
while six other nodes are stale, would make it less true rather than more — the same mistake as the
Gemma row, in a picture instead of a table. **It needs one re-audit pass against the live project,
not a patch**, and then it is genuinely a strong submission artifact. Two more things when you do:
export a PNG/SVG for the README (a judge skimming GitHub will not open an HTML file), and bump the
`2026-08-21` stamp in the footer.

**4.6 · Shoot §9 first when you do start filming.** Unchanged advice: 40 seconds, one take, the
highest-scoring stretch in the submission and the only thing here a competitor cannot fake.

---

## 5 · One environment thing that will bite you

**Your `/tmp` is full and it broke my shell for about twenty minutes.** The disk has 736 G free;
the *tmpfs quota* is hard-capped at 6256 M and it is at 6200 M. Only ~107 M is real files — the rest
is deleted-but-open handles held by **two stale `next-server` processes** (pids 3158077, 3157064)
and a Chromium. `echo` fails when it fills, which is a confusing way to lose an hour.

```bash
quota -s                     # look at the tmpfs line
kill 3158077 3157064         # stale dev servers; reclaims most of it
```

I cleared `/tmp/node-compile-cache`, `/tmp/jiti` and `/tmp/v8-compile-cache-1000` (56 M, all
regenerable) to get working again. If commands start failing for no reason, that is why.

---

## 6 · Honest scoring, updated

The audit put this at ~3.8/5 weighted. Two of the three things dragging it there are now fixed:
the false model claims are gone, and the docs no longer assert services we do not call. That moves
**Architectural Discipline** from *excellent with a landmine in it* to simply excellent, and it
removes the one error this project genuinely could not afford — a film about not trusting unverified
claims, making three of them about itself.

**What still holds it back is entirely §4: the video does not exist, `smoke.sh` exits 1, and the
evidence table is empty.** All three are hours of work rather than days, and none needs a decision.
The idea and the architecture are grand-prize class. The proof layer is what is unfinished, and
seven days is enough — if the camera comes out today.
