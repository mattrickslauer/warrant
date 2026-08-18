# Warrant

**Maintenance records that are evidence, not paperwork.**

> **Working name.** A warrant is a guarantee that a thing is as represented. Change it
> before submission if something better lands.

---

## The tick in the box

Somewhere right now, a technician is ticking a box that says *brake pads replaced*.

Maybe they replaced the brake pads. Probably they did. The record says so either way,
because the record is a tick in a box, and a tick in a box is not evidence of anything. It
is a claim by an interested party, stored in a system designed to accept it.

This is the trust model for maintenance across almost every industry on earth. It is why
skipped servicing is endemic, why falsified maintenance records are a recognised category
of fraud, and why the person who *did* do the work correctly still cannot prove it when a
dispute arrives eight months later.

There is one industry that solved this.

## What aviation did, and why you can't afford it

An aircraft's maintenance logbook is legally binding. Every life-limited part carries a
traceable certificate. Every task is signed by a licensed engineer against a published
procedure. Nothing flies until the paperwork says it can, and the paperwork means something
because falsifying it is a criminal act with a name.

**It works.** It is also one of the most expensive administrative regimes ever built, and it
is affordable only because the airframe underneath it is worth tens of millions of dollars.

Everyone else — the rental fleet, the plant floor, the equipment hire yard, the marine
operator, the contractor with nine machines — gets the tick in the box. Not because their
failures are less consequential to the person standing next to the machine, but because
assurance has always been priced as human attention, and human attention does not scale down.

**Warrant is the aviation regime at a price a nine-machine operator can pay.**

## And one industry already worked out how

Every time a courier drops a parcel, a stranger performs an unsupervised task and proves it
in about four seconds. Arrived — GPS confirms it. Right address — confirmed. Gate code
needed? Only then are you asked. Left at the door — photograph, timestamped, attached.

Nobody calls that verification infrastructure, but that is exactly what it is, and it is the
most successful deployment of it in history. It works because of three choices:

- **The worker never decides what evidence to capture.** The app asks, one step at a time.
- **It will not advance without it.** The proof is a gate, not a form field at the end.
- **The flow branches.** Steps appear only when the situation calls for them.

Maintenance has none of that. It has a clipboard, a tick, and a signature at the bottom.

**Aviation set the standard. Delivery worked out the price.** Warrant is the first and the
second at the same time, pointed at any procedure you can write down.

---

## What Warrant is

A platform for building maintenance procedures that **prove themselves as they are performed.**

You define a procedure once. Each step declares what would count as evidence that it
happened. A technician works through it on their phone. A fleet of agents verifies each step
against its own standard, and the moment a step passes, whatever should happen next happens
on its own — parts are consumed, stock is reordered, the work order advances, the asset is
released.

Nothing about that requires anyone to remember anything, and nothing in the finished record
rests on someone's word.

### 1. Define the procedure

You describe the job in plain language. An agent interviews you until the ambiguity is gone —
*what counts as done, what disqualifies it, what has to be measured, what a technician is
allowed to decide on their own* — and compiles the answers into a versioned, machine-checkable
procedure.

```
procedure: front-brake-service · v3
  step 1  remove wheel            evidence: photo, wheel off, caliper visible
  step 2  identify old pad        evidence: photo of removed pad — wear must be consistent
                                            with the logged service interval
  step 3  present new part        evidence: photo of part and label before fitting
  step 4  fit and torque          evidence: TORQUE READING 28 Nm ±2 from a paired tool
  step 5  function check          evidence: video, lever travel and return
  disqualifies: elapsed time under 12 minutes · non-contiguous session ·
                part number not matching the work order
  releases: bike returns to service · consume 1× pad set · reorder if stock < 2
```

That document is the product. Everything downstream is machinery.

### 2. Perform it, one step at a time

The technician opens the job on their phone and is walked through it exactly the way a
courier is walked through a drop. One step on screen. Capture the thing. Next.

```
  STEP 3 OF 7 — present the new part

  Photograph the part and its label before fitting.
  ────────────────────────────────────────────────
  [ camera ]                          ● recording

  ✓ label legible
  ✗ part number reads 45022-K —  work order expects 45022-KA

  → Is this a supersession?   [ yes, and why ]   [ no, wrong part ]
```

The step does not advance until its evidence exists, and the agent watching is doing more
than checking a box. It sees what the technician sees, and it **branches the flow when
reality disagrees with the plan** — a part number that does not match, wear that is
inconsistent with the service interval, a reading outside tolerance. Each of those opens the
step it needs and closes it again.

That is where a procedure stops being a checklist and starts being a conversation with a
record attached. **Nothing is typed in.** Evidence is captured, not entered.

### 3. Connect the instruments

A photograph tells you a job was done. **A torque wrench tells you it was done right.**

Warrant pairs with the tools that already produce numbers, and takes their readings directly:

