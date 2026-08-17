# Witness

**A fleet of agents that watches something happen, and refuses to say it did.**

> **Working name.** `Witness` is the job description — someone present at an event whose
> account of it can be relied upon. Change it before submission if something better lands.

---

## Why this exists now

For a century, a recording was proof. You could put a photograph in front of a jury, a
tape in front of a regulator, a video in front of a referee, and the argument was over.

That is ending. Generated video is now good enough that "I have it on camera" is no longer
an answer, and the obvious response — build better fake-detectors — is a race that cannot
be won, because every detector becomes training material for the next generator. Forensics
is the wrong shape for this problem. It arrives after the fact, examines an artifact whose
custody it cannot vouch for, and gets a little weaker every year.

**The way out is not better forensics. It is presence.**

You do not need to prove a recording is authentic if an independent observer was watching
while the event happened and lodged its account, at the time, somewhere neither party
controls. A contemporaneous witness cannot be retroactively faked. That is how humans have
always settled contested facts — not by examining artifacts, but by asking someone who was
there.

The reason nobody built this before is that being there is expensive. Watching is the most
labour-intensive thing you can ask a person to do, and it does not scale. It scales now.
Models can watch continuously, attention can be metered by the minute, and the cost of
having something present for an entire event has fallen from a salary to a rounding error.

**Witness is what you build once watching becomes cheap: an independent observer you can
afford to have present at everything that matters.**

---

## The problem, concretely

There is an enormous class of claims that are true, consequential, and impossible to prove
cheaply.

A tournament angler says the fish was nineteen inches. A field technician says the install
was completed to spec. A remote student says they sat the exam alone. Someone running a
charity challenge says the hundred reps happened. In each case money, standing, or trust
depends on the claim, and the only way to check it is for a person to have been there.

So one of three things happens. The organiser pays for officials, which most cannot
afford. They trust the claim and absorb the fraud. Or they demand so much evidence that
honest people give up and stop participating.

**The person this hurts most is not an enterprise.** It is whoever runs a competition, a
programme, or a certification with real stakes, no budget for officials, and no
institution standing behind them — and who is therefore forced to choose between being
cheated and being unreasonable.

---

## What Witness does

A claim is declared up front. A session opens. Agents attach over a live connection and
watch in real time. When the session closes, exactly one of three things exists:

| Outcome | Meaning |
|---|---|
| **Attested** | Independently corroborated, with the observations and their timestamps attached |
| **Refused** | The evidence does not support the claim, and the record says which part failed |
| **Escalated** | Genuinely ambiguous — routed to a human, with the specific question isolated |

The record is signed, permanent, and semantically searchable. Not by title or tag —
by **what the agents saw**. *"Every attested session where the last ten reps degraded below
depth."* *"Every refusal caused by a discontinuity in the stream."*

**The most valuable thing the fleet produces is the sessions it will not certify.** Anything
can issue a certificate. The product is the refusal, and the ability to show precisely why.

---

## What makes something verified

Verification is not a score and it is not a clip. **It is an elimination.**

Witness never claims a declared thing is true. It closes off the ways it could be false,
and then states exactly which ways it closed. A record that says *"92% confident"* is not
checkable by anyone. A record that says this is:

| The fleet establishes | Class |
|---|---|
| The stream was continuous — no cut, no splice, no rate change | **measured** |
| The same subject was present throughout | **measured**, then the means of knowing is discarded |
| The environment stayed consistent — light, shadow, background | **measured** |
| The claim event was observed *n* times, at these timestamps | **inferred** |
| An independent source agrees — device sensor, second angle, host timestamps | **measured** |
| The Skeptic attacked the session and found nothing | **inferred** |

Each line is separately auditable, and each is tagged with where it came from. An inferred
value may never overwrite a measured one, and the three classes render differently. The
model is allowed an opinion about whether a repetition reached depth. It is not allowed an
opinion about whether the video was continuous.

This is also the honest answer to *"how accurate is it?"* — accuracy is a property of the
inferred rows only, and that is where we report it.

### Do we clip the proof?

Yes, and the clip must never stand alone.

