# Rotation

**The filter between the people who make music and the people who can play it.**

> **Working name.** `Rotation` is the industry term for a record being played
> repeatedly — and it describes the loop this system runs. Change it before submission
> if something better lands.

Rotation is an agentic operating system for music distribution. A fleet of eleven
agents reads a record, works out who in the world should hear it, and does the work of
getting it in front of them — continuously, unattended, and within a budget you set.

**Every note of music in this system was made by a human being.** Rotation does not
generate music. It generates the work of getting human music heard.

---

## The problem, from both sides

Distribution is solved. Anyone can put a song on every streaming service in an
afternoon. What is not solved is that a song on a service is a song nobody has heard
of, and closing that gap is a letter-writing job — thousands of individual
conversations with the people who program radio shows, curate playlists, run podcasts,
and choose music for film and television.

That job breaks down at both ends.

**For an artist or a small label,** the work is measured in weeks per release and it
never ends, because there is another release next month. Nobody with three people on
staff has weeks. So it does not get done, the record disappears, and everyone blames
the algorithm.

**For a curator,** the problem is the exact opposite. A community radio programmer with
a two-hour weekly show receives hundreds of submissions a month. Almost none of them
fit. The good record is in there somewhere, underneath everything that isn't, and
finding it is unpaid work on top of a show they already make for free.

These look like two problems. They are one problem with no filter in the middle.

---

## What Rotation actually does

**It is the filter.**

Rotation holds a continuously-updated index of the people who can carry a record —
stations, shows, curators, programmers, supervisors — and what each one actually plays.
When a new record arrives, the system listens to it, compares it against that index,
and then does the thing every other tool in this market refuses to do:

**It throws almost all of them away.**

A typical run considers tens of thousands of candidates and passes through a few dozen.
The curator receives a short, ranked, evidenced list of records that genuinely fit
their show — not a flood. The artist reaches the people most likely to say yes,
without writing a word.

That refusal is the product. Anyone can send more email. The value is in what does not
get sent.

### What each side gets

| | **Artists and labels** | **Curators and programmers** |
|---|---|---|
| **The pain today** | Nobody hears the record. Pitching costs weeks per release. | Drowning in submissions. Most are irrelevant. Filtering is unpaid work. |
| **What Rotation gives** | Placement in front of the right people, without writing a pitch | Fewer, better, ranked, with the reasoning attached |
| **Why it holds up** | It works, and it costs less than the time it replaces | It shrinks the inbox instead of adding to it |

---

## How it works

```
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │   a record arrives                                           │
   │        │                                                     │
   │        ▼                                                     │
   │   LISTENER  ── Gemini hears the actual audio and derives      │
   │        │       what it is, who it is for, where the hook is  │
   │        ▼                                                     │
   │   MATCHMAKER ── ranks the index against this specific record │
   │        │                                                     │
   │        ▼                                                     │
   │   FILTER ──── refuses everything below threshold,            │
   │        │      and records why it refused                     │
   │        ▼                                                     │
   │   MAKER + CORRESPONDENT ── assets and a pitch, per recipient │
   │        │                                                     │
   │        ▼                                                     │
   │   PUBLISHER + READER ── it goes out; replies come back       │
   │        │                                                     │
   │        ▼                                                     │
   │   what happened re-ranks everything ──────────────────┘      │
   │                                                              │
   └──────────────────────────────────────────────────────────────┘
```

The loop is the point. Every reply, every polite no, every *"too long for daytime
rotation,"* every *"not for us but send the next one"* is retained and changes what the
system does next. Most campaigns start from zero every time, because the knowledge
lived in somebody's sent folder and left when they did.

### The fleet

Eleven agents. None of them calls another; each does one narrow job and the work it
finishes is what wakes the next one.

| Agent | What it does |
|---|---|
| **Listener** | Listens to the record. Derives mood, era, reference points, and the hook window |
| **Scout** | Continuously finds new curators from public registers |
| **Profiler** | Learns what each one actually plays, and embeds it |
| **Classifier** | Assigns role and format across the whole index |
| **Matchmaker** | Ranks the index against one specific record |
| **Filter** | Refuses what does not fit, and records the reason |
| **Maker** | Produces promo assets aimed at the hook window — **never music** |
| **Publisher** | Posts to the artist's own channels on a schedule it chooses |
| **Correspondent** | Writes and sends the pitch, one recipient at a time |
| **Reader** | Reads replies, updates the relationship, re-wakes the Matchmaker |
| **Treasurer** | Meters every agent's spend against a ceiling and stops at it |

A twelfth process, the **Chronicler**, writes everything the fleet does to a public log
so that any claim in this README can be checked by a stranger.

---

## What it will not do

Stated plainly, because a system that spends money and contacts people on your behalf
should be legible about its limits.

