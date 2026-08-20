# Firestore — accounts, procedures, records, drafts and tasks

**Status:** approved design, rules verified against the emulator, not yet implemented
**Date:** 2026-08-20
**Extends:** `docs/data-model.md`, `firestore.rules`, `contract/entities/*`

Five things the data model does not yet have: who the people are, where a compiled procedure
lives, how a sealed record reaches a stranger, what "pending" means before a job is finalised,
and where a task with a due date lives so it can raise an alert and appear on a calendar.

The security work is not a separate section bolted on. Four of the five need a document a
client must be able to read but must never be able to write, and today's rules cannot express
that — so §2 comes first and the rest follows from it.

---

## 1. Decisions already taken

| Question | Decision |
|---|---|
| What "pending locally" means | **Firestore offline persistence.** A draft job syncs; the invariant is that no agent runs on it. |
| Google Calendar scope | **Write-only.** Warrant creates events; it does not read them back. |
| Who can read `/r/<id>` | **Capability URL.** A separate public root holding a redacted projection. |
| `readings` placement | **Flattened** to `/tenants/{t}/readings/{id}` so it can be made server-write-only. |

---

## 2. The rules architecture

### 2.1 Why the current rule cannot be patched in place

Firestore security rules are **OR'd, and there is no deny**. If any `allow` grants access,
access is granted; a narrower rule written afterwards cannot take it back. The existing

```javascript
match /tenants/{t}/{collection}/{document=**} {
  allow read, write: if inTenant(t);
}
```

therefore makes **every document under a tenant writable by every member of that tenant, at
every depth.** Four consequences, each of which contradicts something the product already
claims in writing:

| Document | The claim | What the rule actually permits |
|---|---|---|
| `records/{jobId}` | "Written once by the Seal, never updated" (`record.schema.json`) | Any member may overwrite or delete a sealed record |
| `members/{uid}` | `waived_by` is "a named person with standing" (`step-outcome.schema.json`) | A technician may set their own `role` to `foreman` and waive their own steps |
| `decisions/{id}` | The agent reasoning a public record carries | Any member may forge or delete an agent's verdict |
| `readings/{id}` | "Without `tool_id` the value is typed, not measured" (`reading.schema.json`) | Any member may POST a fabricated *measured* value |

The last is the one that matters most, because the instrument shot in `SCRIPT.md` (23a–23d)
exists to prove that a measured number cannot be fabricated. If a signed-in technician can
write one with an HTTP request, the demonstration is theatre.

There is no way to express "readable but not writable" for a subpath while a broader rule
grants write. The recursive rule's **write** must be narrowed at the point it is granted.

### 2.2 The replacement

```javascript
// Collections a client may READ within its tenant but never WRITE. Each is written by the
// Admin SDK from a server path that holds standing the client does not have.
//
// This list is the security boundary of the whole instance space. Adding a collection here
// is cheap; noticing later that one is missing is not.
function serverWritten(collection) {
  return collection in ['members', 'records', 'decisions', 'readings', 'procedure_versions'];
}

// Claims a client may never make for itself, at any depth in the tenant subtree.
//
// Provenance is stamped by the Seal, release by the Gate, and attestation by Play Integrity
// server-side. A client asserting any of them is asserting the conclusion the system exists
// to reach independently.
function clientMayNotClaim() {
  return request.resource.data.get('provenance_class', '') != 'measured'
      && request.resource.data.get('capture_surface', '') != 'app_instrument'
      && request.resource.data.get('status', '') != 'sealed';
}

match /tenants/{t}/{collection}/{document=**} {
  allow read:  if inTenant(t);
  allow write: if inTenant(t) && !serverWritten(collection) && clientMayNotClaim();
}

// The public capability projection. See §6.
match /records/{publicId} { allow read: if true; allow write: if false; }

// OAuth refresh tokens. Not under /tenants/** — there, every colleague could read them.
match /user_secrets/{uid} { allow read, write: if false; }
```

