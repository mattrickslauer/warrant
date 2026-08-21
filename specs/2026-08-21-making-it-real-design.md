# Making it real — the adjudication spine, and Android on the live backend

**Status:** §§1–6 and §11 implemented — the adjudication spine is live and proven end to end
(commits ba3b73e…c4b9430). §7 Model Armor, §8 Android, §9 attestation and §10 Scoper/operator
remain. See `docs/superpowers/plans/2026-08-21-adjudication-spine.md`.
**Date:** 2026-08-21
**Extends:** `specs/2026-08-20-firestore-design.md`, `docs/architecture.md`, `firestore.rules`
**Deadline context:** submissions close 31 Aug 2026 17:00 PT.

Warrant's seven agents are real, contract-bound and eval-covered. Nothing in the product has
ever called one. This spec closes that gap and puts Android on the same live backend as the
web, so that both surfaces show verdicts a model actually produced.

---

## 1. What is actually true today (verified 21 Aug 2026)

Measured, not assumed. Each row was checked against the running system.

| Claim | Status | Evidence |
|---|---|---|
| The fleet answers live | **true** | `evals run --agent inspector --id pads-seated-clean-passes --live` → pass, 7.8s, 2819 tokens, real Gemini 3.5 Flash |
| The fleet is deployed | **true** | `warrant-fleet` at `projects/1020487917587/locations/us-central1/reasoningEngines/5032906174249304064`; exposes `query`, `roster` |
| The deployed engine answers a real case | **true** | `query(agent="inspector")` on a no-media field → schema-valid `ADD_FIELD` naming the specific retake, 3.5s, 1235 tokens |
| Anything in the product calls it | **false** | no caller anywhere in `web/src`; only `deploy-agents.py --smoke` |
| `decisions` has a writer | **false** | server-write-only per `firestore.rules:79`; no server route writes one |
| Model Armor runs | **false** | `MODEL_ARMOR_TEMPLATE` is set in `.env` and has zero callers in the repo |
| Android reaches any backend | **false** | no Firestore dependency, and zero HTTP calls in `android/app/src/main/java` |
| Android is registered with Firebase | **false** | no `google-services.json`, no Android app on the project |
| An operator/fleet view exists | **false** | absent from both `web/src/app` and Android (`Reach.SOON`) |

The consequence worth stating plainly: **`LiveSource` on the web subscribes to a `decisions`
collection that nothing will ever write to.** Turning the web "live" today produces a job that
captures evidence and then waits forever. The fixture is not merely a stand-in for the backend;
it is currently the only thing in the system that produces a verdict at all.

### 1.1 The identity trap

`.env` sets `GOOGLE_APPLICATION_CREDENTIALS` to the `warrant-web` service account, which is
deliberately least-privilege — it mints session cookies and reads Firestore, nothing else
(`infra/deploy-agents.py:52`). Sourcing `.env` and calling Vertex therefore fails with a 403 on
`aiplatform.endpoints.predict` that reads exactly like the model not existing. This cost real
time to diagnose and will cost it again. §6 gives adjudication its own identity rather than
widening `warrant-web`, and §11 makes the failure legible.

---

## 2. Adjudication is two flows, not one

The agent sources make a distinction the fixture timeline blurs, and getting it wrong would
produce a plausible-looking pipeline that adjudicates the wrong things.

**The capture flow** — evidence was submitted.
`Inspector` judges *one field's* evidence and returns `PASS` / `ADD_FIELD` / `ESCALATE`. It is
shown a single field on purpose (`inspector.py:1-6`): an agent shown a whole step trades a weak
photo against a strong one and passes the step, and the record then claims something no single
piece of evidence supports. `Skeptic` answers a different question on the same capture — does
this evidence belong to *this* machine and *this* job, and has this frame been submitted before.

**The blocked flow** — a step could not be performed.
`Instructor` reads the technician's spoken or typed reason and produces a recommendation.
`Foreman` takes that recommendation and decides disposition: waive, chase, reorder, escalate.
The Foreman is never shown a photograph and never adjudicates a capture.

Two further agents sit outside both flows: `Scoper` (authoring, §8) and `Wright` (driver
authorship, already reachable from the instrument path). `Auditor` is cross-job and out of
scope here.

> This corrects an "Inspector → Skeptic → Foreman" chain assumed earlier in planning. The
> Foreman belongs to the blocked flow only.

---

## 3. Architecture

