# Warrant — Architecture

The system is a **dynamic form engine with agents attached.** A procedure compiles to a form,
a technician fills it by capturing rather than typing, and an agent decides at each step
whether what it received is enough — or asks for more.

Everything else is consequence.

---

## 1. Constraints we verified first

Two assumptions were checked against the documentation before anything was designed, and both
came back differently than assumed.

**Gemini Live API.** Video input is capped at **1 frame per second**, audio+video sessions are
limited to **2 minutes** without context compression, and video runs ~258 tokens/second against
a 32k context on non-native-audio models.
([capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities))

That rules out holding an open video session for the length of a job, and it is why the
Instructor is **push-to-talk** rather than always-watching. Short bursts, bounded cost, no
session to keep alive across a forty-minute brake service.

**YouTube.** Developer policies prohibit third parties downloading, caching or storing
audiovisual content, with no pathway for processing stream content. Any external record is a
second encoder output we reference, never something we ingest.

Both findings point the same way: **capture and hold evidence at the edge, spend the model
deliberately.**

---

## 2. The core abstraction

A procedure is a **form that knows what counts as an answer.**

```
Procedure
  id                       front-brake-service
  version                  v3
  strictness               0..3          (default for this deployment)
  Steps[]
    id, title, condition                 (show only if …)
    Fields[]
      key                                pad_torque
      kind                               measurement | photo | video | scan |
                                         choice | text | signature | location | timer
      prompt                             "Torque the caliper bolts"
      acceptance                         within(26, 30, "Nm")
      required_at                        strictness >= 1
      source                             paired_tool | camera | human
```

**Field kinds are the extensibility surface.** Adding a new instrument means adding a kind and
a driver; nothing above it changes. Adding a new industry means writing procedures, not code.

**Acceptance rules** are the second surface:

| Rule | Resolves against | Class |
|---|---|---|
| `within(min, max, unit)` | An instrument reading | **measured** |
| `matches(work_order.part_number)` | Another record in the system | **measured** |
| `must_show(description)` | The model's reading of the media | **inferred** |
| `consistent_with(asset.history)` | Memory Bank, across previous services | **inferred** |
| `signed_by(role)` | A named human | **asserted** |

The class is a property of the rule, not of the confidence. That is what keeps the three
categories from blurring under pressure.

---

## 3. The runtime loop

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                                                                  │
   │   SCOPER ──── plain language in, compiled form out,              │
   │      │        versioned and published to Agent Registry          │
   │      ▼                                                           │
   │   ┌────────────────── per step ──────────────────┐               │
   │   │                                              │               │
   │   │  INSTRUCTOR ── renders the step; answers     │               │
   │   │      │         questions on a held button    │               │
   │   │      ▼                                       │               │
   │   │  technician captures ──► INSPECTOR           │               │
   │   │                              │               │               │
   │   │            ┌─────────────────┼─────────┐     │               │
   │   │            ▼                 ▼         ▼     │               │
   │   │          PASS          ADD FIELD    ESCALATE │               │
   │   │            │                │         │      │               │
   │   │            │                └──► back to the │               │
   │   │            │                     technician  │               │
   │   └────────────┼──────────────────────────────────┘              │
   │                ▼                                                 │
   │   SKEPTIC ──── is this evidence from this job, this machine,     │
   │      │         this moment?                                      │
   │      ▼                                                           │
   │   actions fire ── consume stock · advance order · raise PO ·     │
   │      │            request another department · release or hold    │
   │      ▼                                                           │
   │   REGISTRAR ── seals the record                                  │
   │                                                                  │
   └──────────────────────────────────────────────────────────────────┘
