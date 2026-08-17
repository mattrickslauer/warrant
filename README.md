# Witness

**A fleet of agents that watches something happen and refuses to say it did.**

> **Working name.** `Witness` describes the job precisely — an agent present at an event
> whose account of it can be relied on. Change it before submission if something better
> lands.

Witness is an attestation layer for live activity. Someone declares a claim, opens a
session, and streams the evidence. A fleet of eight agents attaches to that session for
its duration, watches it happen, and produces a signed, searchable record of what was
actually observed — or refuses to produce one.

**The refusal is the product.** Anything can generate a certificate. The value is in the
sessions that don't get one, and in being able to show why.

---

## The problem

There is an enormous class of claims that are true, consequential, and impossible to
prove cheaply.

A tournament angler says the fish was nineteen inches. A field technician says the
install was completed to spec. A remote student says they sat the exam alone. Someone
running a charity challenge says the hundred reps happened. In every case the claim
matters — money, standing, or trust depends on it — and in every case the only way to
verify it today is for a human being to have been there, or for a human being to sit and
watch the footage afterwards.

So one of three things happens. An organisation pays for officials, which most cannot
afford. It trusts the claim and absorbs the fraud. Or it demands so much evidence that
honest people give up and stop participating.

**The person this hurts most is not an enterprise.** It's whoever is running a
competition, a program, or a certification with no budget for officials and no
institution standing behind them — and who is therefore forced to choose between being
cheated and being unreasonable.

Verification has been a labour problem. It stopped being one when models learned to
watch.

---

## What Witness does

A claim is declared up front. A session opens. Agents attach over a websocket and watch
in real time. When the session closes, one of three things exists:

| Outcome | Meaning |
|---|---|
| **Attested** | Independently corroborated, with the observations and their timestamps attached |
| **Refused** | The evidence does not support the claim, and the record says exactly which part failed |
| **Escalated** | Genuinely ambiguous — routed to a human, with the specific question isolated |

The record is signed, permanent, and semantically searchable. Not searchable by title or
tag — searchable by **what the agents saw**. "Every attested session where the last ten
reps degraded below depth." "Every refusal caused by a discontinuity in the stream."

### What it does not do

Stated plainly, because a system that adjudicates other people's claims should be
legible about its limits.

- **It does not certify.** Agents assemble evidence, score confidence, and refuse. A human
  holds the stamp. An automated system that issues final verdicts on contested facts is a
  liability, not a product.
- **It does not infer what it did not observe.** If the camera was pointed away, the record
  says the camera was pointed away.
- **It does not watch anything it was not invited to watch.** A session is opened
  deliberately by its subject, and it ends when they end it.
- **It does not retain biometric identity.** It confirms continuity within a session — that
  the same person is present throughout — and discards the means of doing so afterwards.
- **It does not exceed its budget.** The Treasurer holds a hard ceiling per session and
  refuses past it rather than asking forgiveness.

---

## How it works