```
Android ─┐                                   ┌─ Vertex Agent Engine (warrant-fleet)
         ├─ write capture ─► Firestore       │    inspector / skeptic / instructor
Web ─────┘         │                         │    foreman / scoper / wright / auditor
                   │                         │
                   └─ POST /api/adjudicate ──┴──► reasoningEngines:query
                            (Cloud Run, Admin creds)
                                   │
                                   ├─ Model Armor screen (§7)
                                   └─ write `decisions`, advance `step_outcomes`
                                            │
                          Firestore onSnapshot ─► both clients
```

Adjudication runs as a route on the **existing** Next.js Cloud Run service. This was chosen
over a Firestore/Eventarc trigger and over a separate Python Pub/Sub service because it adds no
new deploy surface — `infra/deploy-web.sh` already ships it — while keeping `agents/warrant/`
the single authored statement of every prompt. TypeScript calls the fleet; it never restates it.

**The handler takes a capture reference and does not care who woke it.** That is the whole
design constraint that keeps Eventarc a later addition rather than a rewrite (§12).

### 3.1 Why the client may trigger it

`POST /api/adjudicate` is called fire-and-forget by whichever client just wrote the capture. A
client that crashes between the write and the call leaves evidence unadjudicated, so the
existing Cloud Scheduler sweep (`/api/tasks/sweep`) gains a second duty: find captures with no
decision older than **two minutes** and drive them. The sweep becomes load-bearing rather than
decorative, which is a cost of this approach and is accepted deliberately.

---

## 4. `POST /api/adjudicate`

**Request.** `{ tenant_id, job_id, step_id, field_key, capture_id }`. Authenticated by the
session cookie for a human client, or by the sweep secret for the cron. The handler verifies the
caller may read that job before doing anything under Admin credentials.

**Refusal to trust the client.** The request carries *references*, never facts. The handler
re-reads the capture, field, step, procedure version and any reading from Firestore itself. A
client that could hand the Inspector its own version of the acceptance rule could pass anything.

**Work.**

1. Load the pinned `procedure_version`, the step, the field definition, the capture, and the
   `reading` if one exists.
2. Screen the media through Model Armor (§7). A `MATCH_FOUND` short-circuits to a refusal
   decision; the model is never shown the image.
3. Build the Inspector case exactly as `inspector.py:parts` expects: `step`, `field`,
   `strictness`, `add_fields_used`, `capture`, optional `reading`, optional `answer`, `media`.
4. Call `reasoningEngines:query` with `agent: "inspector"`.
5. In parallel, build and call the Skeptic case: `asset`, `job`, `capture`, `media`, and
   `prior_media` — earlier captures for the same asset, which is what makes reuse detectable.
6. Write one `decisions` document per agent, each stamping model, latency, token usage and the
   engine resource name.
7. Apply the outcome deterministically (§5).

**Response.** `202` with the decision ids. The client does not wait on this; it learns through
its snapshot listener, which is the behaviour every screen was already built against.

### 4.1 Media transport

The fleet's `Agent.media()` reads from a local directory (`base.py:104`), which cannot work for
a deployed engine judging a photograph in Cloud Storage. Rather than base64-inflating megabytes
through the query payload, `Part` gains a `uri` field and `media()` gains a `gs://` branch, so
the model reads the object directly from the bucket.

Consequences, all of which must be handled together:

- The engine's service account needs `storage.objectViewer` on the evidence bucket.
- The cassette key is built from attachment **bytes** (`model.py`), which a URI part does not
  have. A URI part keys on the URI string. Live-only by nature; the eval corpus continues to
  use local files and its cassettes are unaffected.
- `MediaMissing` must still fire for a `gs://` object that does not exist — an Inspector asked
  to judge a photo it was never given will confidently return something, and that answer would
  be recorded as though it had seen it.

---

## 5. The outcome is applied deterministically

The model's verdict is an input to a decision the code makes, never the decision itself. This
is the same principle the Seal already embodies and it must not weaken here.

| Inspector verdict | Effect |
|---|---|
| `PASS`, and Skeptic says the evidence belongs | field accepted; step advances when every required field is accepted |
| `PASS`, and Skeptic dissents | step does **not** advance; the dissent is what the record shows |
| `ADD_FIELD` | append the requested field to the step, if the add-field budget allows; increment `add_fields_used` |
| `ADD_FIELD` with the budget exhausted | treated as `ESCALATE` — the contract already requires the Inspector to escalate here, and the server enforces it rather than trusting it |
| `ESCALATE` | step marked as needing a human; escalation question recorded |
| schema-invalid output | **no** step transition; the decision is written with its `schema_errors` |