| Instrument | What it settles |
|---|---|
| **Bluetooth torque wrench** | Fastener tightened to specification, at a timestamp, on this job |
| Digital calipers / micrometer | Wear limits, disc thickness, clearances |
| Tyre pressure and tread gauges | Condition against a threshold |
| OBD / CAN reader | Fault codes cleared, odometer at service |
| Multimeter, thermal camera, borescope | Electrical, thermal, and internal states a camera outside the housing cannot reach |

This is the difference between a system that observes work and one that **measures** it, and
it is the reason Warrant can make claims that a camera alone never could.

### 4. Let the verified step act

A passed step is not a green tick. It is a trigger.

Parts come out of stock. A reorder is raised if the shelf drops below its floor. The work
order advances. The asset's service history updates. When the last step passes, the machine
is released — and until then, **it is not.**

### 5. It lives where the business already lives

Small operators do not run on dashboards. They run on a spreadsheet, an inbox, and a folder
of photographs. Asking them to adopt another system is how good tools die.

**Warrant works inside Google Workspace.** Procedures are documents. The parts ledger is a
sheet, updated as steps consume stock. Purchase orders are drafted and sent from the
operator's own mail. Signed records land in Drive, shareable with a customer or an insurer as
an ordinary link. A request to another department is an email a person can simply reply to.

The agents do the work in the tools that were already open. Nobody has to log in to anything
to find out what happened.

### 6. Other systems can drive it

Warrant exposes itself over the **Model Context Protocol**, so the fleet is infrastructure
rather than a destination:

```
list_procedures       what this shop knows how to do, and at which version
open_job              start a procedure against an asset
step_status           what evidence a job is waiting on
get_record            the sealed record, its evidence, and its provenance classes
inventory             what is on the shelf, what a job will consume
raise_po              draft a purchase order against a shortage
request               send a task to another department, and track the reply
```

An operator's own assistant can ask what is overdue and start the job. A finance system can
pull the ledger. Another agent can raise the order. The best version of this product is one
nobody has to open.

---

## What "verified" actually means

Warrant never claims a job was good. It closes off the ways the record could be false, and
it states exactly which ways it closed. Every piece of evidence is filed into one of three
classes, and they are never allowed to blur:

| Evidence | Class | Example |
|---|---|---|
| An instrument reading, taken by a paired tool | **measured** | `28.4 Nm · 14:32:07 · tool #A19` |
| Capture integrity — contiguous session, device attestation, timing | **measured** | no gap between step 3 and step 4 |
| What the media appears to show | **inferred** | the pad looks correctly seated |
| Craft quality and judgement | **asserted** | the technician signs their name to it |

**An inferred value may never overwrite a measured one**, and the record renders the three
differently. The model is allowed an opinion about whether a pad looks seated. It is not
allowed an opinion about the torque, because a tool already answered that and tools do not
have opinions.

### What Warrant will not tell you

It does not judge workmanship from a photograph. It cannot see whether a bolt was
cross-threaded, whether a caliper seated properly, or whether a fluid is the right grade.
Any system claiming to assess craft quality from video is guessing, and guessing is worse
than nothing in a record people will rely on years later.

**What it establishes is that the work happened, with these parts, on this machine, at this
time, to these measured values — and it refuses when it cannot establish that.**

That is a narrower claim than "we verify maintenance," and it is the one that is true. It
also happens to address the failure that actually occurs, which is not bad work. It is work
that never happened.

---

## The fleet

Eight agents. Each does one narrow job; the work it finishes is what wakes the next.

| Agent | What it does |
|---|---|
| **Scoper** | Interviews you until a procedure is unambiguous, then compiles and versions it |
| **Instructor** | Walks the technician through the job in real time, seeing what they see |
| **Inspector** | Verifies each step's evidence against that step's own standard |
| **Skeptic** | Adversarial. Is this evidence from this job, this machine, this moment |
| **Quartermaster** | Parts. What the step consumed, what is on the shelf, what a shortage blocks |
| **Buyer** | Purchase orders, reorder points, lead times, supplier follow-up |
| **Registrar** | Seals and signs the record. The logbook nobody can quietly edit |
| **Gatekeeper** | Refuses to release the machine. Overdue, unverified, or out of tolerance |

The **Treasurer** meters what the fleet spends and stops at a ceiling. The **Chronicler**
writes every decision to a public log, so any claim in this document can be checked by a
stranger.

**Why the Skeptic is separate from the Inspector.** A model asked to both evaluate evidence
and doubt it will do the first and neglect the second. The Skeptic gets its own prompt, its
own incentive, and no sight of the Inspector's conclusion — it is looking for a photo from a
different bike, a reading from yesterday, a session with a gap in it.

**Why the Gatekeeper is the point.** Every other agent produces a record. The Gatekeeper is
the one that stops a machine going out to somebody, and it is the only part of this system
that protects a person who has no idea it exists.

---

## What it will not do

