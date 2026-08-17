# Witness — Architecture

Written 2026-08-17, after verifying two assumptions the earlier design rested on. Both
came back materially different from what we assumed, and the architecture below is what
survives contact with them.

---

## 1. What we checked, and what came back

### Gemini Live API, video input

| Question | Answer | Source |
|---|---|---|
| Frame rate | **Max 1 frame per second.** Frames are sent as individual JPEG/PNG images | [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities) |
| Session length | **Audio + video sessions are limited to 2 minutes** by default | ibid. |
| Context window | 128k tokens for native-audio-output models, **32k for other Live API models** | ibid. |
| Video token cost | ~258 tokens/second of video | [best practices](https://ai.google.dev/gemini-api/docs/live-api/best-practices) |
| Extending a session | Context window compression (server-side sliding window) plus session resumption tokens give unlimited duration | [session management](https://ai.google.dev/gemini-api/docs/live-session) |

**The consequence is large.** One frame per second is not enough to verify motion. A
push-up repetition takes roughly one to two seconds; at 1 fps you get one or two samples of
it, which is not a count, it is a guess. Splice detection is worse — a cut hidden between
two sampled frames is invisible by construction.

**The Live API is the wrong tool for frame-accurate verification.** It is the right tool
for something else, which section 3 uses it for.

### YouTube as an ingest path

This one is unambiguous, and it kills the design as written. The Developer Policies state
you and your clients must not:

> "download, import, backup, cache, or store copies of YouTube audiovisual content without
> YouTube's prior written approval"

and prohibit using "any technology other than YouTube API Services to access or retrieve
API Data." There is **no permitted pathway for a third party to process the video content
of a live stream.** Metadata is a different matter and is fine: broadcast status, start
time, and IDs are ordinary Data API usage, subject to the default 10,000 units/day quota
(extensions require a compliance audit).

**So Witness never ingests from YouTube.** The previous README claim — that we watch the
stream on YouTube rather than hosting it — has to go.

---

## 2. What the constraints force

Both findings push the same direction: **the expensive, high-fidelity work happens at the
edge, and the model is spent selectively.**

That is not a compromise. It is a better design, for three independent reasons.

1. **Fidelity.** The client has the full-rate frames. Nothing downstream ever will.
2. **Provenance.** The client can see where the pixels came from; a server receiving a
   finished stream cannot.
3. **Cost.** Continuous frontier-model attention on every second of every session is
   unaffordable and unnecessary. Most seconds of most sessions contain nothing.

It also resolves the YouTube problem cleanly. The subject's encoder sends the stream to
**two destinations at once** — a normal thing for OBS to do. One copy goes to YouTube for
the public record. One goes to Witness for analysis. We never touch YouTube's copy; we only
ask its API when the broadcast started and whether it is live, which is exactly what the
Data API is for.

**YouTube stops being our ingest and becomes our notary** — an independent party holding a
timestamped copy that neither we nor the subject controls. That was always the valuable
half of the idea.

---

## 3. The architecture

```
  CLIENT (the subject's machine)                    GOOGLE CLOUD
  -----------------------------                     ----------------------------

  +---------------------------+
  | OBS + Witness Kit         |
  |                           |   capture-chain telemetry
  |  - source types           |--------------------------+
  |  - scene switches         |   (obs-websocket)        |
  |  - playback filters       |                          |
  |  - encoder stats          |                          v
  +------------+--------------+                 +------------------+
               |                                |  Warden          |
               | full-rate frames               |  session state,  |
               v                                |  budget ceiling  |
  +---------------------------+                 +--------+---------+
  | Local feature extractor   |                          |
  |                           |   slice embeddings       |
  |  per 250ms slice:         |--------------------------+
  |  - motion / pose deltas   |   ~40 floats @ 4 Hz      |
  |  - scene & colour stats   |   (kilobytes/minute)     |
  |  - audio envelope         |                          |
  |  - perceptual frame hash  |                          v
  +------------+--------------+                 +------------------+
               |                                |  cheap layer     |
               | candidate windows only         |  Gemma + rules   |
               v                                |  over the        |
  +---------------------------+                 |  embedding series|
  | Clip buffer               |                 +--------+---------+
  | short segments, full fps  |--------------------------+ flagged windows
  +---------------------------+   uploaded on demand     v
                                                +------------------+
       +----------------+                       |  Gemini 3.5      |
       | YouTube Live   |<-- second encoder     |  Watcher /       |
       | (notary copy)  |    output             |  Adjudicator /   |
       +----------------+                       |  Skeptic         |
              |                                 +--------+---------+
              | Data API: start time,                    |
              | broadcast status (metadata only)         v
              +---------------------------------+------------------+
                                                |  Registrar       |
                                                |  ladder, signing |
                                                +------------------+
```

### The client connector ("Witness Kit")

An OBS plugin plus a small local process. It does three jobs:

**Capture-chain telemetry.** Over `obs-websocket`: which sources are active and what type
each is, scene switches, filters that alter playback rate, encoder statistics, dropped
frames, stream start and stop. This is the provenance channel described in the README.

**Feature extraction at full frame rate.** Every ~250 ms it emits a fixed-length vector
describing that slice: motion magnitude and direction, pose keypoint deltas if a body is
present, scene and colour statistics, audio envelope, and a perceptual hash of the frame.
Order forty numbers, four times a second. That is kilobytes per minute — it streams
continuously with no meaningful bandwidth or cost.

**A rolling clip buffer.** Short full-rate segments kept locally, uploaded only when
something downstream asks for them.

The client is untrusted. Everything it reports is treated as a claim to be corroborated
against the video, not as ground truth — which is why the clip buffer exists at all.

### The slice series, and what PCA is doing here

The per-slice vectors form a time series: one point per 250 ms, forty-odd dimensions.
Principal component analysis reduces those forty dimensions to something like eight,
keeping the directions along which sessions actually differ and discarding the rest.

Put plainly, and without the maths: **most of those forty numbers move together.** When
someone drops into a push-up, motion magnitude, vertical pose delta, and frame-hash
distance all change at once — they are three views of one underlying event. PCA finds those
underlying directions and gives you a shorter description of the same thing. Nothing is
being predicted or classified; it is compression that preserves what varies.

Four things fall out of it, and they are the reason it is worth doing:

- **Continuity becomes measurable.** A cut, a splice, or a playback-rate change produces a
  discontinuity in the embedding trajectory — an unnaturally large jump between adjacent
  slices, or a variance profile that stops matching the rest of the session. That converts
  "the video looks continuous" from a model's opinion into a measured statistic.
- **Any stream is describable the same way.** The extractor does not know whether it is
  watching push-ups or a fish being measured. The achievement definition lives above this
  layer, which is what makes the fleet domain-agnostic in fact rather than in marketing.
- **Sessions become searchable and comparable.** The embedding is exactly what the Indexer
  needs for semantic search over what happened.
- **The expensive model is aimed.** Candidate windows are found in the cheap series first;
  Gemini only looks where something happened.

The nearest published precedent is in our research catalogue —
[logistic PCA over binary musical features](research/CATALOG.md), which compressed 137
dimensions to 35 while losing almost no discriminative power. The lesson transfers: a
well-chosen low-dimensional embedding is usually enough, and it is far cheaper to store,
index, and compare.

A learned embedding would likely beat PCA eventually. PCA is right to start with because it
is interpretable, requires no training data, and each component can be traced back to the
features that load on it — which matters when a refusal has to be explained.

### Where each model is spent

| Layer | Model | Runs on | Why |
|---|---|---|---|
| Continuous | none — local extractor | every slice | Full frame rate, zero marginal cost |
| Cheap sweep | **Gemma** | the embedding series | Finds candidate windows and anomalies at volume |
| Judgement | **Gemini 3.5**, standard multimodal | flagged clips only | Full-rate segments, not 1 fps — this is where the actual verification happens |
| Conversation | **Gemini 3.5 Live API** | the interactive session | 1 fps is fine for talking; see below |
| Adversarial corpus | **Veo** | offline | Generates staged fraud to attack the Skeptic |

### The agent that joins the session

This is the part the Live API is genuinely right for.

A Witness agent can join a live session the way a participant joins a call — it sees the
stream at 1 fps, hears the audio, and can speak. It is not the verifier. It is the
interface: it greets the subject, confirms the claim being attempted, asks the questions
that need answering before the attempt starts ("show me the full range of motion once so I
know what you're counting"), warns when the framing has drifted out of usable view, and
tells the subject at the end what was recorded.

The two-minute session limit is not a constraint here, because context compression and
session resumption extend it, and because a conversational presence does not need to
remember every frame — it needs to remember the conversation.

Separating this from the verification path matters. **The agent the subject talks to has no
authority over the outcome.** It cannot be sweet-talked into attesting anything, because it
is not the thing that attests.

---

## 4. The verification ladder

A single confidence percentage is not checkable and not honest. Witness reports a **ladder**,
where each rung names something specific that was established. A session sits at the highest
rung whose conditions all hold.

| Rung | Name | What must hold |
|---|---|---|
| **0** | Recorded | A claim was declared and a session existed. Nothing is asserted about it |
| **1** | Observed | Capture chain live throughout; the claim event was seen; no scene switch, playback filter, or source substitution |
| **2** | Continuous | The slice series shows no discontinuity, splice, or rate anomaly across the whole session |
| **3** | Corroborated | At least two independent channels agree — video, capture telemetry, device sensor, second angle |
| **4** | Contested | The Skeptic attacked it with the current adversarial suite and found nothing |
| **5** | Notarised | An independent third party holds a timestamped copy whose start time matches |
| **6** | Attested | A human with authority over the activity signed it |

Rungs are not all reachable for every session. Someone who does not stream publicly cannot
reach 5, and the record should say *"Contested — not notarised, no public copy"* rather than
inventing a number. **A record that says which rung and why is worth more than one that says
92%.**

---

## 5. Assumptions we bake in, and publish

Any system that adjudicates other people's claims should state what it is assuming about
the machinery doing the adjudicating. These go in the record and in the docs, not in a
footnote.

1. **A model's judgement is inferred, never measured.** Anything Gemini concludes about
   whether an event occurred is tagged inferred and can never overwrite a measured value.
2. **The model cannot verify what it cannot see.** Occlusion, bad framing, and darkness
   produce *"not established"*, never a guess. This is the most common cause of escalation
   and that is correct behaviour.
3. **Every decision records its model version, prompt version, and rubric version.** A
   decision that cannot be reproduced cannot be appealed, and an attestation you cannot
   audit is just an assertion.
4. **The Skeptic is only as good as its current attack suite**, and the suite is versioned
   and published. A session marked Contested means *"survived attack suite v4"*, not
   *"unfakeable"*.
5. **We publish our own error rates.** The staged-fraud corpus gives ground truth: we know
   which sessions were rigged because we rigged them. False accepts and false rejects are
   measured against it and published per release.

Point 5 is the one that matters most. A verification product that will not publish its own
false-accept rate is asking to be trusted on exactly the question it exists to settle.

---

## 6. Defining an achievement — the actual open problem

Everything above is machinery. The unsolved question is: **what counts?**

"One hundred push-ups" is not a specification. Does a repetition count if the chest does not
touch? If the hips sag? If there is a thirty-second pause at rep sixty? Is the count over
one continuous set or a session? Every one of those has to be answered before anything can
be verified, and the answers differ by organiser.

### The answer is not a form. It is an interrogation.

An agent takes the organiser's plain-language description and **interviews them until the
ambiguity is gone**, then compiles the result into a machine-checkable rubric:

```
achievement: pushups-strict-v1
  claim:        an integer count
  observable:   descent below parallel, full extension at top, in that order
  disqualifies: pause > 10s between reps
                any scene switch or playback filter
                subject leaves frame for > 2s
  requires:     side-on camera angle, full body in frame
  evidence:     continuous capture chain; rung 3 minimum to publish
```

This interrogation is not a side feature. It is the highest-leverage agent in the system,
because a rubric written by someone who was forced to be precise is the difference between a
verifier and a vibe. It also happens to be exactly what the Collaborative Partner brief
describes — an agent that "asks clarifying questions, guides the user step-by-step, and has
a clear way to capture feedback."

### Should there be a marketplace?

Eventually, obviously — rubrics are worth more when they are shared, and an organiser
running a local derby should not have to define "legal catch" from scratch when a hundred
others already have.

**But do not build a marketplace now.** It is a second two-sided market on top of a system
that has not verified its first session, and cold-starting both sides is how projects like
this die.

Here is the better answer, which costs almost nothing: **a compiled rubric is a versioned,
discoverable artifact, and we already have somewhere to put it.** The Agent Registry exists
to publish, version, and discover approved agents. Model each achievement as a specialised
verifier registered there, and "packaged achievements" stops being a marketplace we have to
build and becomes a capability we get from a component we are required to use anyway.

Ship the compiler. Ship five first-party rubrics. Publish them to the Registry with real
version numbers. The marketplace is then an obvious consequence rather than a prerequisite,
and if it never happens the system still works.

---

## 7. What is still unverified

- **Cost per session in practice.** The token arithmetic looks affordable, but the
  under-a-dollar target is a claim until a real session has been metered end to end.
- **Whether `obs-websocket` distinguishes source types** at the granularity the Corroborator
  needs. High confidence, not yet confirmed against a running instance.
- **Local pose extraction quality** on ordinary webcams in ordinary rooms.
- **Whether the embedding discontinuity signal survives** real-world lighting changes,
  autofocus hunting, and someone walking past the camera. This is the single riskiest
  assumption in section 3, because it is the one holding up rung 2.

The last one should be tested first, on day one, with a deliberately noisy session. If
continuity cannot be measured reliably in a real room, the ladder loses its second rung and
the design needs revisiting before anything else is built.