That last row matters. `runtime.py:60-66` returns validation failures rather than raising,
precisely so the caller can refuse an answer and say why. A malformed verdict must never
silently advance a step.

**Provenance is untouched by all of this.** The Seal stamps `measured` / `specified` /
`inferred` / `asserted`, and no agent may influence it. An Inspector `PASS` on a typed number
still seals `asserted`.

---

## 6. Identity

A new service account, `warrant-adjudicator`, holding:

- `roles/aiplatform.user` — to call the engine
- `roles/datastore.user` — to write `decisions` and `step_outcomes`
- `roles/storage.objectViewer` on the evidence bucket
- `roles/modelarmor.user`

`warrant-web` is **not** widened. Its least-privilege posture is deliberate and documented, and
an adjudicator that can also mint session cookies is a worse failure when it is compromised.
The Cloud Run service runs as `warrant-web`; the adjudicate route impersonates
`warrant-adjudicator` via the IAM Credentials API. Added to `infra/bootstrap.sh`.

---

## 7. Model Armor

`armorVerdict` currently ships as the string `"NO_MATCH_FOUND"`, hardcoded in both fixture
sources. It is a claim the system makes about a check it has never run.

Model Armor screens the capture on the adjudicate path, before the Inspector sees it, and the
real verdict is written onto the capture. On `MATCH_FOUND` the media is not shown to any model
and a refusal decision is recorded naming what was found.

Two honest limits, to be stated in the record rather than papered over:

- Model Armor's coverage of image-borne prompt injection is narrower than its text coverage. It
  is the guardrail available, not a proof of safety.
- It is a **cloud-side** guardrail on model input and output, and is a different layer from the
  on-device redaction in `Redactor.kt`, which masks faces before anything leaves the phone. The
  two are not substitutes and the code comments already say so.

If the API cannot screen the media types Warrant captures, the fallback is to record
`NOT_SCREENED` — never `NO_MATCH_FOUND`. A false clean is worse than an admitted gap.

---

## 8. Android on the live backend

### 8.1 Registration

No Firebase Android app exists. Created via the Firebase Management REST API
(`projects/{p}/androidApps`) with ADC — no console visit — package `ink.warrant`, with the
debug and release signing SHA-1s. `google-services.json` is fetched from the same API and is
**git-ignored**, with `android/app/google-services.json.example` checked in beside it.

### 8.2 Auth

`GoogleAuth` already obtains a real Google ID token through Credential Manager and already
decodes `hd` correctly. What is missing is the exchange: that token becomes a Firebase
credential, `signInWithCredential` yields a Firebase user, and only then does `firestore.rules`
apply to the phone.

The tenant must be resolved the same way on both surfaces or the two will disagree about who
someone is. Android therefore calls the existing `POST /api/auth/session`, which already
performs the `hd` exchange and sets the custom claim, then refreshes its ID token to pick the
claim up. The `hd`-decoding logic in `Identity.kt` stays as the local, offline answer; the
server's claim is authoritative.

### 8.3 `LiveSource.kt`

A port of `live-source.ts`, matching it closely enough that a reader can diff them:

- The same decomposed storage — job header, `step_outcomes`, `fields`, `captures` — so a
  capture writes two new documents and reads nothing.
- `subscribe` returns a `Flow`; `onSnapshot` becomes `callbackFlow` with the same four
  listeners (header, outcomes, fields, decisions). Cancellation is structural.
- `Seal.kt` is untouched. It is already a real port pinned by `SealTest`, and both stacks must
  keep running the same seal.
- Photos upload to Cloud Storage under the same prefix the web uses, **after** `Redactor` has
  masked faces on-device.

`submitReading` keeps its asymmetry — it exists on Android and not on the web because a browser
cannot pair with an instrument. It posts to the existing `/api/ingest/reading`, which is and
must remain the only writer of `readings`.

### 8.4 The binding

`WarrantApplication.kt:33` is the one line that changes, exactly as its comment has always
promised. `FixtureSource` stays in the tree and stays selectable from Settings — it is how the
demo is filmed without a network, and it is genuinely useful. The `fabricated` banner logic is
already correct and needs no change.

