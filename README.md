# Warrant

**Maintenance records that are evidence, not paperwork.**

> **Working name.** A warrant is a guarantee that a thing is as represented.

---

## The tick in the box

Somewhere right now, a technician is ticking a box that says *brake pads replaced*.

Maybe they replaced the brake pads. Probably they did. The record says so either way, because
the record is a tick in a box — a claim by an interested party, stored in a system designed to
accept it.

This is the trust model for maintenance across almost every industry on earth. It is why
skipped servicing is endemic, why falsified maintenance records are a recognised category of
fraud, and why the technician who *did* do the job right still cannot prove it when a dispute
arrives eight months later.

Two industries already solved this. Neither solution has ever reached the people who need it
most.

## What aviation did, and what delivery did

An aircraft's logbook is legally binding. Every life-limited part carries a traceable
certificate. Every task is signed by a licensed engineer against a published procedure.
Nothing flies until the paperwork says it can, and the paperwork means something because
falsifying it is a crime with a name. **It works — and it is affordable only because the
airframe underneath it is worth tens of millions.**

Meanwhile, every time a courier drops a parcel, a stranger performs an unsupervised task and
proves it in about four seconds. Arrived — GPS confirms it. Right address — confirmed. Gate
code needed? Only then are you asked. Left at the door — photograph, timestamped, attached.
**It costs pennies**, and it works for three reasons:

- The worker never decides what evidence to capture. The app asks, one step at a time.
- The proof is a **gate**, not a form field at the end.
- The flow branches. Steps appear only when the situation calls for them.

Maintenance has neither. It has a clipboard, a tick, and a signature at the bottom.

**Aviation set the standard. Delivery worked out the price. Warrant is the first at the
second's price.**

---

## How it works

### 1. Describe the job once

You say what the work is in plain language. An agent interviews you until the ambiguity is
gone — *what counts as done, what disqualifies it, what has to be measured, what a technician
may decide alone* — and compiles the answers into a versioned, machine-checkable procedure.

```
procedure: front-brake-service · v3
  step 1  remove wheel          photo — wheel off, caliper visible
  step 2  identify old pad      photo — wear consistent with logged interval
  step 3  present new part      photo — label legible, matches work order
  step 4  fit and torque        MEASUREMENT — 90° ±5 past snug, from a paired tool
  step 5  function check        video — lever travel and return
  disqualifies: step elapsed under 12 min · part number mismatch
  releases: return to service · consume 1× pad set · reorder below 2
```

That document is the product. Everything else is machinery.

### 2. Work through it, one step at a time

The technician opens the job on their phone and is walked through it the way a courier is
walked through a drop. One step on screen. Capture. Next. Nothing is typed in.

**Capture never waits.** Verification happens behind them, so nobody stands in a workshop
holding a phone with dirty hands watching a spinner. If a step turns out to need more, an
alert appears on the job and can be fixed from wherever they are — including three steps
later. **The gate is the seal, not the step:** a job cannot seal until every step passes, and
the machine is not released until the job seals.

When reality disagrees with the plan — a part number that doesn't match, wear inconsistent
with the interval — the flow **branches** and opens the step it needs.

An **Instructor** is there the whole time on a held button. Press it, ask a question out loud,
get an answer. It knows the procedure, the step, and the machine's history. Optional, and
most jobs use it twice.

### 3. Let the instruments speak

A photograph tells you a job was done. **An instrument tells you it was done right.**

Warrant reads directly from paired tools — a torque wrench, a gauge, a caliper, a reader, or
a sensor you build yourself out of an ESP32 and a probe. The number arrives with a tool identity and a timestamp, having
passed through no human hands. That is the only property that makes a value **measured**
rather than typed, and it is the difference between a system that watches work and one that
**measures** it.

Every instrument sits behind the same small driver contract, so the rest of the system is
indifferent to which tool it is. When it meets one it doesn't know, **Wright** works out how
the device talks and writes the driver itself.

### 4. Verified steps act