Three properties are preserved deliberately:

- **The `{collection}` segment stays.** It is what stops the recursive rule from also matching
  `/tenants/{t}` itself and re-granting the tenant-creation write the rule above refuses. This
  was found by `web/scripts/rules.test.mjs`, not by reading, and the test stays.
- **Read stays broad.** A new collection under a tenant is still readable by its tenant the day
  it is created. Only write narrowed.
- **Tenant reads of protected collections still work.** You want to see your colleagues' names
  and your own sealed records. It is only writing them that requires a server.

`clientMayNotClaim()` uses `MapValue.get(key, default)`, which Firestore rules support, so it
is safe on documents where the field is absent.

### 2.2a This was verified, not assumed

The whole design rests on two constructs behaving a particular way, so both were run against
the real rules engine in the Firestore emulator before this spec was accepted — 25 assertions,
all passing:

| Verified | Result |
|---|---|
| `collection in [...]` on a bound path segment | works |
| Each of the five protected collections | write refused, **read still allowed** |
| `data.get(key, default)` on an **absent** field | does not block the write |
| `provenance_class: "measured"`, `capture_surface: "app_instrument"`, `status: "sealed"` | each refused |
| `provenance_class: "inferred"`, `capture_surface: "browser"` | each allowed |
| `/records/{publicId}` unauthenticated | readable; not writable by anyone |
| `/user_secrets/{uid}` | unreachable, **including by its own owner** |
| Existing guarantees — no client tenant creation, no cross-tenant write | still hold |

**The finding that matters:** protection is decided by the **first** path segment alone.
`tenants/{t}/readings/{id}/sub/{s}` binds `collection` to `readings` and is protected at every
depth — but `tenants/{t}/components/{cid}/readings/{id}` binds it to `components` and is *not*.
That is the concrete reason `readings` must be flattened rather than left nested, and it is a
mechanism worth knowing before writing any future rule.

Note that the emulator requires **JDK 21 or newer**; `firebase-tools` refuses to start on the
JDK 17 that is currently first on the PATH here. JDK 25 is installed at
`/usr/lib/jvm/java-25-openjdk`, so `scripts/smoke.sh` should set `JAVA_HOME` explicitly rather
than inherit whichever JDK happens to be default.

### 2.3 Rules are defence in depth, not the primary control

`clientMayNotClaim()` cannot inspect array contents, and a `Job` carries its fields inside a
`steps[].fields[]` array. A client can therefore still write a `Field` with a `tool_id` inside
a job document.

**The primary control is that the Seal never trusts client-written provenance.** It recomputes
each field's class from the server-written `readings` collection: a field is `measured` if and
only if a `reading` exists with a matching `field_id` and a `tool_id`, written by the ingest
path that received it from a paired instrument. A `tool_id` a client typed into a job document
resolves to nothing and stamps `asserted`.

This is worth stating explicitly because it is the difference between a rule that is nice to
have and a rule that is load-bearing. Rules stop the cheap forgery; the Seal stops the rest.

### 2.4 A live bug this changes

`web/src/data/live-source.ts` currently writes:

```ts
capture_surface: input.surface,
provenance_class: input.surface === "app_instrument" ? "measured" : "inferred",
```

`input.surface` arrives from the caller. A browser client may pass `"app_instrument"` and the
document lands claiming `measured`. The in-file comment says the Seal stamps the real class,
which is the correct mitigation, but the interim document is untrue and `clientMayNotClaim()`
will now reject the write outright.

**Fix:** `LiveSource` writes `provenance_class: null` and lets the Seal stamp it. The surface
is recorded as reported, but a surface above `browser` is only *believed* when a server-side
attestation accompanies it.

### 2.4a The instrument path is a server ingest, not a client write

`clientMayNotClaim()` refuses `capture_surface == 'app_instrument'` from any client. That
would break the hero shot if an instrumented capture were a client write — so it is not one,
and this is the design rather than a workaround.