**Clipping is exactly what a faker does.** Fifteen seconds of repetition 87 proves almost
nothing by itself; its entire credibility comes from the unbroken session it was cut from.
The moment a clip becomes the artifact, the property that made it worth anything has been
destroyed.

> **The clip is the presentation. Continuity is the proof.**
>
> Every published clip carries the address of its source recording and its offset within
> it, so anyone can leave the clip and audit the whole session. **Witness will not issue a
> clip that cannot be traced back to a continuous source.**

That gives you both: something a person can check in five seconds, and something a
skeptic can check in five minutes.

---

## Custody: why the recording does not live here

A session is streamed to a live video platform — YouTube in the reference deployment —
and Witness watches that stream rather than hosting it.

This is not a convenience. It is the point.

If we hold the only copy of the evidence, then every attestation reduces to *"trust our
recording."* When the session lives with a third party who has no stake in the outcome, the
attestation becomes *"here is a publicly addressable recording, timestamped by someone
else, and here is the segment we are pointing at."* The verifier is not asked to trust us
about the thing being verified.

It also means Witness is not the custodian of other people's video, which is a
responsibility worth declining.

Unlisted works identically for this purpose: a recording that is not indexed is still
independently checkable by anyone holding the link, without making a person's session
public to the world.

---

## Publication

Attested sessions can be published — a clip, the record, and a badge that links back to
the full evidence. Publication is opt-in per session, not per account, because someone may
well want a charity challenge public and a practice attempt private.

**Refusals are never published.** Not to a feed, not to a leaderboard, not anywhere.

A public feed of claims that held up is a product. An automated public feed of *"we caught
this person cheating"* is a machine-generated accusation against a named individual with no
due process behind it, and we will not build one. Refusals go to the subject and to
whoever is running the activity. Nobody else, ever.

There is a practical reason as well as a principled one: the instant refusals become
public, people stop opening sessions, and a system that gets no evidence verifies nothing.

---

## How it works

```
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │   a claim is declared                                        │
   │        │                                                     │
   │        ▼                                                     │
   │   WARDEN ──── opens the session, holds the connection,       │
   │        │      enforces the ceiling, closes it                │
   │        ▼                                                     │
   │   WATCHER ─── Gemini sees the live stream and emits a        │
   │        │      timestamped account of what occurred           │
   │        ▼                                                     │
   │   ADJUDICATOR + CORROBORATOR + SKEPTIC                       │
   │        │      does the account support the claim;            │
   │        │      do independent sources agree;                  │
   │        │      is anyone trying to fake it                    │
   │        ▼                                                     │
   │   REGISTRAR ── attests, refuses, or escalates —              │
   │        │       and records the reason either way             │
   │        ▼                                                     │
   │   HERALD ───── assembles the public artifact, if asked       │
   │        │                                                     │
   │        ▼                                                     │
   │   INDEXER ──── the session becomes searchable by what        │
   │        │       was seen inside it                            │
   │        ▼                                                     │
   │   what happened updates the subject's standing ────────┘     │
   │                                                              │
   └──────────────────────────────────────────────────────────────┘
```

The loop is the point. A refusal is not the end of a transaction — it changes how closely
the next session by the same subject is watched, which is what makes attention affordable
at scale.

### The fleet

Nine agents. None calls another; each does one narrow job, and the work it finishes is
what wakes the next.

| Agent | What it does |
|---|---|
| **Warden** | Opens and closes sessions, holds the live connection, enforces the spend ceiling |
| **Watcher** | Gemini on the live stream. Emits a timestamped account of what occurred |
| **Adjudicator** | Compares the declared claim against the observed account |
| **Corroborator** | Cross-checks independent evidence — device sensors, a second angle, host timestamps |
| **Skeptic** | Hunts fabrication: loops, splices, playback-rate anomalies, substitution off-frame |
| **Registrar** | Attests, refuses, or escalates. Signs the record. Records the reason |
| **Herald** | Selects the moments that matter, assembles the public artifact, publishes on request |
| **Indexer** | Embeds observed events so sessions are searchable by content, not metadata |
| **Treasurer** | Meters agent-minutes, allocates attention by stakes, stops at the ceiling |

