# Warrant — Development Lifecycle Design

**Date:** 2026-08-18 · **Deadline:** 31 Aug 2026, 17:00 PT · **Days remaining:** 13

The build is presentation-first: the product's surfaces are designed and made clickable
against fixture data before any backend exists, then services are hooked in behind a single
seam. Parallel agents do the fan-out; the reference surfaces are hand-built.

**This document supersedes `README.md`, `docs/architecture.md`, `docs/data-model.md`,
`SCRIPT.md` and `site/index.html` wherever they disagree with it.** §11 lists every edit those
documents need. §13 records the corrections applied to this spec on 18 Aug and why.

---

## 1. Goal and priorities

Win the Grand Prize at All Things Agentic. Category: Fortified Enterprise Fleet.

Priorities, in order:

1. **Presentation.** A judge may never run anything. What they open must be complete.
2. **A stranger can use it, and then understands the real product.** The hosted URL drops an
   anonymous visitor into a working procedure in seconds, then shows them what they *could not*
   prove from a browser and where to go for it. No winner in the prior cohort had this.
3. **Legible agent delegation.** The fleet must visibly delegate, not pipeline.
4. **Proof on Google Cloud.** Deployed early, traced, logged.

This is a hackathon. A capability that is coded and demonstrable counts as delivered.
Runtime duration, user counts and fleet size are demonstration problems, not blockers.

---

## 2. The canonical fleet — seven agents over a deterministic core