A reading from a paired instrument arrives at **`POST /api/ingest/reading`** on Cloud Run,
authenticated by the device pairing rather than by the technician's session. That endpoint,
holding Admin credentials, writes both:

- `/tenants/{t}/readings/{id}` — the number, with its `tool_id`
- the `capture` carrying `capture_surface: "app_instrument"` and its attestation

The technician's client never asserts that a number was measured; it watches the reading
appear, which is exactly what shot 23c shows — *"lands in the record on its own. Nobody typed
it."* The rule and the film agree.

This also closes the loop with §2.3: because the ingest endpoint is the only writer of
`readings`, "a `reading` exists with a matching `field_id` and a `tool_id`" is a claim only a
paired instrument can cause to be true.

### 2.5 Cloud Storage has no rules at all

`web/src/auth/config.ts:21` configures `storageBucket`, no `storage.rules` file exists, and
`firebase.json` has no storage block. Nothing is stored there yet, so nothing has leaked — but
evidence media, avatars and published record media all land there in this design, and the
default posture must not be discovered on the day the first photograph is uploaded.

New `storage.rules`, deployed by `infra/deploy-rules.sh`:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // tenantOf() is the same identity model as firestore.rules — a third copy of the rule,
    // and therefore a third thing the shared claims corpus in rules.test.mjs must cover.

    // Evidence. Append-only: a capture may be created and never altered or removed.
    match /tenants/{t}/captures/{jobId}/{file} {
      allow read:   if signedIn() && tenantOf() == t;
      allow create: if signedIn() && tenantOf() == t
                    && request.resource.size < 25 * 1024 * 1024
                    && request.resource.contentType.matches('image/.*|video/.*|audio/.*');
      allow update, delete: if false;
    }

    // Our copy of the Google profile image. Server-written. See §4.
    match /avatars/{uid} { allow read: if signedIn(); allow write: if false; }

    match /{path=**} { allow read, write: if false; }
  }
}
```

Media for a **public** record is deliberately *not* reachable through these rules — it is
proxied by Cloud Run under Admin credentials (§6.3), which keeps the bucket private and makes
unsharing actually revoke access.

---

## 3. Scope note

This design covers five collections and three rules files. It is written as one spec because
the rules architecture in §2 is common to all of it, but it implements in three independent
stages:

1. **Rules + accounts + procedures + records** — the storage change (§2, §4, §5, §6)
2. **Drafts** — `status: "draft"` and offline persistence (§7)
3. **Tasks, notifications, Calendar** — the only stage needing new OAuth scopes and a
   scheduler (§8)

Stage 1 is a prerequisite for 2 and 3. Stages 2 and 3 are independent of each other.

---

## 4. Accounts

### 4.1 `/tenants/{t}/members/{uid}` — server-written, tenant-readable

```jsonc
{
  "uid": "…",
  "tenant_id": "acme.com",
  "email": "sam@acme.com",
  "email_verified": true,
  "display_name": "Sam Okafor",

  "photo_url": "https://lh3.googleusercontent.com/a/…=s192",  // Google's. Rotates; can 404.
  "photo_ref": "gs://warrant-media/avatars/{uid}.jpg",        // Ours. Taken at first sign-in.
  "photo_fetched_at": "2026-08-20T…",

  "role": "owner" | "foreman" | "technician" | "viewer",
  "standing": {
    "may_waive_to_strictness": 1,      // may waive a step required at or below this
    "may_approve_orders": false,       // may approve a drafted purchase order
    "may_publish_procedures": false
  },

  "joined_at": "…",
  "last_seen_at": "…",
  "disabled": false,

  "calendar": { "linked": true, "linked_at": "…", "calendar_id": "primary" }
}
```

`calendar` records *that* the account is linked. The refresh token is never here — see §8.4.

**Membership needs no invite flow.** The first person from `acme.com` to sign in creates the
tenant; the second joins by being from `acme.com`. `web/src/auth/provision.ts` already works
this way. `ensureMember()` follows the same shape and the same idempotency: called on every
sign-in, creates on first sight, refreshes `last_seen_at` and profile fields thereafter.

**Role defaults.** The first member of a tenant is `owner`. Everyone after is `technician`.
Promotion is an owner-only server action. This is deliberately the whole model — a role
hierarchy nobody can escalate into is worth more than a rich one anybody can.

### 4.2 Reusing the Google profile image

`Session` already carries `picture` (`web/src/auth/session.ts:31`), decoded from the Firebase
token. It is simply never persisted. Three things to get right:

**Request a usable size.** Google returns a small default. Append `=s192` to the `lh3` URL.

**Do not depend on it.** `lh3.googleusercontent.com` URLs rotate when the user changes their
photo and can 404 outright. Fetch the image server-side at first sign-in, store a copy at
`gs://…/avatars/{uid}.jpg`, and keep both — `photo_url` for freshness, `photo_ref` for
durability. Re-fetch when `photo_fetched_at` is older than 30 days or the token's `picture`
differs from the stored one.

