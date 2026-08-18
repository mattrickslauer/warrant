# SCRIPT.md — the demo video

**4:00 hard cap.** Only the first four minutes are evaluated. The video is 30% of the score
directly and it forms the judge's impression of the other 70%, so treat it as the primary
deliverable and the software as the thing that makes it possible.

**Rules the cut must satisfy** (from `docs/rules/BIBLE.md`):
- Problem overview, value proposition, and a demo of the app in action
- **Must** demonstrate the backend running on Google Cloud — Console, Cloud Run dashboard, Vertex logs, or a `.run` URL on screen
- **One segment must be an unedited, live execution** — "via terminal logs, database updates, or UI changes." This is scored explicitly. Shot 22 is that segment and it is not cut.
- English, or English subtitles
- **No third-party trademarks, logos or slogans.** Motorcycle tank badges count. Frame them out, mask them, or shoot angles that avoid them. This is the easiest way to lose on a technicality.

---

## Tone

Dry, fast, confident. The joke opens the door; the stakes walk through it.

Reference feel: the cold open of a good product film crossed with a workshop documentary.
Kinetic but not frantic. Every cut lands on a beat. No corporate warmth, no stock-music
uplift, no "in today's fast-paced world."

**The rule for the whole piece:** never say a thing the picture can show. The voice-over
carries argument only. The screen carries evidence.

### Sound design

The motif is **mechanical**. Build the score out of workshop sounds — ratchet clicks, an
impact driver, a chain, a bike turning over — quantised into rhythm. Then:

- **The relay click** is the signature sound. Establish it early, use it as the punctuation
  on every verified milestone, and let it land alone in the final beat.
- **The refusal** gets the opposite: everything drops out. Silence, then one flat tone.
- Music: minimal, percussive, sub-heavy. Something modern and slightly cold. It should feel
  like a system working, not like a company advertising.

### On-screen text

Agent reasoning appears as clean monospace overlays anchored in the real space — the
timelapse-with-thoughts idea. Keep them short enough to read in one pass. They do the
explaining so the voice-over doesn't have to.

---

## Shot list

### COLD OPEN — the departments (0:00–0:18)

| # | Time | Visual | Audio / VO |
|---|---|---|---|
| 1 | 0:00 | Hard cut in. Tight on a desk phone ringing. Hand answers. **You**, in a hi-vis vest: "Maintenance." | Phone ring. Room tone. |
| 2 | 0:03 | Whip-pan to the same desk, different angle. **You**, glasses, cardigan: "Purchasing." | Ring cuts off mid-tone. |
| 3 | 0:05 | Same. **You**, apron, oil on hands: "Parts." | Ring. |
| 4 | 0:07 | Same. **You**, reading glasses, calculator: "Accounts." | Ring. |
| 5 | 0:09 | Same. **You**, blazer: "Insurance." | Ring. |
| 6 | 0:11 | Wide, finally revealing the whole workshop. One desk. Five phones. All ringing. You, in the middle, in a plain t-shirt. | All five ring at once, then **cut to silence.** |
| 7 | 0:14 | You look directly at camera. Beat. | VO: *"It's a twelve-bike rental company. I'm all of it."* |

> **Note:** shoot 1–5 identically — same lens, same mark, same framing — so the only thing
> that changes is you. The cut does the joke. Do not act it; play it flat.

### THE TURN — what's actually at stake (0:18–0:45)

| # | Time | Visual | Audio / VO |
|---|---|---|---|
| 8 | 0:18 | Slow push on a maintenance logbook. A biro tick in a box. | VO: *"So when a bike goes out, somebody checked the brakes."* |
| 9 | 0:23 | Cut to a customer riding away. Beautiful. Wide, low sun. | VO: *"Me. Probably. I think."* |
| 10 | 0:27 | Hold on the empty road after they've gone. Let it sit a second too long. | Music drops out. Wind only. |
| 11 | 0:31 | Archive-feel insert: an aircraft maintenance logbook, a technician's signature, a part tag. *(Use own footage or licensed material — no logos.)* | VO: *"Airlines never have this problem. Every part has a paper trail. Every job has a signature. The logbook is legally binding — and it works."* |
| 12 | 0:40 | Cut back to your biro tick. Same framing as shot 8. | VO: *"It also costs more than my motorcycle."* |

### THE SYSTEM (0:45–1:05)

| # | Time | Visual | Audio / VO |
|---|---|---|---|
| 13 | 0:45 | Hands mount the 360 camera to a tripod in the middle of the workshop. Click. | **First relay-click motif.** Music re-enters, percussive. |
| 14 | 0:49 | 360 footage: the "tiny planet" reframe, then whip into a normal view. The whole workshop, one shot, nothing off-frame. | VO: *"So I built the airline's system. For a dollar."* |
| 15 | 0:54 | Fast cutaways: ESP32 node on the door, sensor on the bench, the Pi's LED. | VO: *"Eight agents. One camera that can't be pointed away from anything."* |
| 16 | 0:59 | Clean graphic: the eight agents as a fleet, each with its one job. Hold 4s — long enough to read, not to study. | Beat drop on the graphic. |

### THE LOOP — a bike goes out and comes back (1:05–2:05)

| # | Time | Visual | Audio / VO |
|---|---|---|---|
| 17 | 1:05 | Customer arrives. 360 capture spins around the bike. Overlay: `PRE-RENTAL — condition baseline captured — 14 surfaces` | VO: *"Every bike gets photographed before it leaves. Not by me — I'd forget."* |
| 18 | 1:14 | Riding footage. Give it 6 seconds and make it gorgeous. This is the breath before the work. | Music opens up. |
| 19 | 1:20 | Bike returns, dusty. 360 capture again. | Music tightens. |
| 20 | 1:25 | **The diff.** Split screen, before and after, the system pushing in on one panel. Overlay: `NEW — right fairing, 40mm — not present at handover` | Single sharp hit on the find. |
| 21 | 1:33 | The proposed charge appears. Your finger hovers. **You approve it.** Overlay: `PROPOSED $180 · REQUIRES HUMAN APPROVAL` | VO: *"It finds the damage. It doesn't get to charge anyone. That's mine."* |