A passed step is not a green tick. It is a trigger. Stock decrements. A reorder is raised
below its floor. The work order advances. The asset's history updates.

And when the last step passes, the machine is released. **Until then, it isn't.**

---

## Who uses it, and how they get in

**Sign in with Google, and your account decides the shape of the tenant.**

A **Workspace** account puts you in your employer's enterprise — everyone at `acme.com` shares
procedures, jobs, parts and records. A **personal** Google account is a tenant of one: your
procedures, your jobs. The boundary is a natural one — **multiple technicians require
Workspace**, because a company with a crew already has a directory, and that directory is the
membership list.

There is no organisation wizard, no invite email, no seat management. And offboarding works
without anyone thinking about it: a technician leaves, their employer disables the account,
their access ends the same instant.

Three surfaces, with different jobs:

| Surface | Who | What it is for |
|---|---|---|
| **The dashboard** | The people who run the work | Author procedures with the Scoper, watch jobs, open a sealed record |
| **The app** | Technicians | Perform the job. Capture, instruments, offline. Android, native |
| **Workspace** | Everyone | Where the answers turn up — the ledger, the records, the drafted orders |

**There is no form builder.** Procedures are authored by talking to the Scoper, which is both
less to learn and more precise than a drag-and-drop editor, because a conversation can ask
*"what happens if the subfloor is rotten underneath?"* and a form cannot.

**And if you already have a checklist**, Warrant will read it. Point the Scoper at the Google
Form or the spreadsheet your shop already uses and it compiles that into a procedure. Adoption
is bringing what you have, not replacing it.

---

## What "verified" actually means

Warrant never claims a job was good. It closes off the ways the record could be false, and
states exactly which ways it closed. Every piece of evidence is filed into one of three
classes, and they never blur:

| Evidence | Class |
|---|---|
| A reading from a paired instrument · `90.4° · 14:32:07 · tool #A19` | **measured** |

| A part number matching the work order | **measured** |
| What a photograph appears to show | **inferred** |
| Craft quality and judgement | **asserted** — signed, by name |

**An inferred value may never overwrite a measured one.** The model is allowed an opinion
about whether a pad looks seated. It is not allowed an opinion about the angle, because a tool
already answered that, and tools do not have opinions.

### What Warrant will not tell you

It does not judge workmanship from a photograph. It cannot see whether a bolt was
cross-threaded, whether a caliper seated correctly, or whether a fluid is the right grade. Any
system claiming to assess craft from video is guessing, and guessing is worse than nothing in
a record people will rely on years later.

**What it establishes is that the work happened, with these parts, on this machine, at this
time, to these measured values — and it refuses when it cannot.** That is narrower than
"we verify maintenance," and it is the one that is true. It also addresses the failure that
actually occurs, which is not bad work. **It is work that never happened.**

---

## Buy the assurance you need

Strictness is one dial, and the same procedure runs at every setting.

| | **log** | **standard** | **assured** | **regulated** |
|---|---|---|---|---|
| Evidence required | Core only | Core + measurements | Everything declared | Everything, plus corroboration |
| When unclear | Accepts | Asks again | Asks for a second source | Requires measured where measurable |
| Cost per job | cents | | | dollars |

A rental yard runs at standard. The same procedure on an asset carrying passengers runs at
regulated. Nothing is rewritten — the bar moves, and the meter moves with it.

**That is aviation-grade assurance made purchasable.** You decide how much you are buying, and
you can see what it cost.

---

## The fleet

**Five agents over a deterministic core.** Each agent does one narrow job that genuinely
requires a model; everything that must be trustworthy rather than clever is ordinary code.

| Agent | What it does |
|---|---|
| **Scoper** | Interviews you until a procedure is unambiguous, then compiles and versions it |
| **Instructor** | Runs the step and answers questions out loud on a held button |
| **Inspector** | Passes the step, asks for more evidence, or escalates to a person |
| **Skeptic** | Adversarial. Does this evidence belong to this job, this machine, this moment |
| **Wright** | Meets an unfamiliar instrument, works out how it speaks, writes the driver |