- **It does not certify workmanship.** A human signs for that, by name.
- **It does not infer what it did not observe.** Blocked view, missing reading, unusable framing — the record says so and the step does not pass.
- **It does not withhold quietly.** Every failure escalates to a person the same day, because wrongly blocking a technician who did the work is a worse harm than the one this exists to prevent.
- **It does not charge anybody automatically.** It can propose. A human approves.
- **It does not surveil technicians.** It watches a procedure, not a person. The technician is the beneficiary of proof, never its subject — this is the system that finally lets them prove they did it right.
- **It does not exceed its budget.** The Treasurer holds a hard ceiling and refuses past it rather than asking forgiveness.

---

## Architecture

Warrant runs on Google Cloud.

| Layer | Service |
|---|---|
| Verification and reasoning | **Gemini 3.5 Flash** via Vertex AI |
| The agent at the technician's shoulder | **Gemini 3.5 Live API** — real-time, sees what they see |
| Agent framework | **Agent Development Kit (ADK)** |
| Runtime | **Agent Engine** — long-running, pause and resume across a job that spans days |
| Discovery and lifecycle | **Agent Registry** — where compiled procedures are published and versioned |
| Cross-job context | **Memory Bank** — asset history held across weeks and services |
| Access control | **Agent Identity** — zero-trust, per agent |
| Routing and policy | **Agent Gateway** |
| Inline guardrails | **Model Armor** — faces, plates and customer data redacted before anything leaves the device |
| Telemetry | **Agent Observability** — OpenTelemetry traces, end-to-end reasoning chains |
| Services, transport, scheduling | **Cloud Run**, **Pub/Sub** |
| Instruments | BLE pairing on the technician's phone — torque wrenches, gauges, readers |
| Where the business works | **Google Workspace** — Sheets for the parts ledger, Docs for procedures, Gmail for orders and requests, Drive for sealed records |
| Machine-to-machine surface | **MCP server** on Cloud Run — inventory, purchase orders, cross-department requests |
| Volume classification | **Gemma** — the cheap pass over routine evidence |
| Adversarial corpus | **Veo** — synthetic fraudulent evidence, generated to attack our own Skeptic |

Full design: [`docs/architecture.md`](docs/architecture.md)

**Why the governance components are load-bearing rather than decorative.** This system holds
real customer data, real financial records, and photographs containing faces and number
plates, and it produces records that people will rely on in disputes. If it cannot prove who
decided what, under which procedure version, with which model, at which moment, then it has
produced paperwork again. **A record you cannot audit is just a tick in a box with extra
steps.**

**Why procedures live in Agent Registry.** A compiled procedure is a versioned, discoverable
artifact — exactly what the Registry exists to hold. A shop that writes a good brake service
publishes it; the next shop adopts v3 rather than starting from nothing. That is a
marketplace we do not have to build, because it is a capability we already have.

---

## Attention is metered

Verification costs money, so Warrant bills **per agent-minute** and the Treasurer decides
what each step earns. A torque-critical step gets full attention. A visual tidy-up gets a
cheap pass. Below threshold the fleet declines to spend and says so.

Nobody has published what it costs to keep an agent watching work in progress. Warrant ships
an itemised ledger — per procedure, per step, per refusal. If the number is bad, we will say
it is bad.

---

## Proven on

A working motorcycle rental fleet, with real machines, real customers, and real money.

Every service and every handover runs through Warrant: condition captured before a bike goes
out and after it returns, damage found and charged only with a human's approval, servicing
performed against published procedures, parts consumed and reordered automatically, and
machines withheld when the record does not hold up.

It was chosen because it is a real business with a real liability problem — a bike with
unserviced brakes goes out to a stranger — and because the evidence generates itself daily
without anyone having to be recruited.

### Where this goes

The same fleet with a different procedure: plant and machinery, equipment hire, marine,
agriculture, commercial vehicle fleets, facilities, and eventually the regulated industries
that already do this by hand at enormous cost.

Warrant is not a maintenance app for motorcycles. It is the assurance layer for anyone whose
records are currently a tick in a box.

---

## Evidence

Every number here is produced by the running system and checkable against the public log.

<!-- FILL FROM THE RUNNING SYSTEM BEFORE SUBMISSION -->
| | |
|---|---|
| Procedures published | _pending_ |
| Jobs performed through Warrant | _pending_ |
| Steps **verified** | _pending_ |
| Steps **refused** | _pending_ |
| Instrument readings captured | _pending_ |
| Machines withheld from service | _pending_ |
| Purchase orders raised without a human | _pending_ |
| Days run unattended | _pending_ |
| Cost per verified procedure | _pending_ |
| **Total spend** | _pending_ |

Public decision log: <!-- URL --> _pending_

---

## Running it

### Prerequisites

- A Google Cloud project with billing enabled; Vertex AI, Agent Engine, Cloud Run and Pub/Sub enabled
- Python 3.12+
- A phone
- Optionally, any BLE instrument you want readings from

### Setup

```bash
git clone <repo> && cd warrant
cp .env.example .env          # project, region, credentials
./scripts/bootstrap.sh        # datastore, procedure registry, vector index
./scripts/deploy.sh           # agents to Agent Engine, services to Cloud Run
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