Three documents currently disagree (`README.md` says five, `docs/architecture.md` says five,
`site/index.html` ships nine with core services dressed as agents and states "None of them
calls another"). `SCRIPT.md` shot 29 says five out loud, on camera. This section supersedes all
four.

| Agent | Job | Why a model is required |
|---|---|---|
| **Scoper** | Interviews until a procedure is unambiguous; compiles and versions it; imports an existing Form or sheet | Open-ended language; must track what it has not yet asked |
| **Foreman** | Owns one job for its whole life; delegates to specialists; decides when to chase, re-open, escalate; **disposes of a step a technician says they cannot do** | Long-horizon state and delegation under ambiguity (§4) |
| **Inspector** | PASS / ADD FIELD / ESCALATE on evidence that arrived; composes the specific next request | Reading media; generating the precise next ask |
| **Skeptic** | Does this evidence belong to this job, this machine, this moment — via multimodal embeddings against asset history | Perceptual identity |
| **Auditor** | Sweeps sealed records across weeks; finds procedure defects; hands revisions to the Scoper | Pattern-finding over unstructured evidence, **and reading blocked-step reasons as direct defect reports** (§4) |
| **Instructor** | Answers on the held button **and can amend the job** — log a fault, open a defect | Spoken questions plus intent to action |
| **Wright** | Writes a driver for an unfamiliar instrument | Codegen with a live test-retry loop |

**Deterministic core, no model:** Seal (stamps provenance class) · Gate (holds the machine) ·
Ledger (spend ceiling, public decision log) · Scheduling (intervals, usage, lead times — the
Foreman consults it) · Stock arithmetic · Circuit breaker · **Adjudication: Skeptic dissent
forces escalation.**

Rejected: **Planner** and **Quartermaster** as agents. Scheduling is arithmetic and reorder
logic is a traversal; both are defensible only in conflict cases and would be attacked as
switch statements in costume. Their judgement halves fold into the Foreman.

**Why the Foreman is the load-bearing addition.** Without it the system is a pipeline where
code routes, and the FEF criterion "does the system intelligently delegate tasks to
specialized sub-agents" goes unanswered. The Foreman also makes Agent Runtime load-bearing
and makes week-spanning operation structural rather than asserted.

**How the Foreman outlives its runtime.** Agent Runtime caps a single execution at seven days;
a job whose life is a service interval or a purchase-order lead time is longer than that. The
Foreman is therefore a **resumable state machine whose state is Firestore plus Memory Bank**,
and the runtime is where a *session* lives, not where the job lives. It wakes on a Pub/Sub
event, reads its job, acts, writes, and exits. Continuity is the record, not the process.
Anything else fails the first question an Agent Engine-literate judge asks.

**Adjudication, precisely.** Skeptic dissent is not a veto with no appeal — `README.md` is
right that wrongly blocking a technician who did the work is the worse harm. Dissent is a
**deterministic escalation trigger**: the step does not pass, the job escalates to a named
person the same day, and the dissent is on the record. Deterministic in that no model decides
whether to honour it. Call it that everywhere; "veto" invites the attack.

---

## 3. Information architecture

The web app is the product's front door. The root is a working demo, not a marketing page —
but it funnels, and `/about` is where the real business is explained.

| Route | What it is | Auth |
|---|---|---|
| **`/`** | **The verified-task demo.** Pick a simple task, do it, land on a sealed record, see what a browser could not prove | None |
| `/r/<id>` | The sealed record — the clickable artifact, carrying its **verification ceiling** | None for anon and demo tenants; private otherwise |
| `/about` | **The B2B explainer.** What this is for real fleets: procedures, tenancy, the agent fleet, the enterprise posture | None |
| `/board` | Operator / judge view — work orders arriving, agent decisions streaming, machines held | None (read-only demo tenant) |
| `/procedures` | Procedure list, versions, the Scoper conversation | Claimed · **judge token** |
| `/jobs` | Open, waiting on evidence, held | Claimed · **judge token** |
| `/ledger` | Spend per job and per strictness; the public decision log | None |

**The judge must be able to see the FEF surfaces.** `/procedures` and `/jobs` are where
"catalogued for cross-department use" and "context across weeks" actually live, and the rules
require the project be available *without restriction* to the judges. A seeded demo tenant
reachable at `?judge=<token>`, read-only, named in the Devpost text and the README. Without
this the two screens the category scores are behind a login nobody will pass.

### Identity — anonymous first, claim later

Modelled on `~/Code/aws-hackathon` (Sonar), which lands directly on the app with no sign-in.

- A `warrant_uid` UUID is created in `localStorage` on first load. It is a tenant of one.
- The anonymous account row is created lazily on the **first meaningful write** (first
  capture), never on page load.
- Server identity precedence: session cookie (claimed account) wins; otherwise the anon id,
  which must be an **unclaimed** account — a claimed id is rejected so nobody can write as
  someone else.
- **Google Sign-In becomes a claim action**, not a wall. Claiming upgrades the anon account
  in place and keeps its records. The existing tenancy rule survives: claim with a personal
  account and you keep a tenant of one; claim with a Workspace account and the `hd` domain
  becomes the enterprise.
- **The only gate is camera permission**, and even that is optional — see the replay path
  below. Never an identity gate.

---

### 3.1 Verification tiers — the ladder, and the whole pitch in one screen

**A provenance class is a property of the capture path, not of how hard we tried.** A browser
cannot produce a measured value. It has no paired instrument, no device attestation, and its
sensor readings are supplied by the person being verified and are trivially spoofable from
devtools. Saying so plainly is not a limitation to be hidden — **it is the product's argument,
demonstrated on the visitor's own record.**

| Tier | Surface | Highest class reachable | What unlocks it |
|---|---|---|---|
| **Open** | Any browser, no install, no account | **inferred** — a photo the Inspector reads, plus an `asserted` signature | Nothing. This is `/` |
| **Attested** | The Android app | **inferred, device-attested** — capture provenance, on-device redaction, offline queue, Play Integrity | Install the app |
| **Instrumented** | The app plus a paired instrument | **measured** — a number with a tool identity and a timestamp, untouched by human hands | Pair a tool |

The sealed record renders this as a **ceiling**: three class rows, the unreachable ones greyed,
each with the one-line reason it is out of reach at this tier. *"`measured` requires a paired
instrument. This record was made in a browser."*

**That greyed row is the call to action, and it is honest.** Not "sign up for more features" —
*this is the strongest evidence your surface can make, and here is what the next one can.*
A visitor who reads it has understood the entire taxonomy without being taught it.

**Tiers are not strictness.** Strictness (`architecture.md` §4) is how much evidence a
*procedure* demands. A tier is what a *surface* can supply. They meet at one rule:

> A procedure requiring a `measured` field, attempted on a surface that cannot produce one, is
> **refused before it starts** — never downgraded, never substituted.

That refusal screen is a demo asset, not an error. It is the Gate's logic applied to the
visitor, and it is the cheapest possible proof that the classes do not blur under pressure.
It is also the second call to action, arriving at exactly the moment it means something.

### 3.2 The verified tasks at `/`

Simple, real, doable at a desk in under a minute, **no location, no timer, no equipment**.
Elapsed-time disqualifiers and geolocation are removed entirely: both are attacker-controlled
on the Open tier, and a clock that pressures a stranger holding a knife is a liability we do
not need.

| Task | inferred | asserted | Why this one |
|---|---|---|---|
| **Cut a banana** | Photo shows even slices | Knife stored safely, signed | Memorable, universal, and the scalability line: same fleet, same engine, a banana instead of a brake caliper |
| **Replace a lightbulb** | Photo shows the new bulb fitted and lit | Old bulb disposed of, signed | The most universal maintenance task on earth |
| **Test a smoke alarm** | Photo of the pressed test button; audio capture of the sounder | Date noted on the unit, signed | A genuine domestic safety procedure — the stakes are real and the visitor knows it |
| **Check a tyre with a coin** | Photo of the coin in the tread | Reading judged above or below the line, signed | **The bridge.** A coin gives a threshold, not a number — the exact gap the Instrumented tier closes, on the exact machine class the real fleet runs |

The tyre task is the one that earns its place twice: it teaches threshold-vs-number, and it is
one step removed from the brake job the video films.

**Every task carries the second exit.** No banana, no ladder, no coin — say so, by voice or by
typing, and the sealed record states that the step was not performed and why (§4). This is not
the sad path. It is the clearest thirty seconds the public surface has: **a record that says
nothing happened, and is honest about it**, which is the one thing a paper checklist can never
do. Expect a meaningful share of visitors to take it, and treat the resulting records as
first-class artifacts rather than failures.

**The zero-friction entry.** A judge on a desktop with no camera must not hit a dead end on the
surface priority 2 depends on. `/` opens on a **replay of a real sealed record**, stepping
through capture → verdict → seal in about twenty seconds, no permissions requested. "Do one
yourself" is the upgrade, not the toll gate. The replay is also the demo that always works,
on any device, in any network condition, in front of anyone.

### 3.3 `/about` — the B2B explainer

Not a migration. The current landing page is a good artifact but it is the *old* pitch, with
nine agents and a courier flow built from third-party logos. `/about` is a rewrite whose job is
to answer, for someone who has just cut a banana on a website: **what is this actually for?**

- The tick in the box, the aviation frame, the delivery frame — the argument, kept.
- The seven agents and the deterministic core, per §2.
- Tenancy: a Workspace domain is an enterprise, a personal account is a tenant of one.
- The enterprise posture — Registry, Identity, Gateway, Memory Bank, Observability, Model
  Armor, Runtime — each with what it does *here*, not what it is.
- Strictness as a purchasable dial, and the ledger that prices it.
- One link onward to `/board`, so the enterprise surface is one click from the explanation.

**The funnel is: do a task → see your ceiling → understand the ladder → read what it is for →
watch it running for real.** That is a judge's route through the product with no dead ends, and
it is the same route a prospect takes.

### 3.4 The app link, and what it is for

The CTA on the Open tier points at the Android client. Its job is **narrative, not conversion** —
no judge is going to sideload an APK, and Play Store review does not fit in thirteen days.

- Direct APK plus a Firebase App Distribution link, both from `/about` and the ceiling card.
- Beside it, always, a thirty-second capture of the app doing the thing the browser cannot:
  BLE pair, reading arrives, `measured` row lights up.
- **The CTA must degrade.** If the Compose client slips to a BLE-and-capture companion (it is
  in the cut order), the link becomes the footage and the ceiling card still reads correctly.
  Nothing on the critical path may dead-end on an install.

---

## 4. The step contract, and the data contract

### The step contract — two exits, never zero

Every step presents the same three things and offers the same two exits. This is the product at
the scale of a single card, and it is what the technician actually experiences all day.

| Element | What it is | Where it comes from |
|---|---|---|
| **The instruction** | What to do | `Field.prompt` |
| **The explanation** | **Why this step exists** — what it protects against, what goes wrong without it | Authored by the Scoper during the interview |
| **What good looks like** | The acceptance rule in plain language, plus a reference capture where one exists | Rendered from `acceptance` |

The third element pays for itself twice. **The same rule the Inspector checks after the capture
is shown to the technician before it** — so the evidence arrives right the first time and the
ADD FIELD round-trip that would have followed never happens. One authored artifact serves both
the human and the verifier, and every round-trip it prevents is a model call the Ledger does not
spend.

#### The two exits

1. **Capture evidence** — the primary action, in the same place on every step, every time.
   Photo, video, scan, signature, or a reading arriving from a paired instrument.
2. **"I can't do this"** — the secondary action, present on every step, never buried.

There is no third exit. **A step can be satisfied or it can be explained. It can never be
silently abandoned**, and there is no back button that loses the reason. That is this product's
entire argument applied to one card: the failure it exists to catch is not bad work, it is work
that never happened and left no trace.

#### When a step cannot be done

The technician says why — hold the button and speak it, or type it. Voice is the default in a
workshop with dirty hands; typing is always available; neither is a gate, and microphone
permission is offered rather than required.

| Stage | Who | What |
|---|---|---|
| Transcribe and read the intent | **Instructor** | *"The bleed nipple is rounded off"* becomes a structured reason, not a free-text blob |
| Recommend, in context | **Instructor** | The next action for the person standing there now, knowing the procedure, the machine and its history |
| Dispose | **Foreman** | What happens to the job, the machine, the booking and the parts order — chase, re-open, escalate, or file a defect |
| Class it | **Seal** | `asserted`. A named human said this, at this time. On the Open tier, a `warrant_uid` and a typed name |

#### Three dispositions, and none of them is "skip"

| Outcome | Meaning | The job | The Gate |
|---|---|---|---|
| **deferred** | Cannot be done now; will be done | Stays open. The Foreman chases, and the blocker — a part, a lift, a specialist — becomes something it tracks across days | Machine stays held |
| **waived** | Not required on this job, authorised by someone with the standing to waive it | Seals with the waiver on the record, signed by name | Releases, and the record says why |
| **impossible** | Cannot be done as written, on any job | Seals as deficient, and the reason is filed as a **procedure defect** | Machine stays held |

**Skipping is a recorded outcome, not an absence.** The step does not vanish and the record does
not go quiet. A sealed record reads *"step 4 not performed — bleed nipple rounded off, stated by
name at 14:22, machine not released."* That sentence is worth more evidentially than a passed
step, because it is the one a paper checklist can never produce.

#### What this closes

- **The Foreman gets its concrete case.** *"A technician cannot do step 4 — what now happens to
  the job, the machine, the customer's booking and the parts order?"* is long-horizon delegation
  under ambiguity in one sentence, which is exactly what §2 claims a model is required for.
- **The Auditor stops guessing.** Its job is finding procedure defects across weeks, and until
  now it had to infer them from patterns. A blocked step is a **direct, human-authored, labelled
  defect report.** A procedure whose step 6 is blocked on two jobs in five is broken, and the
  Auditor can say so with the technicians' own words attached, then hand the revision to the
  Scoper. The revision loop closes with evidence in it rather than inference.
- **The Gate's refusal gets richer.** Held *because a step was explained rather than performed*,
  with the technician's own voice on the record.

**On the Open tier this is the better demo.** A visitor with no banana says so, and gets a sealed
record stating that nothing happened and why. **A record that says nothing happened is still a
record, and it is honest** — which teaches the thesis harder than a successful cut does, and is
the one thing a paper checklist genuinely cannot imitate.

```jsonc
// Step gains
"explanation": "why this step exists",
"guidance":    "what good looks like",          // rendered from `acceptance`

// StepOutcome — one per step, always written, never absent
{ "status": "performed" | "deferred" | "waived" | "impossible",
  "reason":         { "kind": "voice" | "text", "transcript": "…",
                      "audio_ref": "…", "at": "…", "by": "…" },
  "recommendation": { "text": "…", "by": "instructor",
                      "model": "gemini-3.5-flash-…", "at": "…" },
  "disposition":    { "by": "foreman", "action": "chase" | "reorder"
                                     | "escalate" | "revise", "at": "…" },
  "provenance_class": "asserted" }

// Record gains
"deficiencies": [ { "step_id": "s4", "status": "deferred", "reason_ref": "…" } ]
```

`Record.deficiencies` is what the Gate reads. A deficiency against a field that was `required_at`
this job's strictness holds the machine; a waiver signed by someone with standing releases it and
says so on the record. Deterministic, in the core, and still four lines.

### One schema, three consumers

The data model lives once as **JSON Schema in `contract/`** and generates:

1. TypeScript types for the web surfaces
2. Kotlin data classes for the Android client
3. **The structured-output contracts the ADK agents validate against**

The third is the important one: an agent returning something off-schema is rejected
mechanically and retried once, then escalates. That is the hallucination containment the
Architecture criterion asks about by name, and the "intelligent schema design" bullet
answered with an artifact rather than a paragraph.

> **Vertex does not accept JSON Schema.** `responseSchema` takes an OpenAPI 3.0 subset:
> `$ref` is constrained, `oneOf`/`anyOf` support is uneven, `additionalProperties` and most
> `format` values are ignored or rejected. `contract/` is therefore **authored in the subset**,
> and a contract test asserts every agent schema round-trips through `responseSchema`. Left
> unstated this is discovered on day 6, inside the most compressed block in the schedule.

> **Kotlin is hand-written, not generated.** The Compose client touches `Job`, `Step`, `Field`,
> `Capture` and `Reading`. That is under an hour by hand and a day fighting a generator, on day
> 1 of 13, solo, alongside the BLE spike. TypeScript is generated; the Kotlin five are typed;
> a contract test guards the boundary. Same guarantee, a day cheaper, and the day is day 1.

### The entities, reconciled

`docs/data-model.md` and the earlier draft of this section specified **different models**. This
resolves it: **`docs/data-model.md` is correct and this spec adopts it.** It is the more
considered document, the seed catalogue in `seed/` is already fetched against it, and the
type/instance split is a real compliance artifact rather than a schema preference.

**Type space**, no tenant, operator-seeded, read-only:
`SpecNode` · `SpecValue` · `SpecDoc` · `SpecChunk`

**Instance space**, per tenant:
`Tenant` · `Technician` · `Node` (the asset tree, materialised path) · `Component` +
`Placement` · `Reading` · `Override` · `Procedure` + `Version` · `Step` · `Field` · `Job` ·
`Capture` · `Decision` · `Record` · `Part` · `StockLevel` · `PurchaseOrder` · `Notification`

**Four provenance classes, not three.** `docs/data-model.md` §3 introduces **`specified`** — a
bound cited from a manufacturer's published figure, carrying document, section and page. It is
a genuinely different thing from the other three and it is the reason a sealed record can say
*why that number*. `README.md`, `architecture.md` §1, `site/index.html` and `SCRIPT.md` all
say three and all need the fourth. Its colour token joins the palette in §4.

**Two additions this spec makes to that model**, both required by §3.1:

```jsonc
// on Capture — how this evidence was made
"capture_surface": "browser" | "app" | "app+instrument",
"attestation":     { "play_integrity": "...", "device_id": "..." }   // null on browser

// on Record — derived, never asserted by a model
"verification_ceiling": {
  "tier": "open",
  "reachable": ["inferred", "asserted"],
  "unreachable": [ { "class": "measured",
                     "reason": "requires a paired instrument" } ]
}
```

The ceiling is **computed by the Seal from the capture surfaces present**, in the deterministic
core, alongside provenance classing. It is a lookup, not a judgement, and it must be, because
it is the one thing on the public record that tells a stranger how much to believe it.

### One token source

`design/tokens.json` generates `tokens.css` and `Theme.kt`, seeded from the existing palette
in `site/index.html`: `--work` `#0E1719`, `--rec` `#EDEFEA`, `--rule` `#C6CDC5`,
`--measured` `#0F7A63`, `--inferred` `#C07818`, `--asserted` `#6A5AA0`, plus `--specified`
for the fourth class. Two stacks, one visual language, no drift.

### One seam

Every surface — web and Kotlin — reads and writes through a `DataSource` interface with two
implementations:

- **`FixtureSource`** — seeded JSON, deterministic, offline
- **`LiveSource`** — Firestore plus the agent services

Screens depend on the interface only. **Phase 3 hooks up pipes by swapping one binding per
capability, never by rewriting a screen.**

> **`FixtureSource` is a scripted timeline, not a set of final states.** This is load-bearing,
> not a detail. The product's defining behaviours are asynchronous verdicts, an alert arriving
> three steps later, and a form that grows a field at runtime. A fixture layer that returns
> settled answers immediately lets both reference screens be built in a world where none of
> that exists — and then phase 3 *is* the rewrite the seam was built to prevent. Fixtures emit
> events on a clock: `t+0` capture accepted · `t+3s` ADD FIELD · `t+9s` PASS · `t+20s`
> escalation. The reference screens are built against that from the first commit.

---

## 5. Component library

Fourteen primitives, same names and tokens in both stacks. Every screen is these arranged
differently, which is what keeps parallel agents from inventing their own vocabulary.

`Ground` (dark workshop / light paper) · `Rule` · `EvidenceChip` (measured / specified /
inferred / asserted) · `StatusPill` (open · waiting · held · sealed) · `StepCard` ·
`CaptureTile` · **`ReasonCapture`** · **`ReadingBadge`** · **`CeilingCard`** · `AgentTrace` ·
`JobRow` · `Timeline` · `HoldBanner` · `ChatTurn`.

`StepCard` carries all three elements of §4 — instruction, explanation, what good looks like —
and both exits, with the capture button in the same place on every step and *"I can't do this"*
never buried. `ReasonCapture` is the second exit: hold to speak, or type, with the Instructor's
recommendation arriving underneath.

`ReadingBadge` (`90.4° · 14:32:07 · tool #A19`) is the thesis rendered. `CeilingCard` is the
thesis *argued* — the three-or-four class rows with the unreachable ones greyed and explained,
per §3.1. Both get disproportionate design attention; between them they carry the public
surface.

### Agent stamp marks

Each agent gets an **inspection stamp**, not a mascot character — in QA and aviation,
inspectors carry personal stamps that go onto the record. One line weight, monochrome, on a
consistent disc, hand-authored inline SVG.

Scoper an interview bracket · Foreman a branch · Inspector a lens · Skeptic a struck lens ·
Auditor a tally · Instructor a speech mark · Wright a pin.

The same stamps carry into the product: every row of a sealed record shows the mark of the
agent that stamped it, and `AgentTrace` gets its visual identity for free. Not generated with
Imagen — hand-drawn SVG is crisper and smaller, and Imagen stays available as the bonus
fallback (§7).

---

## 6. Surface ownership

**Hand-built (phase 1):** the component library and theme in both stacks · the `/` task flow,
the ceiling card and the replay · `/r/<id>` the sealed record · `/board` the operator view ·
the Compose capture surface.

The public flow and the operator view are the two surfaces a judge actually stares at, so
neither is delegated.

**Fanned out to parallel agents in worktrees (phase 2), four tasks:** `/procedures` (Scoper
conversation and compiled procedure rendering) · `/jobs` · `/ledger` and the public decision
log · **`/about`**, which is now a written page against the §3.3 outline rather than a file
move, and is the one fan-out task with real copy in it.

Each agent receives the generated types, the token file and the built component library, and
owns exactly one surface. **Agents may not invent components** — a screen needing something
the library lacks comes back to the reference build. That constraint is what makes four-way
parallelism safe.

> **The library freezes at the end of day 3.** Otherwise the one builder is simultaneously the
> critical path and the interrupt queue for four agents. Requests during the fan-out window
> queue to day 6; a blocked agent works around it or drops the element.

---

## 7. Platform integration

### Agent Garden reuse

Fork rather than write, both for speed and for sponsor alignment (the prior cohort's thinnest
winner won on that lever alone):

| Sample | Used for |
|---|---|
| `llm-auditor` | **The Skeptic** — it is the verify-another-model's-output pattern already |
| `agent-observability-bq` | FEF Agent Observability **and** the public decision log |
| `memory-bank` | FEF Memory Bank; asset history across weeks |
| `safety-plugins` | Guardrails alongside the already-tested Model Armor image path |

Secondary: `invoice-processing` (supplier replies, read by the **Foreman**), 
`high-volume-document-analyzer` (the Auditor's sweep), `adk-ae-oauth` (Workspace tenancy).

> **Every fork must be disclosed, and `README.md` currently forbids itself from forking.** Its
> Disclosure section says *"No source is carried over from any earlier work"* — false the moment
> the first sample lands. The rules require disclosing *"any other pre-existing code or work
> incorporated into the Project."* Forking is explicitly permitted; undisclosed forking is an
> eligibility question in the one section a rules-aware judge reads adversarially. Rewrite
> Disclosure to name each sample, its upstream URL, its licence and what changed. Fifteen
> minutes, and it is in §11.

### Marketplace posture

Actual Google Cloud Marketplace listing requires enrolment, billing integration and protocol
compliance — weeks of corporate process and an incorporated entity. **Out of scope.**

**In scope:** package the fleet so it *could* be listed — A2A protocol compliance, an agent
card per agent, versioned entries in Agent Registry. The claim becomes "catalogued and
publishable to the Agent Gallery," which is true, screenshot-able, and answers the FEF
"cataloged for cross-department use" bullet literally. **Scheduled on day 8**, not left to
find its own slot.

### The seven FEF components, each with a job and a screenshot

- **Agent Identity** — one service account per agent with different tool scopes. Scoper can
  write procedures but cannot pass a step; Inspector can pass a step but cannot touch the
  Gate. **Film an agent being denied.**
- **Agent Gateway** — all agent-to-tool calls route through it; the denial appears in its log
- **Agent Registry** — agents published and versioned; the sealed record stamps *which agent
  version* made each decision. Procedures stay in Firestore (Registry publishes agents, not
  documents)
- **Memory Bank** — seeded with the fleet's real historical service records. **This is also
  what the Auditor sweeps** — its justification is "across weeks," and on day 9 the live system
  will hold two days of records. It audits the seeded history, and we say so.
- **Agent Observability** — one trace of one job, end to end, across days
- **Model Armor** — already tested; `pi_and_jailbreak` on captures, RAI on text surfaces only
- **Agent Runtime** — the Foreman, resumable per §2

### Notifications

**FCM off Pub/Sub.** This is the missing transport for a claim the README already makes
(capture never waits; an alert appears on the job). It also makes Pub/Sub load-bearing — one
of the rules' explicitly named infrastructure services — and demonstrates an agent reaching a
human days later.

Triggers: Inspector raises ADD FIELD · Foreman chases a stalled job · a work order is
assigned · a machine is held · a part arrives and unblocks a job.

**Fallback if the Compose client is cut:** web push on `/jobs`, and the alert arriving live in
the `/board` stream. The claim must survive the cut that the cut order permits.

### Models and the bonus

| Model | Where |
|---|---|
| **Gemini 3.5 Flash** via Vertex AI | Judgement — contested steps, high strictness (mandatory stack) |
| **Gemma** | Screening every capture; escalates to Flash on disagreement or low confidence (+0.2) |
| **`multimodalembedding`** | The Skeptic's asset re-identification (+0.2, and the only thing addressing the "efficient vector embedding strategies" bullet) |
| **Veo** | Offline synthetic fraudulent evidence to attack the Skeptic (+0.2) |

Bonus total 0.6 — capped. Plus 0.2 for a public build write-up and 0.2 for a social post with
`#AllThingsAgenticHackathon`, reaching the full 1.0.

> **Two of the three are currently invisible.** Veo runs offline; `multimodalembedding` runs
> inside the Skeptic. The rules award 0.2 *"for each additional Google AI model successfully
> integrated"* and judges may score from the video and text alone. Each gets **two seconds on
> screen and one explicit sentence in the Devpost text naming what it did.** Imagen is the
> named fallback if `multimodalembedding` is judged not to count as a distinct model.

---

## 8. Failure handling

| Failure | Response |
|---|---|
| Agent returns off-schema output | Rejected against the JSON Schema, retried once, then escalates to a person |
| Inspector loops on ADD FIELD | `max_add_fields` per step; on exhaustion escalates with the specific unresolved question |
| Near-identical repeated requests | Circuit breaker detects the pathology, escalates, logs the loop |
| Inspector says PASS, Skeptic dissents | Deterministic escalation — the step does not pass, a named person is raised the same day, the dissent is on the record |
| Gemma low confidence | Cascade to Gemini 3.5 Flash |
| Instrument unreachable | The `measurement` field stays empty; the step cannot pass; nothing is inferred in its place |
| **A step cannot be performed at all** | **The technician states why, by voice or text. The Instructor recommends, the Foreman disposes, the Seal classes it `asserted`, and the record carries the deficiency. Never a silent skip** (§4) |
| **Procedure demands a class the surface cannot reach** | **Refused before the job starts, with the reason and the tier that can. Never downgraded, never substituted** (§3.1) |
| Live service unavailable | The seam falls back to `FixtureSource` for read-only surfaces — **under a persistent visible band reading "fixture data — live source unavailable"** |
| Spend ceiling reached | The Ledger refuses further model calls rather than overspending |

**An inferred value may never overwrite a measured one.** Enforced in the acceptance rule,
not in a prompt.

> **Why the fixture fallback is labelled and not silent.** A demo must never show an error
> screen — right goal. But in a provenance product, silently substituting fabricated data for
> real data and presenting it identically *is the tick in the box*. If a judge notices, or an
> automated analyser reads the unlabelled version straight out of this repo, the loss lands on
> the criterion we are strongest at. Keep the fallback, kill the silence.

### Protecting the public surface

`/` is unauthenticated, creates accounts on first write, and triggers model calls — and it is
now deliberately a fun public demo, so it will get traffic. The Ledger ceiling alone means one
scripted visitor can exhaust the budget and take the demo offline for the judges, via the
surface priority 1 ranks first.

- Per-`warrant_uid` and per-IP rate limits on capture.
- A **separate anon budget pool** that cannot starve the operator ceiling.
- **Gemma-only on the Open tier**, no Flash escalation. It is a banana.
- Once the anon budget is spent, `/` falls back to the replay path — which still demonstrates
  everything, still seals nothing, and still never shows an error.

---

## 9. Testing

Scaled to a hackathon: light, but the claims in `README.md` must be true.

- **Contract tests** — every fixture validates against its JSON Schema, **and every agent
  schema round-trips through Vertex `responseSchema`**. Cheap, and it catches the drift that
  breaks parallel agents and the dialect gap that breaks day 6.
- **Fixture rendering** — every surface renders deterministically from `FixtureSource`,
  including its scripted timeline. This is both the test and the demo data.
- **Ceiling tests** — a browser capture can never produce `measured`; a procedure requiring one
  is refused. The rule that carries the public thesis gets the one assertion it needs.
- **Outcome tests** — every step in a sealed record has a `StepOutcome`; a `deferred` or
  `impossible` outcome against a required field holds the machine; a `waived` one releases it and
  appears on the record. There is no path that produces a step with no outcome at all.
- **`scripts/smoke.sh`** — runs a full procedure end to end against recorded fixtures, with
  no hardware and nothing at risk. The README already promises this; it must exist.
- **One live end-to-end** — a real job with a real instrument reading, sealed, before filming.

No unit-test suite for agent prompts. Their contract is the schema.

---

## 10. Schedule

| Day | Date | Work | Gate |
|---|---|---|---|
| **0** | **18 Aug** | **Console hour, before anything depends on it.** Firestore database created · a trivial reasoning engine deployed and deleted · one Registry entry written · one Memory Bank scope written and read · one Gateway route · **one service account denied a scope on purpose, log line kept**. Request the Google Cloud credit form | **G0: all seven FEF components proven reachable, or the plan changes today** |
| 1 | 18 Aug | Contract layer: schema in the Vertex subset, generated TS, hand-written Kotlin five, `tokens.json`, fixture seed with its timeline. **ESP32 spike in parallel — BLE read *and* the Gate relay** | **G1: an ESP32 GATT read reaches any client, and a relay throws under program control.** Client irrelevant — the gate is that both hardware paths work at all |
| 2 | 19 Aug | Component library and stamps · **architecture diagram · LICENSE · README corrected · Disclosure rewritten** | Every scored artifact with no dependency is done and never touched again |
| 3 | 20 Aug | The `/` task flow with **both exits** · the replay · `CeilingCard` · `ReasonCapture` · `/r/<id>` · deploy to Cloud Run · **the Inspector live on one procedure through the seam** | **G2: `/` is public, a stranger seals a record either way, and a real agent decided it** |
| 4–5 | 21–22 Aug | `/board` hand-built · Compose capture hand-built · **fan out four agents** on `/procedures`, `/jobs`, `/ledger`, `/about`. Library frozen | Every surface clickable on fixtures |
| 6–8 | 23–25 Aug | Pipes: Firestore · the fleet on ADK (fork and disclose) · Foreman on Agent Runtime · Model Armor · FCM and Pub/Sub · Registry, Identity, Gateway · **A2A cards on day 8** | **G3: one real job sealed with a measured reading, and a machine held** |
| 9–10 | 26–27 Aug | It runs on real jobs. Auditor sweeps the seeded history. Wright if time. Bonus write-up and social post published | Public log accumulating |
| 11–12 | 28–29 Aug | Film | **G4: footage complete** |
| 13 | 30 Aug | Video cut to 4:00 · Devpost text · `fetch_rules.sh` re-diff · final pass | **G5: video locked** |
| — | 31 Aug | **Submit before 17:00 PT** | |

**Why G0 exists.** `architecture.md` §14 says five of the seven FEF components are unconfirmed
and calls it "the console hour." The earlier plan had that check on 18 Aug and this spec had
dropped it, putting first contact on day 6 with five days left, in the category defined by
those seven components. Verified during the 18 Aug audit: **Agent Runtime is reachable** —
`reasoningEngines` answers 200 in `us-central1`. **Firestore has no database at all.** The rest
is G0's job.

**Why the Inspector goes live on day 3.** The category's defining phrase is *"across weeks of
asynchronous operations."* Deploying a front end on fixtures accumulates nothing: until
`LiveSource` is bound there is no evidence and no log, and "every day the URL is live is a day
of accumulated evidence" is simply false. One agent, one procedure, bound through the seam on
day 3 makes it true and buys back three days of real operating history. Everything else can
stay on fixtures.

**Why the credit form is on day 0.** It closes 28 Aug 12:00 PT. Requesting it on day 11 means
funding ten days of Vertex personally.

### Cut order, last to first

Wright → the MCP server → the Instructor's held button → a fourth `/` task → the Compose
app reduced to a BLE-and-capture companion.

**Every cut carries its documents.** Cutting the MCP server falsifies `README.md` and
`architecture.md` §9, which both say *"our own dashboard is an MCP client, so this is
load-bearing rather than aspirational."* Cutting the held button orphans `SCRIPT.md` shot 22.
A cut on day 10 should be a five-minute edit, not a discovered lie on day 13.

**Never cut:** the `/` task flow and its replay · the public sealed record URL and its ceiling ·
the measured instrument reading · the Gate's refusal.

---

## 11. Document reconciliation

Defects found in the audit of 2026-08-18, to be fixed before submission.

**`README.md`**
- "Running it" references `scripts/bootstrap.sh`, `scripts/deploy.sh`, `scripts/smoke.sh` and
  `.env.example` — **none exist.** Reproducible setup is explicitly scored, and the README
  currently instructs a judge to run four things that are not there.
- Says `npx expo run:android`; `architecture.md` §6 says native Kotlin and Compose. Resolve to
  **native Kotlin/Compose**.
- The fleet section says five agents. Replace with the seven of §2.
- The evidence-class table is split by a stray blank line and renders as two broken tables.
- It says three provenance classes. There are four (§4).
- **Disclosure must name every Agent Garden fork** and stop claiming no source is carried over.
- The Evidence table is all `_pending_` — fill from the running system before submission.
- No `LICENSE` file, though it links to one.

**`docs/architecture.md`**
- §1 gains the `specified` class and its rule row.
- §1's `consistent_with(asset.history)` resolves against Memory Bank; it must resolve against
  the `readings` series (`data-model.md` §3). Memory Bank consolidation is LLM-judged and
  treats two readings of one field as a contradiction to reconcile — which destroys the series.
- §2 names `REGISTRAR` and `GATEKEEPER`; §10 calls them `Seal` and `Gate`. Pick one set.
- §10's *"The fleet is five because five things need a model"* is now aimed at this spec's own
  Foreman and Auditor. **Rewrite the argument, do not renumber it** — the subtraction of
  Planner and Quartermaster is what carries it.
- §13 scope and §14 unverified list both predate G0.

**`SCRIPT.md`** — omitted from the earlier reconciliation list, and it carries 30% of the score.
- Shot 29 voiceover: *"Five agents, because five things need a model."* Spoken on camera, over
  a console showing five. Now seven.
- Shot 24: *"Four agents."*
- No beat for the **verification ceiling** or the **second exit**, which are now the two things
  the public product is actually about. A technician saying *"I can't torque this, the bleed
  nipple is rounded off"* — and the system recommending, holding the machine, drafting the part
  and putting the audio on the record — is a stronger thirty seconds than several shots already
  budgeted.
- The film needs a beat for the verification ceiling — it is the clearest thirty seconds
  available for explaining the taxonomy, and it is now the public product.

**`docs/data-model.md`** — adopted as the model (§4). It stands, with the `capture_surface`,
`attestation`, `verification_ceiling`, `StepOutcome` and `Record.deficiencies` additions folded
in.

**Both `README.md` and `architecture.md` describe only outcomes the Inspector initiates** —
PASS, ADD FIELD, ESCALATE — all of which presuppose that evidence arrived. Neither has any path
for a step that cannot be performed, which is the most common event in a real workshop. Both
gain the step contract of §4: the explanation, the two exits, and the three dispositions.
`architecture.md` §1's `Step` model gains `explanation` and `guidance`; §2's loop diagram gains
the second exit, because as drawn it has only one way out of a step.

**`site/index.html`** — becomes `/about` per §3.3, which is a rewrite rather than a move: nine
agents including core services, *"None of them calls another"*, and the courier flow built from
third-party logos all go. `docs/IMAGES.md` instructs sourcing a DoorDash logo and Google
product logos; the hosted page is the submission and the rules bar third-party trademarks.
Rebuild the courier flow as a stylised original.

**Kept, against the earlier decision to cut them.** The three disclaimer sections — *"What it
will not do"*, `architecture.md` §12 — are **compressed to one tight block, not deleted.** A
verification product that specifies what it cannot verify is more credible, not less; under
Architectural Discipline a stated boundary reads as engineering judgement, and for this product
specifically it is the difference between surviving one sharp question and not.

**`/r/<id>` privacy, before any real job runs.** Real jobs carry plates, faces, names and
customer machines. Sealed records are public **only for the anon and demo tenants**; real
tenant records are private with an explicit share action, IDs are opaque and unguessable, and
ML Kit redaction is a precondition of a record becoming readable — not a client-side nicety.

---

## 12. Out of scope

Google Cloud Marketplace listing · a form builder (the Scoper conversation is the authoring
interface) · moving money (purchase orders are drafted, a human approves) · tamper-proof
evidence or a chain of custody · workmanship assessment from media · Play Store distribution.

---

## 13. Corrections applied, 2026-08-18

What changed in this document after the audit, and why — so the reasoning is not lost.

| # | Was | Now | Why |
|---|---|---|---|
| 1 | The visitor's phone is "already a paired instrument"; GPS and the monotonic clock satisfy **measured** | **Verification tiers.** A browser cannot reach `measured`, the record says so, and that is the call to action | The old version accepted a spoofable, unpaired, identity-free value from the person being verified and stamped it MEASURED — on the one surface every judge opens, in a product whose opening line is that a tick in a box is a claim by an interested party. The requirement was also reverse-engineered from a desired conclusion. The ladder is stronger: the taxonomy proves itself by discriminating |
| 2 | Two home procedures, ~40s, using GPS and elapsed-time disqualifiers | **Four desk tasks, no location, no timer, no equipment**, plus a no-camera replay as the default entry | Neither old task was 40 seconds or equipment-free; a desktop judge hit a camera gate and stopped. A timer on a stranger holding a knife is an avoidable liability |
| 3 | `/about` is the old landing page "moved wholesale" | `/about` is the **B2B explainer**, rewritten | The funnel needs somewhere to land, and the old page is the old pitch with nine agents and third-party logos |
| 4 | Data model listed 16 flat entities; `docs/data-model.md` specified a different one | **`docs/data-model.md` adopted**, plus three fields for tiers. Four provenance classes | Two documents written the same day disagreed about the schema everything else generates from |
| 5 | Fleet count fixed in three documents | **Four** — `SCRIPT.md` was missing, and it says "five agents" out loud on camera | The video is 30% of the score |
| 6 | Foreman "owns one job for its whole life on Agent Runtime" | Resumable state machine; runtime holds a session, Firestore and Memory Bank hold the job | Agent Runtime caps at seven days. A week-spanning job outlives it, and that is the first question an Agent Engine-literate judge asks |
| 7 | Deploy `/` on day 3 "replaces the old plan's deploy on the 21st" | **G0 today; the Inspector live on day 3** | A front end on fixtures accumulates no evidence. The claim was false as written, and "weeks of asynchronous operations" is the category's defining phrase |
| 8 | No gate for the FEF components; first contact on day 6 | **G0** | Five of seven were unconfirmed, in the category defined by them, with five days of slack |
| 9 | Gate relay unscheduled anywhere | **G1, beside the instrument spike** | It is the ranked #1 proof and the film's money shot |
| 10 | Fixture fallback "so a demo never shows an error screen" | Same fallback, **visibly labelled** | Silently swapping fabricated data for real data is the failure this product exists to prevent |
| 11 | Anon surface protected only by the Ledger ceiling | Rate limits, separate anon pool, Gemma-only, replay fallback | One scripted visitor could take the demo offline for the judges |
| 12 | "One schema, three consumers"; Kotlin generated | Authored in the Vertex subset with a round-trip test; **Kotlin hand-written** | `responseSchema` is not JSON Schema, and a generator for five types is a factory built to make five parts on day 1 of 13 |
| 13 | `FixtureSource` "includes a fake notification bus" | Scripted event timeline, load-bearing | A synchronous fixture layer forces the phase-3 rewrite the seam exists to prevent |
| 14 | Skeptic dissent is a "veto" | Deterministic **escalation trigger** | `README.md` says wrongly blocking a technician is the worse harm. Two paragraphs apart, one mechanism had two names |
| 15 | Disclaimer sections cut | Compressed, kept | The one place the spec traded honesty for polish, in the product least able to afford it |
| 16 | Agent Garden forks planned; Disclosure says no source carried over | Forks named, licensed, disclosed | Forking is permitted. Undisclosed forking is an eligibility question |
| 17 | `/r/<id>` public, no qualification | Public for anon and demo tenants only; opaque IDs; redaction as a precondition | Real customer plates and faces on a guessable public URL |
| 18 | `/procedures` and `/jobs` claimed-only | **Judge token**, read-only demo tenant | The two screens FEF scores were behind a login no judge would pass |
| 19 | Diagram, LICENSE, README fixes on day 13 | **Day 2** | Every one is explicitly scored, none has a dependency, and all sat on the day the video is cut |
| 20 | Bonus models assumed to count from the repo | Two seconds on screen and one sentence each; Imagen as fallback | Judges may score from video and text alone, and two of the three are invisible |
| 21 | A2A cards promised, unscheduled | Day 8 | — |
| 22 | FCM depends on the Compose client the cut order reduces | Web push and `/board` fallback named | The claim must survive a permitted cut |
| 23 | Component library open during the fan-out | Frozen end of day 3 | Otherwise the one builder is the critical path and the interrupt queue at once |
| 24 | `fetch_rules.sh` re-diff unscheduled | Day 13 | `BIBLE.md` §9 requires it; the sponsor may change the rules |
| 25 | Credit form noted on day 11 | Day 0 | It closes 28 Aug 12:00 PT |
| 26 | A step had one exit — capture evidence — and every outcome was Inspector-initiated | **Two exits, never zero.** Capture, or state why not, by voice or text | The design had no path for the most common event in a workshop: the step cannot be done. A step that can be silently abandoned is the tick in the box, at the scale of one card |
| 27 | Steps carried a prompt only | **Explanation and what-good-looks-like on every step** | The acceptance rule shown before the capture prevents the ADD FIELD round-trip after it — the same artifact serves the human and the verifier, and every round-trip it saves is a model call unspent |