**And the core, which contains no model at all:**

| Service | What it does |
|---|---|
| **The seal** | Closes a record once every step passes, and stamps each field's provenance class |
| **The gate** | Holds the machine out of service until the job seals |
| **The ledger** | Meters spend against a hard ceiling, and writes every decision to the public log |
| **Stock and ordering** | Parts, shortages, and drafted purchase orders — exposed to the agents as MCP tools |

**Why the core is not agents, and why that is the point.** The three things this system does
that actually protect somebody — sealing a record, refusing to release a machine, refusing to
overspend — are deterministic. A gate you can argue with is not a gate. Nobody should trust a
language model to hold a key safe shut, and we do not ask them to: the Gatekeeper is a
condition on `job.sealed`, and it is four lines long. Provenance classes are likewise a
property of the acceptance *rule*, not of any model's confidence, so classification is a
lookup rather than a judgement.

That line is drawn in exactly one place and drawn honestly. Where a decision needs perception,
language, or an open-world judgement, a model makes it. Where a decision needs to be the same
every time, code makes it.

**Why the Skeptic is separate from the Inspector.** A model asked to both evaluate evidence
and doubt it will do the first and neglect the second. The Skeptic gets its own prompt, its
own incentive, and no sight of the Inspector's conclusion.

**Why the Inspector can ask for more.** Verification is rarely pass or fail — usually it is
*not yet*. So the Inspector can append a field to the live form and hand it back: *"the label
is out of focus, photograph it again."* Every step caps how often it may do this; on exhausting
that budget it escalates to a person with the specific unresolved question, never silently.

**Why the gate is the point.** Every agent above produces a record. The gate stops
a machine going out to somebody — and its hold is physical, not a notification. The keys are
in a safe the relay controls. A held machine is a drawer that does not open.

**Why Wright exists.** Every instrument speaks its own dialect, and writing a driver per tool
is the long-tail work that stops a platform like this from generalising. Wright enumerates an
unfamiliar device, infers how it encodes readings, writes the driver, and **runs it against
the live device to see whether the number makes sense.** Generated code that talks to hardware
has ground truth for free.

---

## Architecture

| Layer | Service |
|---|---|
| Reasoning | **Gemini 3.5 Flash** via Vertex AI |
| Volume classification | **Gemma** |
| Framework | **Agent Development Kit** |
| Long-running jobs spanning days | **Agent Engine** |
| Publishing and versioning agents | **Agent Registry** |
| Asset history across services | **Memory Bank** |
| Per-agent zero-trust access | **Agent Identity** |
| Routing and policy | **Agent Gateway** |
| Guardrails on model input and output | **Model Armor** |
| Traces and audit logs | **Agent Observability** |
| Services and transport | **Cloud Run**, **Pub/Sub** |
| Source of truth | **Firestore** |
| Where the answers appear | **Google Workspace** — the ledger, the records, the drafted orders |
| Machine-to-machine | **MCP server** on Cloud Run |
| The technician's client | **Android, native** — Kotlin, CameraX, platform BLE, offline queue, on-device redaction |
| Identity and tenancy | **Google Sign-In** — a Workspace domain is an enterprise |
| Landing page and dashboard | **Cloud Run** |
| Adversarial corpus | **Veo** — synthetic fraudulent evidence, to attack our own Skeptic |

Full design, including the evidence chain and the strictness parameters:
[`docs/architecture.md`](docs/architecture.md)

**Why the governance components are load-bearing rather than decorative.** This system holds
real customer data, real financial records, and photographs containing faces and number
plates, and it produces records people will rely on in disputes. If it cannot prove who
decided what, under which procedure version, with which model, at which moment, then it has
produced paperwork again. **A record you cannot audit is a tick in a box with extra steps.**

### For other systems