A tenth process, the **Chronicler**, writes everything the fleet does to a public log, so
that any claim in this document can be checked by a stranger.

**Why the Skeptic is its own agent.** A model asked to both evaluate a claim and doubt it
will do the first and neglect the second. Separating the adversary — its own prompt, its
own incentive, no knowledge of the Adjudicator's conclusion — is the difference between a
system that validates and a system that verifies.

**Why the Registrar cannot certify alone.** Agents assemble evidence, score confidence, and
refuse. A human holds the stamp. An automated system issuing final verdicts on contested
facts, where money and standing are downstream, is a liability rather than a product. The
fleet's job is to make the human's decision cheap, not to remove them from it.

---

## Attention is the unit, and it is metered

The expensive thing about watching is watching. Witness bills **per agent-minute of
attention**, and the Treasurer decides how much attention a session earns.

A high-stakes claim gets continuous multi-agent observation. A routine one gets sampled
frames and a single pass. Below threshold, the fleet declines to spend anything at all and
says so. Attention is allocated the way an editor allocates a reporter's time, not the way
a scheduler allocates compute.

This matters beyond our own economics. **The open question for anyone running agents in
production is what it costs to have one paying attention continuously, and nobody has
published a real number.** Witness publishes an itemised ledger: cost per session, per
agent-minute, per refusal. If the number is bad, we will say it is bad.

The target we are building against is **a fully attested session for under a dollar.**

---

## Proof domain

**Bodyweight repetitions.** Someone declares a count, streams the attempt, and the fleet
attests or refuses.

Deliberately the least glamorous option available, chosen for three reasons.

**It is the hardest case.** A repetition count is a claim with no external record, made in
real time, by someone with an obvious incentive to inflate it, verifiable only from the
stream itself. No database to check against, no receipt, no third party who already knows
the answer. If attestation holds here, it holds where corroborating records exist.

**The evidence is self-generating.** The system can be exercised hundreds of times a day
without recruiting anyone, without a marketplace to cold-start, and without waiting on a
stranger. Every competing approach to proving a system like this works depends on other
people showing up. This one does not.

**The fraud can be staged.** Half-repetitions, a looped clip, playback at 0.8×, a different
pair of arms entering frame — every failure mode can be manufactured on demand and used to
attack the Skeptic. A verifier that has never been attacked has an unknown false-negative
rate, which is another way of saying it is not a verifier.

The domain is the test, not the identity. **Witness is not a fitness product.** The adapter
that turns a stream into a claim is a couple of hundred lines; the fleet behind it neither
knows nor cares what activity it is watching.

### Where this goes

The same fleet, a different adapter: remote inspection and field-service sign-off, claims
adjudication from a walkaround video, laboratory protocol compliance, chain of custody,
practical examination and proctoring, and competitive events of every kind — which is the
one where people are already paying human officials to do exactly this, badly and
expensively.

We will demonstrate exactly one second adapter, late, rather than claim the list.

---

## Architecture

Witness runs on Google Cloud.

| Layer | Service |
|---|---|
| Reasoning and live video understanding | **Gemini 3.5** via Vertex AI |
| Agent framework | **Agent Development Kit (ADK)** |
| Agent runtime | **Agent Engine** — long-running agents with pause and resume |
| Discovery and lifecycle | **Agent Registry** |
| Cross-session context | **Memory Bank** — per-subject standing, held across weeks |
| Access control | **Agent Identity** — zero-trust, per agent |
| Routing and policy | **Agent Gateway** |
| Inline guardrails | **Model Armor** |
| Telemetry | **Agent Observability** — OpenTelemetry traces and audit logs |
| Services, transport, scheduling | **Cloud Run**, **Pub/Sub** |
| Session custody and publication | **YouTube Live** — third-party recording and timestamps |
| Session index | Vector search over observed events |
| High-volume frame classification | **Gemma** — the cheap pass the Treasurer routes to |
| Adversarial test material | **Veo** — synthetic fraud clips, generated to attack our own Skeptic |

Full diagram: [`docs/architecture.md`](docs/architecture.md)