**Denormalise onto the sealed record.** This is the part that matters. A record is immutable
and is supposed to be readable by a stranger years later. It must therefore carry the
technician's name and avatar **as they were at seal time**, not a reference resolved at read
time — otherwise changing a profile photo silently rewrites history, and a technician leaving
the company blanks their own signature.

Today `StepOutcome.reason_by` and `waived_by` hold bare uids, which render as nothing on
`/r/<id>`. §6 adds the denormalised `actor` block that fixes it.

### 4.3 `/tenants/{t}/devices/{installId}` — client-writable

```jsonc
{ "uid": "…", "fcm_token": "…", "platform": "android" | "web",
  "app_version": "…", "last_seen_at": "…" }
```

Top-level under the tenant rather than a subcollection of `members`, because `members` is
server-written and FCM token refresh is a legitimate client act. This is the general pattern:
**when part of a concept must be client-writable, it becomes its own collection rather than a
subcollection of a protected one.**

---

## 5. Procedures

Private by construction: they live under the tenant subtree, so `firestore.rules` already
makes them unreachable to anyone else. No visibility flag enforces anything.

### 5.1 Shape

`/tenants/{t}/procedures/{id}` keeps holding the **current full `Procedure`**, so every read
in `LiveSource` (`listProcedures`, `getProcedure`, `startJob`) works unchanged. Added fields:

```jsonc
{
  // … the existing Procedure …
  "status": "drafting" | "published" | "archived",
  "current_version": 3,
  "published_at": "…", "published_by": "uid:…",
  "updated_at": "…",
  "origin": "scoper" | "imported" | "forked",
  "source_doc_ref": "spec_docs/…"     // for OSE/Dozuki imports, data-model.md §8
}
```

`/tenants/{t}/procedure_versions/{id}:{n}` — a frozen full copy written at publish, never
updated.

**Flat, not a subcollection of `procedures`.** A `{document=**}` wildcard cannot be tested
segment by segment, so a subcollection inherits its parent's write grant and could not be
protected. The same reasoning that flattened `readings` (§2.1) and split `devices` out of
`members` (§4.3) applies here: publishing must enforce `may_publish_procedures` standing, and
standing enforced only by the server path that a client can bypass is not enforced.

The composite id `{procedureId}:{version}` keeps a version directly addressable without a
query.

`/tenants/{t}/procedures/{id}/turns/{n}` — the Scoper interview transcript. `ScoperTurn`
already exists in `contract/agents/scoper-turn.schema.json`. A procedure mid-interview is
`status: "drafting"`; compiling publishes v1.

### 5.2 A live bug this fixes

`LiveSource.startJob` reads the **live** procedure document and copies `procedure.version`
onto the job. If someone publishes v3 while a v2 job is running, the running job silently
starts executing v3 steps while `Job.procedure_version` still says 2 — and the sealed record
promises it names "the version that ran".

