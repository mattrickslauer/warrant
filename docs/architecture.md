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

## 6. The client

**Android, native, built with Expo.**

Native rather than web because the client pairs Bluetooth instruments, and **Web Bluetooth
does not exist on iOS Safari** — a browser client would rule out half of any future
deployment. Android-only for now because iOS device deployment needs a paid developer
account, Android BLE is materially easier to debug, and one platform halves the test surface
in a short build. Expo keeps iOS available later at near-zero cost.

**Expo Go will not work.** BLE requires native modules, so the client runs as a development
build (`expo prebuild` + dev client). One hour of setup, then a fast reload loop on a
physical handset for everything after.

What the client owns:

| Responsibility | Why it lives on the device |
|---|---|
| Capture — photo, video, audio, scan | Full fidelity exists nowhere else |
| BLE pairing and instrument reads | The only place the instrument is reachable |
| Field validation — focus, exposure, presence of a reading | Instant, free, no round trip |
| Offline queue | Workshops have bad signal and jobs cannot stop |
| PII redaction before upload | Faces and plates should never leave the device unmasked |

The client is **untrusted**. Everything it reports is a claim to be corroborated, which is
why capture integrity — contiguity, timing, device attestation — is itself a measured field
rather than an assumption.

---

## 7. Drivers, and the agent that writes them

Every instrument speaks its own dialect. Writing a driver per tool is the long-tail
integration work that stops platforms from generalising, so it is the part worth automating.

### The driver contract

Deliberately small, because everything above it must be indifferent to which tool it is:

```
Driver
  matches     scan filter — service UUID, name prefix, manufacturer data
  produces    kind: measurement · unit: "mm" · range: [0, 4000]
  read()      raw bytes → { value, unit, tool_id, timestamp, raw }
```

A `measurement` field does not know or care whether the number came from a commercial torque
wrench or an ESP32 with an ultrasonic sensor. It knows the reading arrived from a paired tool
without passing through a human, which is the only property that makes it **measured**.

### Wright — the driver author

**Wright** is pointed at a device it has never seen and writes the driver.

1. Enumerate the device's advertised GATT services and characteristics
2. Read the public specifications for any standard services it finds
3. Probe unknown characteristics and infer the encoding from the bytes
4. Emit a driver against the contract above
5. **Run it against the live device and check the reading is plausible**
6. On failure, feed the error back and try again

Step 5 is the reason this works. Generated code that talks to hardware has ground truth
available at no cost — the device either produces a sensible number or it does not. Both the
prior winners that leaned on code generation cited a generate → validate → feed-back loop as
the thing that made it reliable, and hardware is a stricter validator than a linter.

**Scope honestly.** One hand-written ESP32 driver is the floor and it is enough for the
system to work. Wright is the thing that turns one instrument into any instrument, and its
demo — an agent enumerating an unknown device, inferring its protocol, writing code, and
pulling a live reading — is the most striking thing in the fleet.

---

## 8. Where each model is spent

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

## 9. Assumptions we bake in, and publish

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

## 10. Google Cloud mapping

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

## 11. Still unverified

- **Whether the ESP32 pairs cleanly to an Expo development build** over BLE. This is the
  hello-world for the entire client and should be proved before any other code is written.
- **Which BLE instrument is available.** An ESP32 with an ultrasonic sensor is a genuine
  measuring device and is on hand; a commercial torque wrench is not. The `measurement` field
  kind is indifferent to which — but at least one real instrument must exist, or the measured
  class is empty and the central claim is unsupported.
- **Wright's inference quality on genuinely unknown devices.** Standard GATT services are
  documented and reliably inferable; a proprietary characteristic may not be. The floor is a
  hand-written driver, so this is upside rather than risk.
- **Whether Agent Registry, Memory Bank, Agent Identity, Agent Gateway and Model Armor are
  enabled and reachable** in our project and region. Five of the seven Fortified Enterprise
  Fleet components are named as load-bearing and none has been confirmed against our own
  console.
- **Cost per job in practice.** The routing model should make it cents. That is arithmetic
  until a real job has been metered end to end.