**Why the governance components are load-bearing rather than decorative.** A system that
adjudicates other people's claims is worthless if it cannot prove who decided what, under
which policy, with which model version, at which moment. Identity, Gateway, Model Armor and
Observability are not compliance decoration here — they are the reason a refusal means
anything. **An attestation you cannot audit is just an assertion.**

**Why Veo generates attacks rather than assets.** The most useful thing a video generator
can do for a verification system is produce material designed to fool it. Every synthetic
clip the Skeptic fails to catch is a bug found before someone else finds it. The technology
that broke video as evidence is put to work restoring it.

---

## For agents: the MCP surface

Witness exposes its index over the Model Context Protocol, so another system — or a
person's own assistant — can query attestations directly.

```
open_session         declare a claim and begin
search_sessions      find sessions by what was observed inside them
explain_outcome      why this session was attested, refused, or escalated
get_record           the signed record, its evidence, and its provenance classes
```

The intended end state is that Witness is infrastructure rather than a destination. The
best version of this product is one nobody logs into.

---

## What it will not do

- **It does not certify.** A human holds the stamp.
- **It does not infer what it did not observe.** If the camera was pointed away, the record
  says the camera was pointed away.
- **It does not watch anything it was not invited to watch.** A session is opened
  deliberately by its subject and ends when they end it.
- **It does not retain biometric identity.** It confirms continuity within a session, then
  discards the means of having done so.
- **It does not publish a refusal.** Ever.
- **It does not exceed its budget.** The Treasurer holds a hard ceiling per session and
  refuses past it rather than asking forgiveness.

---

## Evidence

Every number here is produced by the running system and is checkable against the public
log.

<!-- FILL FROM THE RUNNING SYSTEM BEFORE SUBMISSION -->
| | |
|---|---|
| Sessions watched | _pending_ |
| Agent-minutes of attention | _pending_ |
| **Sessions attested** | _pending_ |
| **Sessions refused** | _pending_ |
| Sessions escalated to a human | _pending_ |
| Staged frauds attempted | _pending_ |
| **Staged frauds caught** | _pending_ |
| Days run unattended | _pending_ |
| Cost per attested session | _pending_ |
| **Total spend** | _pending_ |

Public decision log: <!-- URL --> _pending_

---

## Running it

### Prerequisites

- A Google Cloud project with billing enabled
- `gcloud` authenticated, with Vertex AI, Agent Engine, Cloud Run and Pub/Sub enabled
- A YouTube channel able to stream live
- Python 3.12+
- A camera, and something to point it at

### Setup

```bash
git clone <repo> && cd witness
cp .env.example .env          # project, region, credentials, channel
./scripts/bootstrap.sh        # session store, vector index, registry entries
./scripts/deploy.sh           # agents to Agent Engine, services to Cloud Run
```

### Verify

```bash
./scripts/smoke.sh            # opens a session against a recorded fixture, end to end
```

The smoke test runs the full fleet against a fixture rather than a live camera, so it is
safe to run on a fresh project without streaming anything or contacting anyone.

<!-- Expand with exact commands once the build lands. -->

---

## Disclosure

Witness was built during the All Things Agentic submission period (3–31 August 2026), in a
repository created inside that window.

Earlier projects by the same author informed its design and are named here because the
rules require pre-existing work to be disclosed:

- **Nucleus Brain** (`~/Code/enterprise-ai`) — a multi-agent operations platform whose
  approve/reject governance, trust scoring and immutable audit trail directly informed the
  separation of agent judgement from human authority. No source is carried over.
- **DerbyFish** (`~/Code/derbyfish`) — a catch-verification platform. Its
  session-as-timeline model, and the principle that evidence richness determines
  confidence, informed the session design. No source is carried over.
- **Spindle** (`~/Code/spindle`) and **TollRoad** (`~/Code/tollroadmusic`) — an agentic
  outreach fleet and a metered-billing platform. Their fleet topology and per-unit metering
  informed the Treasurer. No source is carried over.

Every line of Witness was written during the submission period. The predecessors supplied
concepts, not code.

---

## Licence

See [`LICENSE`](LICENSE).