```
list_procedures    what this shop knows how to do, and at which version
open_job           start a procedure against an asset
step_status        what evidence a job is waiting on
get_record         the sealed record, its evidence, its provenance classes
inventory          what is on the shelf, what a job will consume
raise_po           draft a purchase order against a shortage
request            send a task to another department, and track the reply
```

**Our own dashboard is an MCP client** — it reads and acts through the same surface any
external caller uses, so this is load-bearing rather than aspirational. The best version of
this product is one nobody has to open.

---

## What it will not do

- **It does not certify workmanship.** A human signs for that, by name.
- **It does not infer what it did not observe.** Blocked view, missing reading, unusable framing — the record says so and the step does not pass.
- **It does not claim tamper-proof evidence.** Captures are timestamped and attributed. A determined faker with time is not the threat model; a record that never got made is.
- **It does not withhold quietly.** Every failure escalates to a person the same day. Wrongly blocking a technician who did the work is a worse harm than the one this exists to prevent.
- **It does not move money.** It drafts charges and orders. A human approves them.
- **It does not surveil technicians.** It watches a procedure, not a person. This is the system that finally lets them prove they did it right.
- **It does not exceed its budget.** The Treasurer holds a hard ceiling and refuses past it rather than asking forgiveness.

---

## Proven on

A working motorcycle rental fleet — real machines, real customers, real money.

Servicing runs against published procedures with instrument readings attached. Condition is
captured before a bike goes out and after it returns. Parts are consumed and reordered.
Machines are held when the record does not hold up.

It was chosen because it is a real business with a real liability problem — a bike with
unserviced brakes goes out to a stranger — and because the evidence generates itself daily
without anyone needing to be recruited.

**Where this goes:** the same fleet with different procedures — plant and machinery, equipment
hire, marine, agriculture, commercial vehicles, facilities, and eventually the regulated
industries already doing this by hand at enormous cost.

Warrant is not a maintenance app for motorcycles. It is the assurance layer for anyone whose
records are currently a tick in a box.

---

## Evidence

Every number here is produced by the running system and checkable against the public log.

<!-- FILL FROM THE RUNNING SYSTEM BEFORE SUBMISSION -->
| | |
|---|---|
| Procedures published | _pending_ |
| Jobs performed | _pending_ |
| Steps verified | _pending_ |
| Steps that asked for more evidence | _pending_ |
| Steps refused | _pending_ |
| **Instrument readings captured** | _pending_ |
| **Machines held out of service** | _pending_ |
| Purchase orders drafted | _pending_ |
| Days run unattended | _pending_ |
| Cost per job, by strictness | _pending_ |
| **Total spend** | _pending_ |

Public decision log: <!-- URL --> _pending_

---

## Running it

### Prerequisites

- A Google Cloud project with billing enabled; Vertex AI, Agent Engine, Cloud Run, Pub/Sub and Firestore enabled
- Python 3.12+, Node 20+
- An Android device
- Optionally, any BLE instrument you want readings from

### Setup

```bash
git clone <repo> && cd warrant
cp .env.example .env          # project, region, credentials
./scripts/bootstrap.sh        # Firestore, procedure store, registry entries
./scripts/deploy.sh           # agents to Agent Engine, services to Cloud Run
cd client && npx expo run:android
```

### Verify

```bash
./scripts/smoke.sh            # runs a full procedure against recorded fixtures
```

The smoke test uses fixtures rather than a live job, so it is safe to run on a fresh project
with no hardware, no machines, and nothing at risk.

---

## Disclosure

Warrant is a greenfield project, created inside the All Things Agentic submission period
(3–31 August 2026). No source is carried over from any earlier work.

Prior projects by the same author informed its thinking and are named here because the rules
require pre-existing work to be disclosed: **Nucleus Brain** (multi-agent operations with
human approve/reject governance and an immutable audit trail), **DerbyFish** (evidence-graded
verification of a claimed event), **Hearth** (describe an outcome in plain words and let the
system work out the steps), and **TollRoad** (per-unit metering). Concepts only — every line
of Warrant was written during the submission period.

---

## Licence

See [`LICENSE`](LICENSE).
