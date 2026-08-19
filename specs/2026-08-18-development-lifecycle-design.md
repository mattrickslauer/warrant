# Warrant — Development Lifecycle Design

**Date:** 2026-08-18 · **Deadline:** 31 Aug 2026, 17:00 PT · **Days remaining:** 13

The build is presentation-first: the product's surfaces are designed and made clickable
against fixture data before any backend exists, then services are hooked in behind a single
seam. Parallel agents do the fan-out; the reference surfaces are hand-built.

---

## 1. Goal and priorities

Win the Grand Prize at All Things Agentic. Category: Fortified Enterprise Fleet.

Priorities, in order:

1. **Presentation.** A judge may never run anything. What they open must be complete.
2. **A stranger can use it.** The hosted URL drops an anonymous visitor into a working
   procedure. No winner in the prior cohort had this.
3. **Legible agent delegation.** The fleet must visibly delegate, not pipeline.
4. **Proof on Google Cloud.** Deployed early, traced, logged.

This is a hackathon. A capability that is coded and demonstrable counts as delivered.
Runtime duration, user counts and fleet size are demonstration problems, not blockers.

---

## 2. The canonical fleet — seven agents over a deterministic core

Three documents currently disagree (`README.md` says five, `docs/architecture.md` says five,
`site/index.html` ships nine with core services dressed as agents and states "None of them
calls another"). This section supersedes all three.

| Agent | Job | Why a model is required |
|---|---|---|
| **Scoper** | Interviews until a procedure is unambiguous; compiles and versions it; imports an existing Form or sheet | Open-ended language; must track what it has not yet asked |
| **Foreman** | Owns one job for its whole life on Agent Runtime; delegates to specialists; decides when to chase, re-open, escalate | Long-horizon state and delegation under ambiguity |
| **Inspector** | PASS / ADD FIELD / ESCALATE; composes the specific next request | Reading media; generating the precise next ask |
| **Skeptic** | Does this evidence belong to this job, this machine, this moment — via multimodal embeddings against asset history | Perceptual identity |
| **Auditor** | Sweeps sealed records across weeks; finds procedure defects; hands revisions to the Scoper | Pattern-finding over unstructured evidence |
| **Instructor** | Answers on the held button **and can amend the job** — log a fault, open a defect | Spoken questions plus intent to action |
| **Wright** | Writes a driver for an unfamiliar instrument | Codegen with a live test-retry loop |

**Deterministic core, no model:** Seal (stamps provenance class) · Gate (holds the machine) ·
Ledger (spend ceiling, public decision log) · Scheduling (intervals, usage, lead times — the
Foreman consults it) · Stock arithmetic · Circuit breaker · **Adjudication: Skeptic dissent is
a veto that forces escalation.**

Rejected: **Planner** and **Quartermaster** as agents. Scheduling is arithmetic and reorder
logic is a traversal; both are defensible only in conflict cases and would be attacked as
switch statements in costume. Their judgement halves fold into the Foreman.

**Why the Foreman is the load-bearing addition.** Without it the system is a pipeline where
code routes, and the FEF criterion "does the system intelligently delegate tasks to
specialized sub-agents" goes unanswered. The Foreman also makes Agent Runtime load-bearing
and makes week-spanning operation structural rather than asserted.

---

## 3. Information architecture

The web app is the product's front door. There is no marketing page at the root.

| Route | What it is | Auth |
|---|---|---|
| **`/`** | **Anonymous drop-in procedure.** Pick a task anyone can do at home, perform it in ~40 seconds, land on a sealed record | None |
| `/r/<id>` | The sealed record — public, shareable, the clickable artifact | None |
| `/about` | The existing landing page, moved wholesale from `/` | None |
| `/board` | Operator / judge view — work orders arriving, agent decisions streaming, machines held | None (read-only demo tenant) |
| `/procedures` | Procedure list, versions, the Scoper conversation | Claimed |
| `/jobs` | Open, waiting on evidence, held | Claimed |
| `/ledger` | Spend per job and per strictness; the public decision log | None |

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
- **The only gate is camera permission.** Never an identity gate.

### The home procedures

`/` offers tasks a stranger can perform at home with no equipment — *cut a banana*, *take out
the trash*. These are not toys; they are the scalability proof (same fleet, same engine, a
banana instead of a brake caliper) and the taxonomy lesson.

**All three evidence classes must appear, or the thesis goes unproven on the one surface
everyone sees.** The visitor's phone is already a paired instrument — GPS, accelerometer,
barometer and the monotonic clock produce readings carrying device identity and a timestamp,
having passed through no human hands. That satisfies the definition of **measured**.

| Procedure | measured | inferred | asserted |
|---|---|---|---|
| Take out the trash | GPS departure and return; elapsed time | Photo shows the bin at the kerb | Lid closed, signed by name |
| Cut a banana | Elapsed time under the disqualifier threshold | Photo shows even slices | Knife stored safely, signed |

---

## 4. The contract layer

### One schema, three consumers

The data model lives once as **JSON Schema in `contract/`** and generates:

1. TypeScript types for the web surfaces
2. Kotlin data classes for the Android client
3. **The structured-output contracts the ADK agents validate against**

The third is the important one: an agent returning something off-schema is rejected
mechanically and retried once, then escalates. That is the hallucination containment the
Architecture criterion asks about by name, and the "intelligent schema design" bullet
answered with an artifact rather than a paragraph.

Entities: `Tenant` · `Technician` · `Asset` · `Procedure` + `Version` · `Step` · `Field` ·
`Job` · `Capture` · `Reading` · `Decision` · `Record` · `Part` · `StockLevel` ·
`PurchaseOrder` · `Notification`.

### One token source

`design/tokens.json` generates `tokens.css` and `Theme.kt`, seeded from the existing palette
in `site/index.html`: `--work` `#0E1719`, `--rec` `#EDEFEA`, `--rule` `#C6CDC5`,
`--measured` `#0F7A63`, `--inferred` `#C07818`, `--asserted` `#6A5AA0`. Two stacks, one
visual language, no drift.

### One seam

Every surface — web and Kotlin — reads and writes through a `DataSource` interface with two
implementations:

- **`FixtureSource`** — seeded JSON, deterministic, offline, includes a fake notification bus
- **`LiveSource`** — Firestore plus the agent services

Screens depend on the interface only. **Phase 3 hooks up pipes by swapping one binding per
capability, never by rewriting a screen.** This is what makes presentation-first honest
rather than throwaway work.

---

## 5. Component library

Twelve primitives, same names and tokens in both stacks. Every screen is these arranged
differently, which is what keeps parallel agents from inventing their own vocabulary.

`Ground` (dark workshop / light paper) · `Rule` · `EvidenceChip` (measured / inferred /
asserted) · `StatusPill` (open · waiting · held · sealed) · `StepCard` · `CaptureTile` ·
**`ReadingBadge`** · `AgentTrace` · `JobRow` · `Timeline` · `HoldBanner` · `ChatTurn`.

`ReadingBadge` (`90.4° · 14:32:07 · tool #A19`) is the thesis rendered and gets
disproportionate design attention.

### Agent stamp marks

Each agent gets an **inspection stamp**, not a mascot character — in QA and aviation,
inspectors carry personal stamps that go onto the record. One line weight, monochrome, on a
consistent disc, hand-authored inline SVG.

Scoper an interview bracket · Foreman a branch · Inspector a lens · Skeptic a struck lens ·
Auditor a tally · Instructor a speech mark · Wright a pin.

The same stamps carry into the product: every row of a sealed record shows the mark of the
agent that stamped it, and `AgentTrace` gets its visual identity for free. Not generated with
Imagen — the bonus is already capped and hand-drawn SVG is crisper and smaller.

---

## 6. Surface ownership

**Hand-built (phase 1):** the component library and theme in both stacks · the anonymous `/`
procedure flow · `/r/<id>` the sealed record · `/board` the operator view · the Compose
capture surface.

The anon flow and the operator view are the two surfaces a judge actually stares at, so
neither is delegated.

**Fanned out to parallel agents in worktrees (phase 2), four tasks:** `/procedures` (Scoper
conversation and compiled procedure rendering) · `/jobs` · `/ledger` and the public decision
log · `/about` migration plus correcting its fleet section to the seven above.

Each agent receives the generated types, the token file and the built component library, and
owns exactly one surface. **Agents may not invent components** — a screen needing something
the library lacks comes back to the reference build. That constraint is what makes four-way
parallelism safe.

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

Secondary: `invoice-processing` (supplier replies, read by the **Foreman** — this is the
judgement half of the rejected Quartermaster), `high-volume-document-analyzer` (the Auditor's
sweep), `adk-ae-oauth` (Workspace tenancy plumbing).

### Marketplace posture

Actual Google Cloud Marketplace listing requires enrolment, billing integration and protocol
compliance — weeks of corporate process and an incorporated entity. **Out of scope.**

**In scope:** package the fleet so it *could* be listed — A2A protocol compliance, an agent
card per agent, versioned entries in Agent Registry. The claim becomes "catalogued and
publishable to the Agent Gallery," which is true, screenshot-able, and answers the FEF
"cataloged for cross-department use" bullet literally.

### The seven FEF components, each with a job and a screenshot

- **Agent Identity** — one service account per agent with different tool scopes. Scoper can
  write procedures but cannot pass a step; Inspector can pass a step but cannot touch the
  Gate. **Film an agent being denied.**
- **Agent Gateway** — all agent-to-tool calls route through it; the denial appears in its log
- **Agent Registry** — agents published and versioned; the sealed record stamps *which agent
  version* made each decision. Procedures stay in Firestore (Registry publishes agents, not
  documents)
- **Memory Bank** — seeded with the fleet's real historical service records
- **Agent Observability** — one trace of one job, end to end, across days
- **Model Armor** — already tested; `pi_and_jailbreak` on captures, RAI on text surfaces only
- **Agent Runtime** — the Foreman

### Notifications

**FCM off Pub/Sub.** This is the missing transport for a claim the README already makes
(capture never waits; an alert appears on the job). It also makes Pub/Sub load-bearing — one
of the rules' explicitly named infrastructure services — and demonstrates an agent reaching a
human days later.

Triggers: Inspector raises ADD FIELD · Foreman chases a stalled job · a work order is
assigned · a machine is held · a part arrives and unblocks a job.

### Models and the bonus

| Model | Where |
|---|---|
| **Gemini 3.5 Flash** via Vertex AI | Judgement — contested steps, high strictness (mandatory stack) |
| **Gemma** | Screening every capture; escalates to Flash on disagreement or low confidence (bonus +0.2) |
| **`multimodalembedding`** | The Skeptic's asset re-identification (bonus +0.2, and the only thing addressing the "efficient vector embedding strategies" bullet) |
| **Veo** | Offline synthetic fraudulent evidence to attack the Skeptic (bonus +0.2) |

Bonus total 0.6 — capped. Plus 0.2 for a public build write-up and 0.2 for a social post with
`#AllThingsAgenticHackathon`, reaching the full 1.0.

---

## 8. Failure handling

| Failure | Response |
|---|---|
| Agent returns off-schema output | Rejected against the JSON Schema, retried once, then escalates to a person |
| Inspector loops on ADD FIELD | `max_add_fields` per step; on exhaustion escalates with the specific unresolved question |
| Near-identical repeated requests | Circuit breaker detects the pathology, escalates, logs the loop |
| Inspector says PASS, Skeptic dissents | **Skeptic dissent is a deterministic veto** — the step does not pass and the job escalates |
| Gemma low confidence | Cascade to Gemini 3.5 Flash |
| Instrument unreachable | The `measurement` field stays empty; the step cannot pass; nothing is inferred in its place |
| Live service unavailable | The seam falls back to `FixtureSource` for read-only surfaces so a demo never shows an error screen |
| Spend ceiling reached | The Ledger refuses further model calls rather than overspending |

**An inferred value may never overwrite a measured one.** Enforced in the acceptance rule,
not in a prompt.

---

## 9. Testing

Scaled to a hackathon: light, but the claims in `README.md` must be true.

- **Contract tests** — every fixture validates against its JSON Schema. Cheap, and it catches
  the drift that breaks parallel agents.
- **Fixture rendering** — every surface renders deterministically from `FixtureSource`. This
  is both the test and the demo data.
- **`scripts/smoke.sh`** — runs a full procedure end to end against recorded fixtures, with
  no hardware and nothing at risk. The README already promises this; it must exist.
- **One live end-to-end** — a real job with a real instrument reading, sealed, before filming.

No unit-test suite for agent prompts. Their contract is the schema.

---

## 10. Schedule

| Day | Date | Work | Gate |
|---|---|---|---|
| 1 | 18 Aug | Contract layer: JSON Schema, generated types, `tokens.json`, fixture seed. **ESP32 to BLE spike in parallel** | **G1: an ESP32 GATT read reaches any client over BLE.** Client irrelevant — the gate is that the instrument path works at all |
| 2–3 | 19–20 Aug | Component library and stamps · the anon `/` flow · `/r/<id>` · deploy to Cloud Run | **G2: `/` is public and a stranger can seal a record** |
| 4–5 | 21–22 Aug | `/board` hand-built · Compose capture hand-built · **fan out four agents** on `/procedures`, `/jobs`, `/ledger`, `/about` | Every surface clickable on fixtures |
| 6–8 | 23–25 Aug | Pipes: Firestore · ADK agents (fork `llm-auditor`, `agent-observability-bq`, `memory-bank`) · Foreman on Agent Runtime · Model Armor · FCM and Pub/Sub · Registry, Identity, Gateway | **G3: one real job sealed with a measured reading** |
| 9–10 | 26–27 Aug | It runs on real jobs. Auditor sweeps. Wright if time. Bonus write-up and social post published | Public log accumulating |
| 11–12 | 28–29 Aug | Film. *(Google Cloud credit form closes 28 Aug 12:00 PT)* | **G4: footage complete** |
| 13 | 30 Aug | Video cut to 4:00 · architecture diagram · Devpost text · README and docs final pass | **G5: video locked** |
| — | 31 Aug | **Submit before 17:00 PT** | |

**Deploying `/` on day 3 replaces the old plan's "deploy on the 21st."** Every day the URL is
live is a day of accumulated evidence and a day the public log grows.

### Cut order, last to first

Wright → the MCP server → the Instructor's held button → a second real procedure → the Compose
app reduced to a BLE-and-capture companion.

**Never cut:** the anonymous `/` flow · the public sealed record URL · the measured instrument
reading · the Gate's refusal.

---

## 11. Document reconciliation

Defects found in the audit of 2026-08-18, to be fixed before submission:

- `README.md` "Running it" references `scripts/bootstrap.sh`, `scripts/deploy.sh` and
  `scripts/smoke.sh` — none exist. Reproducible setup is explicitly scored.
- `README.md` says `npx expo run:android`; `docs/architecture.md` §6 says native Kotlin and
  Compose. Resolve to **native Kotlin/Compose**.
- No `LICENSE` file, though `README.md` links to one.
- No architecture **diagram**. The rules require a clear visual representation; ASCII and
  tables do not satisfy it.
- `docs/IMAGES.md` instructs sourcing a DoorDash logo and Google product logos. The hosted
  page is the submission and the rules bar third-party trademarks. Rebuild the courier flow
  as a stylised original.
- The evidence-class table in `README.md` is split by a stray blank line and renders as two
  broken tables.
- `docs/architecture.md` §2 names `REGISTRAR` and `GATEKEEPER` in the flow; §10 calls them
  `Seal` and `Gate`. Pick one set of names.
- `site/index.html` fleet section lists nine agents including core services, and states "None
  of them calls another." Replace with the seven above.
- The three disclaimer sections ("What it will not do", `architecture.md` §12) are **cut**.
  The narrow-claim sentence survives inline where it is load-bearing.

---

## 12. Out of scope

Google Cloud Marketplace listing · a form builder (the Scoper conversation is the authoring
interface) · moving money (purchase orders are drafted, a human approves) · tamper-proof
evidence or a chain of custody · workmanship assessment from media.