- **It does not generate music.** Not a note, not a bed, not a stem. The records are
  made by people.
- **It does not invent contact details.** A route either came from a public source or
  it does not exist.
- **It does not exceed its budget.** The Treasurer holds a hard ceiling and refuses
  past it rather than asking forgiveness.
- **It does not resurrect an opt-out.** Once someone asks not to be contacted, that is
  terminal.
- **It does not claim attribution.** It can show what it did and what changed. It does
  not claim the first caused the second.

---

## Architecture

Rotation runs entirely on Google Cloud.

| Layer | Service |
|---|---|
| Agent runtime | **Agent Engine** — long-running ADK agents with pause/resume |
| Reasoning | **Gemini 3.5** via Vertex AI, including native audio understanding |
| Volume classification | **Gemma** |
| Asset generation | **Veo** |
| Matching | **AlloyDB for PostgreSQL** with the ScaNN vector index |
| Agent discovery | **Agent Registry** |
| Long-term context | **Memory Bank** |
| Access control | **Agent Identity** |
| Tool and policy enforcement | **Agent Gateway** |
| Inline guardrails | **Model Armor** |
| Telemetry | **Cloud Logging** and **Cloud Trace** |
| Services and scheduling | **Cloud Run**, **Pub/Sub**, **Cloud Scheduler** |

Full diagram: [`docs/architecture.md`](docs/architecture.md)

### Why the model listens to the record

Most tools in this market match on metadata — genre tags, BPM fields, whatever the
distributor typed in. Rotation matches on the record itself, because Gemini can take
the audio directly.

That produces two different classes of fact, and Rotation keeps them apart on purpose:

| Fact | Where it comes from | Class |
|---|---|---|
| BPM, key, section boundaries | Signal analysis | **measured** |
| Mood, era, reference artists, where it lifts | The model, from the audio | **inferred** |
| Rights, splits, clearances | A human being | **asserted** |

An inferred value may never overwrite a measured one, and the interface renders the
three differently. The model is allowed to have an opinion about what the record *is*.
It is not allowed to have an opinion about the tempo.

---

## For agents: the MCP surface

Rotation exposes its index over the Model Context Protocol, so a curator's own AI
assistant can query it directly instead of reading email.

```
search_submissions   what came in that fits my show
explain_match        why this record was matched to me
get_record           the audio, the facts, the rights
decline              remove this record, and tell the system why
```

A programmer who lives in an assistant never has to open our product at all. That is
the intended end state: the filter becomes infrastructure, not another dashboard.

---

## Evidence

Every number here is produced by the running system and is checkable against the
public log.

<!-- FILL FROM THE RUNNING SYSTEM BEFORE SUBMISSION -->
| | |
|---|---|
| Curators indexed | _pending_ |
| Records processed | _pending_ |
| Candidates considered | _pending_ |
| **Candidates passed by the Filter** | _pending_ |
| Pitches sent | _pending_ |
| Replies received | _pending_ |
| Placements confirmed | _pending_ |
| Days run unattended | _pending_ |
| **Total spend** | _pending_ |

Public decision log: <!-- URL --> _pending_

---

## Running it

### Prerequisites

- A Google Cloud project with billing enabled
- `gcloud` authenticated, and the Vertex AI, Agent Engine, AlloyDB, Cloud Run,
  Pub/Sub and Cloud Scheduler APIs enabled
- Python 3.12+

### Setup

```bash
git clone <repo> && cd rotation
cp .env.example .env          # fill in project, region, and credentials
./scripts/bootstrap.sh        # AlloyDB instance, schema, vector index
./scripts/deploy.sh           # agents to Agent Engine, services to Cloud Run
```

### Verify

```bash
./scripts/smoke.sh            # end-to-end: ingest a record, match, and dry-run a pitch
```

The smoke test runs the full loop with sending disabled, so it is safe to run against a
live project without contacting anyone.

<!-- Expand with exact commands once the build lands. -->

---

## Disclosure

Rotation was built during the All Things Agentic submission period (3–31 August 2026).

Two earlier projects by the same author informed its design and are named here because
the rules require pre-existing work to be disclosed:

- **TollRoad** (`~/Code/tollroadmusic`, first commit 12 June 2026) — a metered-billing
  music platform. Its payment rails, catalogue model and MCP surface informed
  Rotation's design. No source is carried over.
- **Spindle** (`~/Code/spindle`, first commit 26 July 2026) — a counterparty index and
  outreach fleet built for a different hackathon. Its matching approach informed
  Rotation's design. No source is carried over.

The counterparty data Rotation uses is harvested fresh from public registers by code in
this repository. Nothing was copied from either predecessor.

---

## Licence

See [`LICENSE`](LICENSE).