**Fix:** `startJob` reads `/tenants/{t}/procedure_versions/{id}:{current_version}` and pins it.
A job holds its version for life.

---

## 6. Records

### 6.1 Two documents, written together at seal

**`/tenants/{t}/records/{jobId}`** — the full private record. Already in the model; now
server-written and therefore actually immutable.

**`/records/{publicId}`** — written only when the record is shared.

### 6.2 The public projection

```jsonc
{
  "id": "…",                        // 22 chars of crypto randomness — NOT the jobId
  "sealed_at": "…",
  "procedure_title": "Front brake service",
  "procedure_version": 3,
  "asset_label": "BIKE-07",         // label, not the tenant-qualified urn

  "issuer": { "display_name": "Acme Motorcycles" },
  "actors": [ { "display_name": "Sam Okafor",
                "avatar": "/api/r/{publicId}/avatar/{n}",
                "role": "technician" } ],

  "ceiling_tier": "instrumented",
  "ceiling_reachable": [...], "ceiling_unreachable": [...],
  "deficiencies": [...],
  "machine_released": true,
  "steps": [...],                   // redacted: media as proxy URLs, no uids
  "decisions": [...],               // agent, agent_version, model, verdict, rationale — no cost
  "revoked": false
}
```

What is deliberately **not** in it: `tenant_id`, any `uid`, raw `gs://` refs, `cost_usd`,
`attestation_play_integrity`, and the job id.

`publicId` is 22 characters of `crypto.randomBytes` base64url — roughly 132 bits. It is not
derived from the job id, which would be enumerable.

**Publication gate.** A record may be published only when every capture it references has
`redacted == true` (the contract already says a record is not readable until then) and
`armor_verdict != "MATCH_FOUND"`. A poisoned or unredacted capture must never reach a public
URL.

### 6.3 Media

Public record media is served by Cloud Run at `/api/r/{publicId}/media/{captureId}`, and actor
avatars at `/api/r/{publicId}/avatar/{n}` — both check that `/records/{publicId}` exists and is
not `revoked`, then stream the object using Admin credentials. Avatars are proxied rather than
linked to `lh3.googleusercontent.com` for the reason in §4.2: a public record must not depend
on a URL Google may retire, and must not change when someone updates their profile photo.

The alternative — signed URLs — was rejected because a signed URL outlives revocation. Under
the proxy, unsharing deletes the public document and every media URL dies with it.

### 6.4 Contract change

`SealedRecord.public` becomes "a public projection exists" and gains a companion
`public_id: string | null`. Sharing is a server action; unsharing deletes `/records/{publicId}`.

The existing comment restricting `public` to anon and demo tenants no longer applies — any
tenant may share a record deliberately, which is the point of a capability URL.

---

## 7. Drafts

### 7.1 Mechanism

- `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager:
  persistentMultipleTabManager() }) })` in `web/src/auth/firebase-client.ts`. Verified present
  in the installed `firebase@12`. The deprecated `enableIndexedDbPersistence` is not used.
- Android sets `setLocalCacheSettings(persistentCacheSettings)` explicitly rather than relying
  on the platform default.
- `Job.status` gains `"draft"`, plus `finalized_at` and `finalized_by`.
- A job starts `draft`. Captures write normally; they land in the local cache immediately and
  sync opportunistically.
- `finalize(jobId)` flips `draft → open`. That is the human act.

### 7.2 The invariant

**No agent runs on a job with `status == "draft"`.** Whatever dispatches Inspector, Skeptic
and Foreman filters it out. This single condition is what makes the choice safe, and it is the
thing to test.

### 7.3 Sync honesty

`waitForPendingWrites()` backs a truthful "everything is synced" indicator; a draft badge
shows what is still local.