```
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │   a claim is declared                                        │
   │        │                                                     │
   │        ▼                                                     │
   │   WARDEN ──── opens the session, holds the socket,           │
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

Eight agents. None calls another; each does one narrow job, and the work it finishes is
what wakes the next.

| Agent | What it does |
|---|---|
| **Warden** | Opens and closes sessions, holds the live connection, enforces the spend ceiling |
| **Watcher** | Gemini on the live stream. Emits a timestamped account of what occurred |
| **Adjudicator** | Compares the declared claim against the observed account |
| **Corroborator** | Cross-checks independent evidence — device sensors, a second angle, timing |
| **Skeptic** | Actively hunts fabrication: loops, splices, playback-rate anomalies, substitution off-frame |
| **Registrar** | Attests, refuses or escalates. Signs the record. Records the reason |
| **Indexer** | Embeds observed events so sessions are searchable by content, not metadata |
| **Treasurer** | Meters agent-minutes, allocates attention by stakes, stops at the ceiling |

A ninth process, the **Chronicler**, writes everything the fleet does to a public log, so
that any claim in this document can be checked by a stranger.

**Why the Skeptic exists as its own agent.** A model asked to both evaluate and doubt a
claim tends to do the first and neglect the second. Separating the adversary into its own
agent, with its own prompt and its own incentive, is the difference between a system that
validates and a system that verifies.

---

## Three classes of fact, kept apart on purpose

Witness produces claims about the world, so it has to be honest about where each one came
from.

| Fact | Where it comes from | Class |
|---|---|---|
| Duration, frame continuity, stream integrity | Signal analysis | **measured** |
| What happened, whether it satisfies the claim | The model, from the video | **inferred** |
| The claim itself, the stakes, the rules of the activity | A human being | **asserted** |

An inferred value may never overwrite a measured one, and the interface renders the three
differently. The model is allowed an opinion about whether the rep reached depth. It is
not allowed an opinion about whether the video was continuous.

This distinction is also the honest answer to "how accurate is it?" — accuracy is a
property of the inferred column only, and we report it there.

---

## Attention is the unit, and it is metered

The expensive thing about watching is watching. Witness bills **per agent-minute of
attention**, and the Treasurer decides how much attention a session earns.

A high-stakes claim gets continuous multi-agent observation. A routine one gets sampled
frames and a single pass. Below threshold, the fleet declines to spend anything at all and
says so. Attention is allocated the way an editor allocates a reporter's time, not the way
a cron job allocates compute.

This matters beyond our own economics. **The open question for anyone deploying agents in
production is what it costs to have one paying attention continuously, and nobody has
published a real number.** Witness publishes an itemised ledger: cost per session, per
agent-minute, per refusal. If the number is bad we will say it is bad.

The target we are building against is **a fully attested session for under a dollar.**

---

## Proof domain

**Bodyweight repetitions.** Someone declares a count, streams the attempt, and the fleet
attests or refuses.

This is deliberately the least glamorous option available, and it was chosen for three
reasons.

**It is the hardest case.** A rep count is a claim with no external record, made in real
time, by someone with an obvious incentive to inflate it, verifiable only from the stream
itself. There is no database to check against, no receipt, no third party. If attestation
holds here it holds where corroborating records exist.

**The evidence is self-generating.** The system can be exercised hundreds of times a day
without recruiting anyone, without a marketplace to cold-start, and without waiting on a
stranger to reply. Every competing approach to proving this system works depends on other
people showing up. This one does not.

**The fraud can be staged.** Half-reps, a looped clip, a video played at 0.8×, a different
pair of arms entering frame — every failure mode can be manufactured deliberately, on
demand, and used to test the Skeptic. A verifier that has never been attacked is a
verifier with an unknown false-negative rate.

The domain is the test, not the identity. Witness is not a fitness product. The adapter
that turns a stream into a claim is roughly two hundred lines; the fleet behind it does not
know or care what activity it is watching.

### Where this goes

The same fleet, different adapter: remote inspection and field-service sign-off, claims
adjudication from a walkaround video, laboratory protocol compliance, chain of custody,
practical examination and proctoring, and competitive events of every kind — which is the
one where somebody is currently paying human officials to do exactly this.

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
| Access control | **Agent Identity** — zero-trust, per-agent |
| Routing and policy | **Agent Gateway** |
| Inline guardrails | **Model Armor** |
| Telemetry | **Agent Observability** — OpenTelemetry traces and audit logs |
| Services, transport, scheduling | **Cloud Run**, **Pub/Sub** |
| Session index | Vector search over observed events |
| High-volume frame classification | **Gemma** — the cheap pass the Treasurer routes to |
| Adversarial test material | **Veo** — synthetic fraud clips, generated to attack our own Skeptic |

Full diagram: [`docs/architecture.md`](docs/architecture.md)

**Why the governance components are load-bearing rather than decorative.** A system that
adjudicates other people's claims is worthless if it cannot prove who decided what, under
which policy, with which model version, at which moment. Identity, Gateway, Model Armor and
Observability are not compliance decoration here — they are the reason a refusal means
anything. An attestation you cannot audit is an assertion.

**Why Veo generates attacks rather than assets.** The most useful thing a video model can
do for a verification system is produce material designed to fool it. Every synthetic clip
Veo generates that the Skeptic fails to catch is a bug found before a user finds it.

---

## For agents: the MCP surface

Witness exposes its index over the Model Context Protocol, so another system — or a
person's own assistant — can query attestations directly.

```
search_sessions      find sessions by what was observed inside them
explain_outcome      why this session was attested, refused, or escalated
get_record           the signed record, its evidence, and its provenance classes
open_session         declare a claim and begin
```

The intended end state is that Witness is infrastructure rather than a destination. The
best version of this product is one nobody logs into.

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
- Python 3.12+
- A camera and something to point it at

### Setup

```bash
git clone <repo> && cd witness
cp .env.example .env          # project, region, credentials
./scripts/bootstrap.sh        # session store, vector index, registry entries
./scripts/deploy.sh           # agents to Agent Engine, services to Cloud Run
```

### Verify

```bash
./scripts/smoke.sh            # opens a session against a recorded clip, end to end
```

The smoke test runs the full fleet against a fixture rather than a live camera, so it is
safe to run on a fresh project without streaming anything.

<!-- Expand with exact commands once the build lands. -->

---

## Disclosure

Witness was built during the All Things Agentic submission period (3–31 August 2026), in a
repository created inside that window.

Earlier projects by the same author informed its design and are named here because the
rules require pre-existing work to be disclosed:

- **Nucleus Brain** (`~/Code/enterprise-ai`) — a multi-agent operations platform whose
  approve/reject governance, trust scoring and immutable audit trail directly informed
  Witness's separation of agent judgement from human authority. No source is carried over.
- **DerbyFish** (`~/Code/derbyfish`) — a catch-verification platform. Its
  session-as-timeline model and the principle that evidence richness determines confidence
  informed Witness's session design. No source is carried over.
- **Spindle** (`~/Code/spindle`) and **TollRoad** (`~/Code/tollroadmusic`) — an agentic
  outreach fleet and a metered-billing platform. Their fleet topology and per-unit metering
  informed the Treasurer. No source is carried over.

Every line of Witness was written during the submission period. The predecessors supplied
concepts, not code.

---

## Licence

See [`LICENSE`](LICENSE).