### THE CHAIN — unedited, live (2:05–2:35)

| # | Time | Visual | Audio / VO |
|---|---|---|---|
| 22 | 2:05 | **UNEDITED. ONE TAKE. NO CUTS. 30 seconds.** Screen recording: the damage closes into a work order → the parts graph lights the four components the job consumes → two in stock, one on 21-day lead → the purchase order drafts itself → the service date moves to when the part lands. Terminal or trace visible alongside. | VO, over the top, unhurried: *"One damage report. Four agents. Nobody typed anything."* Then **let it play with no VO for the last 12 seconds.** |

> **This shot is scored directly** — "does the video show an unedited, live execution."
> Rehearse it until it runs clean, then record it in one pass. If it errors, record it again;
> do not cut around a failure.

### THE REFUSAL — the climax (2:35–3:00)

| # | Time | Visual | Audio / VO |
|---|---|---|---|
| 23 | 2:35 | Different bike. A customer waiting, helmet in hand. You reach for the keys. | Music at full. |
| 24 | 2:40 | Screen: `BIKE 07 — SERVICE LOGGED, NOT VERIFIED — WITHHELD` | **Everything cuts to silence.** One flat low tone. |
| 25 | 2:45 | Hold on your face. Then you put the keys back. | Silence. |
| 26 | 2:49 | Cut to the workshop 360 record, scrubbing back: the bay is empty for the whole window the service was supposedly performed in. | VO, quiet: *"The record said it was serviced. The room said nobody was in it."* |
| 27 | 2:55 | Customer gets a different bike. Small, human beat — a nod, a thumbs up. | Music returns, softer. |

> **This is the emotional centre of the film.** Not the verification — the refusal. It is the
> only beat in the whole piece where the system protects somebody who has no idea it exists.

### GOOGLE CLOUD — required, 30% (3:00–3:25)

| # | Time | Visual | Audio / VO |
|---|---|---|---|
| 28 | 3:00 | Real screen recording, moving with purpose: Cloud Console → Agent Engine deployments → the eight agents listed in Agent Registry. | VO: *"Every agent is registered, identified, gated and armoured by Google's own platform."* |
| 29 | 3:09 | Cloud Run services. Pub/Sub topics firing. A live `.run` URL in the address bar. | Percussive stabs on each cut. |
| 30 | 3:15 | Cloud Trace: an end-to-end reasoning chain across four agents, expanding. | VO: *"Every decision it made is traceable to the model version that made it."* |
| 31 | 3:20 | Model Armor redacting a face and a plate in the inspection footage, live. | VO: *"Including the ones about your face."* |

### THE LEDGER (3:25–3:45)

| # | Time | Visual | Audio / VO |
|---|---|---|---|
| 32 | 3:25 | Timelapse: the workshop over thirteen days. Bikes in, bikes out, light cycling. Agent overlays flickering past too fast to read individually. | Music builds. |
| 33 | 3:35 | Numbers land one at a time, hard cuts: `NN inspections` · `NN verified` · `NN refused` · `NN days unattended` · **`$X.XX total`** | Each number lands on a beat. |

> Fill from the running system. The spend figure is the detail that gets retold — if it is
> genuinely small, give it its own beat and let it hang.

### CLOSE (3:45–4:00)

| # | Time | Visual | Audio / VO |
|---|---|---|---|
| 34 | 3:45 | Back to the five phones from shot 6. Silent now. | VO: *"I'm still every department."* |
| 35 | 3:50 | You walk out of the workshop. The 360 camera keeps running behind you. | VO: *"I'm just not the only one paying attention."* |
| 36 | 3:55 | Black. Title. One line: what it is, and where the public log lives. | **One relay click. Out.** |

---

## Production notes

**Shoot while it runs, not after.** The 25–29 window is when real inspections happen. Every
one is footage you cannot recreate on the 30th. Roll on all of them, even the boring ones.

**Capture in segments with clean heads and tails.** A four-minute cut assembles from beats.
The exception is shot 22, which is continuous by requirement.

**The refusal has to be real.** Do not stage bike 07. Let a genuine unverified service sit,
and film what the system does. If it never happens naturally, create the condition honestly —
skip a verification — and say nothing that implies otherwise.

**Three things to bank early, in case the last week goes wrong:**
1. The cold open (shots 1–7) — shootable any time, entirely under your control
2. The riding footage (18) — needs good light more than it needs the system working
3. The Cloud Console sequence (28–31) — needs deployment, not evidence

**What you already own that most entrants don't:** an α7 III, a 360 rig, a real workshop,
real customers, and the ability to actually direct this. Use the production values. A judge
watching their fortieth submission of the day will notice within five seconds.

---

## Alternative cold opens, if the department joke doesn't land in the edit

**A. The tick.** Open tight on the biro ticking the box. Hold. Then reveal nobody was in the
workshop that day. Colder, faster to stakes, loses the charm.

**B. The keys.** Open on the refusal — keys going back in the drawer, customer waiting. Then
rewind the whole film to explain it. Strongest hook, but it spends the climax in the first
ten seconds.

**C. Aircraft first.** Open on the aviation logbook and the part tag, then hard cut to your
biro. Makes the thesis explicit immediately. Most serious, least memorable.

The department joke is the recommendation. It is the only one of the four that a judge will
still be able to describe to a colleague a week later.