**A note for `SCRIPT.md` shot 24.** With this choice the bytes *do* reach Firestore before
finalize — the local cache is a cache, not a vault. The scripted line *"nothing was sent until
I said so"* would be inaccurate. *"No agent ran and nothing was sealed until I said so"* is
true, and is the claim that carries the scene. A film about not fabricating evidence cannot
narrate a sync boundary it does not have.

---

## 8. Tasks, notifications and Calendar

### 8.1 `/tenants/{t}/tasks/{taskId}`

```jsonc
{
  "id": "…",
  "kind": "chase" | "approve_order" | "escalation" | "service_due" | "held_machine" | "redo_step",
  "title": "Chase supersession for 45022-KA",
  "detail": "…",
  "source": { "job_id": "…", "step_id": "s3", "decision_id": "…" },
  "due_at": "2026-08-24T09:00:00Z",
  "assignee_uid": "…" | null,
  "assignee_role": "foreman" | null,
  "status": "open" | "done" | "dismissed",
  "created_by_agent": "foreman",
  "calendar": { "event_id": "…", "calendar_id": "primary", "synced_at": "…" },
  "notified_at": null,
  "created_at": "…", "closed_at": null, "closed_by": null
}
```

Client-writable: closing a task is a legitimate act by the person doing the work.

### 8.2 Tasks need no new agent

Every task is a projection of a decision the contract already produces:

| Trigger (already in `contract/types.ts`) | Task |
|---|---|
| `ForemanDisposition.action == "chase"` + `chase_after` | `chase`, `due_at = chase_after` |
| `action == "reorder"` — a PO is drafted, never sent | `approve_order` |
| `action == "escalate"` + `escalate_to_role` | `escalation`, assigned by role |
| The Gate holds the machine | `held_machine` |
| `InspectorVerdict == "ADD_FIELD"` | `redo_step`, assigned to the technician |

`ForemanDisposition.chase_after` is documented as "when to wake and check" and is *required*
when the action is chase. The schema was already written for this; nothing about it changes.

### 8.3 Delivery

Two independent channels, either of which may be off:

1. **FCM push** to every device in `/tenants/{t}/devices` matching the assignee.
2. **Calendar event**, for tasks with a `due_at`.

Firing is Cloud Scheduler → Cloud Run `POST /api/tasks/sweep`, once a minute:

```
where status == "open" and notified_at == null and due_at <= now
```

Chosen over per-task Cloud Tasks because it is one cron, it is visible in the Console the
competition rules require on screen, and it self-heals if a due time passes while nothing is
deployed. Cloud Tasks is more precise; it is not more demonstrable.

### 8.4 Calendar

- **Scope:** `https://www.googleapis.com/auth/calendar.events` and nothing else. Write-only
  needs no read scope.
- **Requested incrementally**, not at sign-in. Sign-in stays a single clean consent; the
  technician links Calendar the first time they receive a dated task.
- **Refresh token at `/user_secrets/{uid}`**, top-level, `allow read, write: if false`,
  reachable only by the Admin SDK. It cannot live under `/tenants/{t}/**` for the reason in
  §2.1 — every colleague would be able to read it.
- **Idempotency via `extendedProperties.private.warrant_task_id = taskId`.** Re-running the
  sweep updates the event instead of duplicating it, and the event is findable again without
  trusting a stored id.
- **Event body:** `summary` = task title; `description` = deep links to the job and record;
  `start` = `due_at`, 30 minutes; `reminders.useDefault: false` with popups at 0 and 60 min.
- **Closing or dismissing a task deletes the event.**
- **Workspace upgrade, noted not built:** a service account with domain-wide delegation would
  remove per-user consent entirely for `hd` tenants. Per-user OAuth is specified here because
  it works for solo accounts too.

---

## 9. Contract changes

| File | Change |
|---|---|
| `entities/job.schema.json` | `status` gains `"draft"`; add `finalized_at`, `finalized_by` |
| `entities/record.schema.json` | add `public_id`, `issuer`, `actors`; restate `public` |
| `entities/procedure.schema.json` | add `status`, `current_version`, `published_at/by`, `origin`, `source_doc_ref` |
| `entities/member.schema.json` | **new** |
| `entities/task.schema.json` | **new** |
| `entities/reading.schema.json` | add `component_id` (was implied by the nested path) |