---

## 9. Attestation

`attestationDeviceId` is the literal string `"fixture-device"` and
`attestationPlayIntegrity` is null. Play Integrity standard requests replace both. The verdict
is verified **server-side** on the ingest path; a client-asserted attestation is worth nothing,
and `firestore.rules` already refuses one.

Where Play Integrity is unavailable — an emulator, a sideloaded debug build, a device without
Play Services — the capture records `UNATTESTED` and the record says so. This is the same rule
as §7: an admitted gap, never a fabricated pass.

---

## 10. Scoper authoring, and the operator view

**Scoper.** `CreateProcedureScreen` currently establishes the tenant, shows the interview, and
compiles nothing — and says so, which is why it is the least dishonest fixture in the app. A new
`POST /api/scoper/turn` calls the deployed Scoper with the conversation so far and the
`asked_about` coverage list the agent depends on (`scoper.py:_coverage`), returning one turn
against `contract/agents/scoper-turn.schema.json`. Compilation writes a `procedure_version`
through the existing `web/src/server/publish.ts`. Both surfaces use this endpoint.

**Operator view.** Absent on both. Per the settled strategy, scale is demonstrated by running
the same fleet across several machine types, with simulated work orders streaming in — so this
is a live view over `decisions` across tenants: which agent decided what, on which machine
type, at what model cost. It reads only real decisions. Seeded and simulated jobs are legitimate
material; a fabricated verdict is not.

---

## 11. Failure, stated

Every one of these is a real failure this system can have, and each gets an explicit surface
rather than a silent pass:

| Failure | Surface |
|---|---|
| Vertex 403 (the §1.1 identity trap) | the decision records `engine_unreachable` with the principal that was refused |
| Engine timeout | capture stays undecided; the sweep retries; the screen keeps saying "handed to the fleet" |
| Schema-invalid verdict | written with `schema_errors`; no step transition |
| Model Armor unavailable | `NOT_SCREENED`, never `NO_MATCH_FOUND` |
| Play Integrity unavailable | `UNATTESTED` |
| Storage object unreadable by the engine | `MediaMissing`; the model is never asked |

The theme is one rule: **the system may say it does not know. It may not say everything is
fine when it has not checked.**

---

## 12. Order of work

1. ~~Fleet deployed and `query` verified against the live engine.~~ **Done, 21 Aug.**
2. ~~`gs://` media transport in `base.py` / `model.py`.~~ **Done** — corpus still replays from cassettes, 0 live calls.
3. ~~`POST /api/adjudicate` + the deterministic outcome logic + `warrant-adjudicator`.~~ **Done** — 28 pure tests, 15 against the emulator.
4. ~~Web wired to it.~~ **Done** — a capture asks for a verdict on commit; the sweep catches what a dead client left behind.
5. Firebase Android app registration and Firebase Auth exchange.
6. `LiveSource.kt` + Storage upload.
7. Model Armor on the adjudicate path.
8. Play Integrity.
9. Scoper turn endpoint, both surfaces.
10. Operator view.
11. If time allows: Eventarc trigger as a second caller of the §4 handler, removing the
    client's ability to skip adjudication.

Steps 1–4 are what make the claim true. Everything after raises how much of it is real.

---

## 13. Testing

- **Seal parity.** `SealTest` and the TypeScript seal tests must keep agreeing. Non-negotiable:
  it is the one piece of logic both stacks reimplement.
- **Rules.** New `decisions` and attestation writes get assertions against the real rules
  engine, matching the 65 already in place.
- **Adjudicator.** Unit tests over the §5 table with the engine faked — every verdict, budget
  exhaustion, Skeptic dissent, and schema-invalid output.
- **Evals.** The corpus stays green after the media change, replayed from cassettes and free.
- **One genuine end-to-end.** A real photograph, adjudicated by the deployed fleet, landing as
  a decision in the record.

  **Done, 21 Aug.** `gs://warrent-505918-evidence/tenants/e2e.warrant.test/…/cap_e2e.jpg`
  through `adjudicate()` against the real Firestore: Inspector `PASS` (0.95, "the thickness of
  the friction material is fully visible"), Skeptic `BELONGS`, two decisions written stamping
  gemini-3.5-flash and $0.000679 each, and the step moved to `performed` by the outcome table
  rather than by either model.

  Still owed: the same thing **from the phone**, which is §8 and cannot be proven until
  Android can upload.