```

### The Instructor: push-to-talk, not always-on

The technician holds a button, asks a question out loud, releases. Audio goes up with the
current step, the procedure, the asset's history, and optionally the last captured frame as
context. An answer comes back as text and speech.

This is bounded in every dimension that matters — cost, latency, session lifetime — and it
matches how the job actually goes. Nobody wants to be narrated at for forty minutes. They want
an answer twice.

### The Inspector: three outcomes, not two

The important one is the middle.

- **PASS** — the evidence satisfies the field's acceptance rule at the configured strictness.
- **ADD FIELD** — it does not, but it might with more. The Inspector **appends a field to the
  live form** and the technician keeps working. *"The label is out of focus — photograph it
  again."* *"That pad looks worn beyond the interval — photograph the disc as well."*
- **ESCALATE** — genuinely ambiguous, or a disqualifier fired. A human is asked the specific
  question, and only that question.

There is no silent FAIL. A step that cannot pass either grows or goes to a person.

**This is why the engine generalises.** A fixed form encodes one shop's idea of enough. A form
that can grow at runtime encodes *how much is enough here* — and that is the only thing that
actually differs between a rental yard and an airline.

---

## 4. Strictness is a dial, and it costs money

Strictness is a single configured value that changes three things at once:

| | **0 — log** | **1 — standard** | **2 — assured** | **3 — regulated** |
|---|---|---|---|---|
| Fields required | Core only | Core + measurements | Everything declared | Everything, plus corroboration |
| Inspector threshold | Accepts plausible evidence | Requires the specific thing | Requires a second source | Requires measured where measurable |
| Willingness to ADD FIELD | Rarely | When unclear | Whenever inference is doing the work | Aggressively |
| Skeptic passes | Sampled | Every step | Every step, full suite | Every step, plus cross-job comparison |
| Cost | Cents | | | Dollars |

**The same procedure runs at any level.** A brake service in a yard runs at 1. The same
procedure on an asset carrying passengers runs at 3. Nothing is rewritten — the dial moves and
the evidence bar moves with it.

This is the whole pitch made mechanical: aviation-grade assurance is *available* at a price,
and you choose what you are buying. The Treasurer meters it, so the operator sees exactly what
strictness costs per job and can decide.

---

## 5. Why this scales to any process

The engine has no opinion about maintenance. Four unrelated procedures, one schema:

| Procedure | Step | Field | Kind | Acceptance | Class |
|---|---|---|---|---|---|
| Brake service | Torque caliper | `bolt_torque` | measurement | `within(26,30,"Nm")` | measured |
| Parcel delivery | Drop | `drop_photo` | photo | `must_show("parcel at door")` | inferred |
| | | `gps` | location | `within(30, "m", of=address)` | measured |
| Food safety | Cook temp | `core_temp` | measurement | `within(75,100,"C")` | measured |
| Lab protocol | Reagent | `lot_scan` | scan | `matches(run.lot_number)` | measured |
| Site milestone | Pour | `slump` | measurement | `within(75,125,"mm")` | measured |

A new industry is a set of procedure documents. A new instrument is a driver. **Neither is a
change to the fleet**, and that is the test of whether the abstraction is real.

---

## 6. Where each model is spent

| Layer | Model | When | Why |
|---|---|---|---|
| Field validation | local + rules | every capture | Focus, exposure, presence of a reading — free, instant |
| Routine evidence | **Gemma** | every step | Cheap pass over ordinary photos at volume |
| Judgement | **Gemini 3.5 Flash** | contested or high-strictness steps | Where inference is actually doing work |
| Questions | **Gemini 3.5 Live API** | on the held button | Short bursts, bounded |
| Adversarial corpus | **Veo** | offline | Synthetic fraudulent evidence, generated to attack our own Skeptic |

The Treasurer routes between them by strictness and by the value of the asset. Most captures
never reach a frontier model, which is what makes a job cost cents instead of dollars.

---

## 7. Assumptions we bake in, and publish

1. **A model's judgement is inferred, never measured.** Nothing Gemini concludes can overwrite
   an instrument reading.
2. **The model cannot verify what it cannot see.** Occlusion, bad framing, darkness — these
   produce ADD FIELD, never a guess.
3. **Every decision records model version, prompt version, procedure version, and strictness.**
   A decision that cannot be reproduced cannot be appealed.
4. **The Skeptic is only as good as its current attack suite**, which is versioned and
   published. "Passed" means "survived suite v4", not "unfakeable".
5. **We publish our own error rates**, measured against a staged-fraud corpus where we know
   the ground truth because we rigged it.

Point 5 is the one that matters. A verification product that will not publish its own
false-accept rate is asking to be trusted on exactly the question it exists to settle.

---

## 8. Google Cloud mapping

| Concern | Service |
|---|---|
| Reasoning | **Gemini 3.5 Flash** via Vertex AI |
| Questions on the button | **Gemini 3.5 Live API** |
| Framework | **ADK** |
| Long-running jobs spanning days | **Agent Engine** |
| Published, versioned procedures | **Agent Registry** |
| Asset history across services | **Memory Bank** |
| Per-agent zero-trust access | **Agent Identity** |
| Routing and policy | **Agent Gateway** |
| Face, plate and PII redaction at capture | **Model Armor** |
| Traces and audit logs | **Agent Observability** |
| Services and transport | **Cloud Run**, **Pub/Sub** |
| Ledger, procedures, orders, records | **Google Workspace** — Sheets, Docs, Gmail, Drive |
| Machine-to-machine | **MCP server** on Cloud Run |
| Instruments | BLE on the technician's device |

---

## 9. Still unverified

- **Which BLE instrument is available.** An ESP32 with an ultrasonic sensor is a genuine
  measuring device and is on hand; a commercial torque wrench is not. The `measurement` field
  kind is indifferent to which — but at least one real instrument must exist, or the measured
  class is empty and the central claim is unsupported.
- **Web Bluetooth is unavailable on iOS Safari.** On Android a PWA pairs directly. On iOS this
  forces a native client. This decides the entire client architecture and is unanswered.
- **Whether Agent Registry, Memory Bank, Agent Identity, Agent Gateway and Model Armor are
  enabled and reachable** in our project and region. Five of the seven Fortified Enterprise
  Fleet components are named as load-bearing and none has been confirmed against our own
  console.
- **Cost per job in practice.** The routing model should make it cents. That is arithmetic
  until a real job has been metered end to end.