`contract/build-types.mjs` regenerates `contract/types.ts`; `web/scripts/sync-generated.mjs`
copies it into `web/src/generated`. Both run under `npm run gen`.

---

## 10. Indexes

| Collection | Index | For |
|---|---|---|
| `tasks` | `status` ASC, `notified_at` ASC, `due_at` ASC | the sweep |
| `tasks` | `assignee_uid` ASC, `status` ASC, `due_at` ASC | a person's task list |
| `readings` | `key` ASC, `at` DESC | unchanged, now collection-scoped |
| `readings` | `component_id` ASC, `key` ASC, `at` DESC | the per-component series |
| `procedures` | `status` ASC, `updated_at` DESC | the library view |
| `members` | `role` ASC, `display_name` ASC | the people view |

The existing `jobs` index (`status`, `started_at` DESC) already serves the draft list.

---

## 11. Breaking changes and migration

1. **`readings` moves** from `/tenants/{t}/components/{cid}/readings/{id}` to
   `/tenants/{t}/readings/{id}` with a `component_id` field. `docs/data-model.md` §4 and §7
   update. The collection-group index becomes collection-scoped. Nothing reads readings yet,
   so there is no data to migrate.
2. **`LiveSource.capture()`** stops writing `provenance_class` (§2.4).
3. **`LiveSource.startJob()`** reads a pinned version document (§5.2).
4. **`firestore.rules`** narrows tenant writes. No existing client write targets a protected
   collection, so nothing in the current app breaks.
5. **`storage.rules`** is new; `firebase.json` gains a `storage` block and `infra/deploy-rules.sh`
   deploys it.

---

## 12. Testing

`web/scripts/rules.test.mjs` already runs against the real rules engine in the emulator with a
shared identity corpus, and it is what caught the `{collection}` bug. It is extended, not
replaced:

- a tenant member **cannot write** `members`, `records`, `decisions`, `readings`,
  `procedure_versions`
- a tenant member **can still read** all five
- a client write carrying `provenance_class: "measured"` is **refused**
- a client write carrying `capture_surface: "app_instrument"` is **refused**
- a client write setting `status: "sealed"` on a job is **refused**
- **nobody** reads `/user_secrets/{uid}`, signed in or not
- **anyone** reads `/records/{publicId}`, including unauthenticated
- a member of `acme.com` still cannot read `beta.com` (existing, must keep passing)
- the tenant document still cannot be created by a client (existing, must keep passing)

New `web/scripts/storage-rules.test.mjs` for the storage rules, over the same identity corpus:
cross-tenant read refused, oversized upload refused, wrong content type refused, update and
delete of an existing capture refused.

The `tenantOf()` agreement test now covers **three** implementations — `web/src/auth/tenant.ts`,
`firestore.rules`, and `storage.rules` — against one table of claims.

Beyond rules:

- the Seal stamps `asserted` for a field whose `tool_id` has no matching server-written
  `reading` (§2.3) — this is the test that makes the instrument claim true
- the agent dispatcher skips `status == "draft"` (§7.2)
- `POST /api/ingest/reading` writes both the reading and the `app_instrument` capture, and
  rejects an unpaired device (§2.4a)
- a second `POST /api/tasks/sweep` over the same task updates the Calendar event rather than
  creating a duplicate (§8.4)

---

## 13. Out of scope

- Promoting a tenant procedure into the shared catalogue (`data-model.md` §8 covers documents;
  procedures would follow the same reviewed one-way path).
- Domain-wide delegation for Workspace Calendar (§8.4).
- Reading Calendar back — RSVPs, reschedules, free/busy.
- Any invite or organisation-management flow. Membership is the Google directory (§4.1).
