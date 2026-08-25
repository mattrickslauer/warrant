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
  step 4  fit and torque        MEASUREMENT — within(6, 9, "Nm"), from a paired tool
  step 5  function check        video — lever travel and return
  disqualifies: step elapsed under 12 min · part number mismatch
  releases: return to service
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
states exactly which ways it closed. Every piece of evidence is filed into one of four
classes, and they never blur:

| Evidence | Class |
|---|---|
| A reading from a paired instrument · `90.4° · 14:32:07 · tool #A19` | **measured** |
| A part number matching the work order | **measured** |
| A torque figure cited from the manufacturer's manual, with document and page | **specified** |
| What a photograph appears to show | **inferred** |
| Craft quality and judgement | **asserted** — signed, by name |

**An inferred value may never overwrite a measured one.** The model is allowed an opinion
about whether a pad looks seated. It is not allowed an opinion about the angle, because a tool
already answered that, and tools do not have opinions.

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

**Seven agents over a deterministic core.** Each agent does one narrow job that genuinely
requires a model; everything that must be trustworthy rather than clever is ordinary code.

| Agent | What it does |
|---|---|
| **Scoper** | Interviews you until a procedure is unambiguous, then compiles and versions it |
| **Foreman** | Owns one job for its whole life. Delegates, chases, re-opens, escalates — and decides what happens when a step cannot be done at all |
| **Inspector** | Passes the step, asks for more evidence, or escalates to a person |
| **Skeptic** | Adversarial. Does this evidence belong to this job, this machine, this moment |
| **Auditor** | Sweeps sealed records across weeks and finds the procedure defects hiding in them |
| **Instructor** | Answers questions out loud on a held button, and can amend the job |
| **Wright** | Meets an unfamiliar instrument, works out how it speaks, writes the driver |

**Rejected as agents: a Planner and a Quartermaster.** Scheduling is arithmetic and reorder
logic is a traversal. Both would have been switch statements in costume, and their judgement
halves fold into the Foreman. The count is seven because seven things need a model.

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
language model to hold a key safe shut, and we do not ask them to: the Gate is a
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

Every row below is either running or says plainly that it is not. A table claiming a service
this system does not actually call would be a tick in a box, in the README of a product whose
entire argument is that a tick in a box is not evidence.

| Layer | Service | State |
|---|---|---|
| Reasoning | **Gemini 3.5 Flash** via Vertex AI | running — `agents/warrant/model.py`, the one call site |
| Screening every capture | **Gemma** (`gemma-3-4b`) | running — `agents/warrant/screen.py`, in front of the judge |
| Framework | **Google GenAI SDK** (`google-genai`) | running — the live path in `model.py` |
| Long-running jobs spanning days | **Agent Runtime** (Vertex AI Agent Engine) | running — `infra/deploy-agents.py`, three operations |
| Guardrails on model input and output | **Model Armor** | running — image and text, `us` multi-region |
| Traces and reasoning chains | **OpenTelemetry** → Cloud Logging / Cloud Trace | running — `web/src/server/trace.ts` |
| Adversarial corpus | **Veo** | offline — `agents/evals/gen_fraud.py`, generates the fraud the Skeptic is tested against |
| Per-agent least privilege | service-account impersonation | running — `warrant-web` may not call Vertex; see `server/fleet.ts` |
| Asset history across weeks | the `readings` series in Firestore, **not Memory Bank** | **deliberately not adopted** — see below |
| Agent discovery | the fleet's own `roster()`, **not Agent Registry** | **not adopted** — it would publish agents, and procedures are what need versioning |

**Memory Bank is the one absence worth reading.** Memory Bank consolidation is LLM-judged and
treats two readings of one field as a contradiction to reconcile — which destroys exactly the
series a wear rate is computed from. `consistent_with` resolves against the `readings` series
instead, and `docs/architecture.md` §4 sets out the argument. Adopting a memory product to have
one in this table would contradict the best architectural decision in the repository.

**Agent Gateway and Agent Identity are not in here either**, because nothing in this system
calls them. Routing is one client (`server/fleet.ts`) against one engine, and identity is
Google Sign-In plus service-account impersonation. Both are named in the track's recommended
stack; neither is load-bearing here, and inventing a use for them would cost more than the row
is worth.
| Services and transport | **Cloud Run**, **Pub/Sub** |
| Source of truth | **Firestore** |
| Where the answers appear | **Google Workspace** — the ledger, the records, the drafted orders |
| Machine-to-machine | **MCP server** on Cloud Run |
| The technician's client | **Android, native** — Kotlin, CameraX, platform BLE, offline queue, on-device redaction |
| Identity and tenancy | **Google Sign-In** — a Workspace domain is an enterprise |
| Web surfaces | **Next.js** App Router, server-rendered, on **Cloud Run** |
| Adversarial corpus | **Veo** — synthetic fraudulent evidence, to attack our own Skeptic |
| Task imagery | **Gemini image generation** on Vertex AI — generated for this project, no third-party marks |

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

### Run the whole thing with no cloud account at all

Every surface reads and writes through one `DataSource` interface with two implementations,
so the product runs end to end against recorded fixtures with **no Google Cloud project, no
credentials and no hardware.** This is the fastest way to see what it does.

```bash
git clone https://github.com/mattrickslauer/warrant && cd warrant
cd web && npm install && npm run dev      # http://localhost:3000
```

Pick a task, work through it, and you land on a sealed record. Requires **Node 20+** and a
camera — capture is a live camera view, never a file picker, because an uploaded image says
nothing about when or where it was made.

### Verify

```bash
./scripts/smoke.sh
```

Runs a full procedure end to end against recorded fixtures: the agent schemas are checked
against the subset Vertex accepts, the tokens generate for both stacks, every fixture
typechecks against the contract, every surface builds from `FixtureSource` alone, **no tenant
can reach another tenant's data** — proved by running `firestore.rules` in the Firestore
emulator, not by asserting it — and, if Playwright is installed, a real browser drives a
procedure to a sealed record with a synthetic camera. Nothing runs against a project and
nothing is at risk.

### Connecting it to Google Cloud

```bash
cp .env.example .env                # project, region, models
./infra/bootstrap.sh                # enables every API this needs, once
gcloud firestore databases create --location=nam5
./infra/deploy-rules.sh             # tenancy rules and the composite indexes
./infra/deploy-web.sh               # the app to Cloud Run
```

There is one further check that is **deliberately not** in `smoke.sh`, because it needs
credentials and writes to a real project:

```bash
set -a; . web/.env.local; set +a
cd web && node --experimental-strip-types --conditions=react-server \
  --import ./scripts/ts-resolve.mjs --test scripts/claim.test.mjs
```

That exercises claiming an anonymous tenant — a recursive copy across an arbitrarily deep
document tree, then a delete. It is the riskiest code in the auth layer and the one path that
cannot be reached by clicking through the product, because getting there requires linking a
real Google account to an anonymous session. It cleans up after itself.

**No key is ever created.** `deploy-web.sh` attaches a least-privilege service account
(`firebaseauth.admin` to mint session cookies, write the `hd` claim and check revocation;
`datastore.user` for Firestore), and Cloud Run's metadata server hands the container
short-lived credentials. There is no long-lived secret to leak, rotate, or commit. For local
development against the real project you need Application Default Credentials —
`gcloud auth application-default login` — and without them the surfaces fall back to
`FixtureSource` and say so, which is a supported state rather than a failure.

**Sign-in is the only part with a manual step, and there is exactly one.** Adding Firebase to
the project, registering the web app and enabling anonymous sign-in are all API calls, and
`infra/bootstrap.sh` prints them. Enabling the **Google** provider is not: it needs an OAuth
client, and no public API creates one. Toggle it once in the Firebase console under
*Authentication → Sign-in method → Google*, which creates the client for you, then copy the
`NEXT_PUBLIC_FIREBASE_*` values into `.env`.

Once it is on, the identity model in [`docs/architecture.md`](docs/architecture.md) §7 is live:
a Workspace account lands in its employer's tenant, a personal account in a tenant of one, and
a visitor who never signs in gets a real tenant that is migrated into their account if they
later do. **Tenancy is enforced by Firestore itself** — `firestore.rules` is executed against
the real rules engine on every `./scripts/smoke.sh`, so the isolation claim is a test rather
than a paragraph.

The Android client is **native Kotlin and Jetpack Compose** — CameraX and the platform BLE
stack, no bridge — and it is where the instrument path lives. It consumes the same generated
contract as the web surfaces.

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
