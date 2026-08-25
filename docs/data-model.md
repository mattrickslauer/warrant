# Warrant — The data model

Two namespaces. **Type space** describes what a machine *is*; **instance space** records what
*this* machine has been through. They are separate Firestore roots, and the boundary between
them is structural rather than a permissions check.

---

## 1. Why two namespaces

A manufacturer's manual is not the shop's data and not ours — it is a published reference. A
shop's evidence is theirs alone. Those are different kinds of thing with different owners,
different lifetimes and different sharing rules, so they get different roots.

```
/spec_nodes      /spec_values      /spec_docs      /spec_chunks     ← type space, no tenant
/tenants/{tenant}/…                                                ← instance space
```

**The invariant.** An instance node carries a `type_ref` into type space. A spec node has no
tenant field, so it cannot point back. References run one way, many-to-one, read-only — which
means tenant data *cannot* be leaked into the catalogue, because the schema has nowhere to
put it.

---

## 2. Addressing — ISO 14224

Both namespaces use the same nine-level taxonomy from ISO 14224, the maintenance industry's
own standard for equipment breakdown. Levels 1–5 locate the asset; levels 6–9 decompose it.
Its governing principle is that a failure is recorded against *the component that actually
failed*, not against the machine.

| Level | Name | Type space | Instance space |
|---|---|---|---|
| 1–3 | Industry, business category, installation | `spec/honda` | `acme.com` |
| 4–5 | Plant, section | — | `site-3` |
| **6** | **Equipment unit** | `cb500f-2019` | `BIKE-07` |
| **7** | **Subunit** | `front-brake` | `front-brake` |
| **8** | **Maintainable item** | `caliper` | `caliper-88213` |
| **9** | **Part** | `pad-set` | `pad-set-45022KA` |

Depth is variable by design — the standard notes a single instrument may need no breakdown
while a compressor needs several levels. So the tree is stored **flat with a materialised
path**, not as nested subcollections:

```jsonc
{
  "urn":  "spec/ose/ceb-press-v6/main-cylinder/directional-valve",
  "path": ["spec/ose",
           "spec/ose/ceb-press-v6",
           "spec/ose/ceb-press-v6/main-cylinder"],   // ancestors, exclusive of self
  "depth": 4,
  "iso14224_level": 8
}
```

`array-contains` on `path` answers *"everything under this node"* in one query at any depth.

---

## 3. Type space

### `/spec_nodes/{urn}`
```jsonc
{
  "urn": "spec/ose/ceb-press-v6/main-cylinder/directional-valve",
  "path": [...], "depth": 4, "iso14224_level": 8,
  "kind": "component",
  "label": "Hydraulic directional valve",
  "parent": "spec/ose/ceb-press-v6/main-cylinder",
  "manufacturer": "ose",
  "model": "ceb-press-v6",
  "source": { "catalog": "ose-gvcs", "license": "CC-BY-SA-4.0",
              "url": "…", "retrieved_at": "2026-08-18T…" }
}
```

### `/spec_values/{id}` — what `per_spec` resolves against
```jsonc
{
  "node_urn": "spec/ose/ceb-press-v6/main-cylinder/directional-valve",
  "key": "mounting_torque",
  "kind": "range", "min": 6, "max": 9, "unit": "Nm",
  "cite": { "doc_id": "…", "section": "4.2", "page": 61, "quote": "Torque to 6–9 N·m" }
}
```

This introduces a **fourth provenance class** to `architecture.md` §1, which currently has
three (measured, inferred, asserted) across five rules. An acceptance rule of
`within(6, 9, "Nm")` is no longer invented in a Scoper conversation — it is **cited**, and
the sealed record carries the citation.

| Rule | Resolves against | Class |
|---|---|---|
| `per_spec(document.section)` | The manufacturer's published figure | **specified** |

> **Two pending corrections to `architecture.md` §1.** It must gain the row above, and the
> `consistent_with(asset.history)` row currently resolves against *Memory Bank* — it should
> resolve against the `readings` series in §4 here. Memory Bank consolidation is LLM-judged
> and treats two readings of the same field as a contradiction to reconcile, which destroys
> exactly the series the rule needs.

### `/spec_docs/{docId}` and `/spec_chunks/{chunkId}` — the retrieval corpus
```jsonc
// spec_docs
{ "title": "CEB Press v6 assembly", "publisher": "Open Source Ecology",
  "license": "CC-BY-SA-4.0", "source_url": "…",
  "applies_to": ["spec/ose/ceb-press-v6"],
  "region_replicas": ["us", "eu"],
  "armor": { "template": "spec-ingest", "verdict": "NO_MATCH_FOUND", "at": "…" } }

// spec_chunks
{ "doc_id": "…",
  "node_urns": ["spec/ose/ceb-press-v6/main-cylinder"],   // ← the pre-filter
  "text": "…", "page": 61, "section": "4.2",
  "embedding": /* Vector, 1536 dims */ }
```

**Retrieval is a hierarchical pre-filter, then a vector search inside the survivors:**

```python
db.collection("spec_chunks")
  .where("node_urns", "array_contains", node.urn)      # cuts to a handful of chunks
  .find_nearest("embedding", q, limit=8,
                distance_measure=DistanceMeasure.COSINE)
```

Firestore supports `where()` pre-filtering on `find_nearest` given a **composite vector
index**. Everyone else runs ANN across the whole corpus; this runs it across the eight chunks
that could possibly be relevant.

> **Dimension cap: Firestore supports at most 2048.** Use Matryoshka truncation to **1536**
> (or 768). A naive 3072-dim embedding will not index.

### Why the corpus is cheap
Chunks and embeddings are computed **once per machine model, not once per asset**. Four
hundred CEB presses share one corpus. That is the efficiency argument, and it is also why
regional replication for sovereignty is affordable.

---

## 4. Instance space

### `/tenants/{tenantId}`
```jsonc
{ "kind": "workspace",        // or "solo"
  "hd": "acme.com",           // the §7 Google Sign-In claim; solo tenants are "u:<sub>"
  "region": "eu" }            // sovereignty: evidence and memory never leave it
```

### `/tenants/{t}/nodes/{urn}` — the asset tree
Same materialised-path shape as `spec_nodes`, plus the one cross-namespace link:
```jsonc
{ "urn": "acme.com/site-3/BIKE-07/front-brake",
  "path": [...], "iso14224_level": 7,
  "type_ref": "spec/honda/cb500f-2019/front-brake" }   // ← the only edge between namespaces
```

### `/tenants/{t}/components/{componentId}` — identity that survives moving

A caliper fitted to a different machine must keep its history, so **position is a
time-varying property of a component, not part of its identity.**

```jsonc
// components/caliper-88213 — stable, never renamed
{ "type_ref": "spec/honda/cb500f-2019/front-brake/caliper",
  "serial": "88213",
  "current_position": "acme.com/site-3/BIKE-12/front-brake" }   // nullable when on the shelf

// components/caliper-88213/placements/{id} — the migration record
{ "position_urn": "acme.com/site-3/BIKE-07/front-brake",
  "from": "2025-04-02T…", "to": "2026-01-19T…",
  "job_ref": "jobs/…" }
```

*"This caliper has been through three machines and eleven jobs"* is one query on `placements`.

### `/tenants/{t}/readings/{id}` — the measured series
```jsonc
{ "schema_version": 1,
  "key": "pad_thickness", "value": 4.2, "unit": "mm",
  "component_id": "caliper-88213",       // ← was the parent path; now a field
  "at": "2026-07-14T…", "tool_id": "esp32-…",
  "job_ref": "…", "field_ref": "…" }
```

**Never embedded, never consolidated, never in Memory Bank.** These are numbers, queried
exactly and ordered by time. They are what `consistent_with(asset.history)` reads, and they
are the reason wear *rate* is computable at all.

> **Flat, not nested under the component — and this is a security boundary, not a style
> choice.** Readings are one of the collections a client may read but never write (§7), because
> `tool_id` is the only thing separating a measured number from a typed one. A rule can only
> protect a collection it can name, and a `{document=**}` wildcard binds only the FIRST path
> segment: at `/tenants/{t}/components/{cid}/readings/{id}` the rule sees `components` and the
> reading escapes the protected list entirely, leaving any signed-in tenant member able to POST
> a fabricated measured value. Anything that must be write-protected sits directly under
> `/tenants/{t}/`. The same reasoning flattens `procedure_versions` and splits `devices` out of
> `members`. See `specs/2026-08-20-firestore-design.md` §14.5.
>
> The only writer is `POST /api/ingest/reading`, authenticated by the device pairing rather
> than by a technician's session. That is what makes "a reading exists with this field_id and a
> tool_id" a claim only a paired instrument can cause to be true — which is exactly what the
> Seal checks when it decides whether a field is `measured`.

### `/tenants/{t}/overrides/{id}` — the shop disagreeing with the manufacturer
```jsonc
{ "target": "spec/honda/cb500f-2019/front-brake/caliper",
  "scope_kind": "type",              // or "instance"
  "key": "mounting_torque", "min": 28, "max": 28, "unit": "Nm",
  "reason": "aftermarket bolts",
  "signed_by": "uid:…", "at": "…" }
```

### `/tenants/{t}/jobs/{jobId}` and `…/fields/{fieldId}`
```jsonc
{ "step_id": "s4", "key": "pad_torque", "kind": "measurement",
  "value": 28, "unit": "Nm", "tool_id": "esp32-…",
  "component_ref": "caliper-88213",       // evidence attaches to the component
  "acceptance": { "rule": "within", "min": 6, "max": 9, "unit": "Nm" },
  "resolved_from": { "order": "spec",     // see §5
                     "spec_value_ref": "spec_values/…",
                     "cite": { "doc_id": "…", "section": "4.2", "page": 61 } },
  "provenance_class": "measured",
  "verdict": { "status": "PASS", "agent": "inspector",
               "model": "gemini-3.5-flash-…", "at": "…" } }
```

### `/tenants/{t}/jobs/{jobId}` — decomposed, not an aggregate document

The job document is a **header**: status, tier, timestamps and denormalised counters. Its
contents live in subcollections.

```
/tenants/{t}/jobs/{jobId}                          header — status, tier, counters
/tenants/{t}/jobs/{jobId}/step_outcomes/{stepId}    one per step, ALWAYS written
/tenants/{t}/jobs/{jobId}/fields/{stepId}__{key}    one per field, id derived not random
/tenants/{t}/jobs/{jobId}/captures/{captureId}      one per capture
```

Writing the whole aggregate to one document meant every capture rewrote the entire `steps[]`
array after reading the whole job inside a transaction: write cost grew with evidence already
captured, a 1 MiB document cap loomed, and two technicians on one job contended on a single
document. A capture now writes two documents and reads nothing.

The `Job` the `DataSource` seam returns is unchanged — assembled from the header plus two
subcollection reads. Storage moved and no screen did.

A field id is derived (`{stepId}__{key}`) so re-capturing REPLACES the current answer rather
than appending, which bounds the subcollection however many attempts a step takes. Nothing is
lost: every attempt stays in `captures`, which `storage.rules` makes append-only.

### `/tenants/{t}/members/{uid}` — who the people are

Server-written. Role and standing decide who may waive a step, approve a drafted order or
publish a procedure, and standing a person can grant themselves is not standing. The first
member of a tenant is its `owner`; everyone after is a `technician`. There is no invite flow,
because the Google directory already exists.

A member carries both Google's `photo_url` and our own `photo_ref` copy, because `lh3`
URLs rotate when someone changes their photo and can 404 — and a sealed record has to render
years later. The record denormalises name and avatar **at seal time**, so changing a profile
photo or leaving the company cannot rewrite who signed for a job.

### `/tenants/{t}/tasks/{taskId}` — what needs a human, and when

A projection of decisions the fleet already made — no new agent. `chase_after` on a Foreman
disposition becomes a due date; a drafted purchase order becomes an approval; an escalation to
a role becomes a queue. Ids are derived from the cause, so a replayed disposition updates one
task instead of creating a second.

A task assigned to a **role** has no owner and therefore no calendar event; claiming it is what
creates one. `notify_after` is a single computed clock — it starts at `due_at` and moves to
now + 24h after each notification — so the cross-tenant sweep is one equality and one
inequality on one field.

### `/records/{publicId}` — the capability URL

A **separate top-level root**, world-readable and nobody-writable, holding a redacted
projection: no tenant id, no uids, no storage refs, no costs. Holding the link is the whole
credential, which is what a paper service book always offered. Unsharing deletes the document,
and because media is proxied rather than signed, every image URL dies with it.

### `/user_secrets/{uid}` — OAuth refresh tokens

Reachable by nobody, including the user whose token it is. Top-level rather than under the
tenant, because the recursive tenant read would hand every colleague a token that writes to
this person's calendar.

### `/tenants/{t}/records/{jobId}` — written once by the seal, never updated

---

## 5. Resolution order

Resolving a bound for a field on `caliper-88213`:

| # | Source | Class |
|---|---|---|
| 1 | Override targeting this component | **asserted** — a named person signed |
| 2 | Override targeting its `type_ref` | **asserted** |
| 3 | `spec_values` at its `type_ref` | **specified** — cites document and section |
| 4 | Nothing — the Scoper asks | **asserted** by whoever answered |

The record therefore carries not just the number but *why that number*, and a stranger can see
that this shop overrode the manufacturer and who signed for it.

---

## 6. Where memory sits

Three Memory Bank scopes, all **inferred**, all instance-side:

| Scope | Holds |
|---|---|
| `{tenant}` | Shop vocabulary, fleet conventions the Scoper has learned |
| `{tenant, asset_urn}` | This machine's tendencies |
| `{tenant, component_id}` | This component's tendencies |

Memory Bank scope is **exact-match on all keys**, so hierarchy cannot live there — inheritance
is these three reads, unioned. Nothing measured and nothing from type space ever goes in.

---

## 7. Enforcement

The live rules are [`firestore.rules`](../firestore.rules), executed on every run of
`scripts/smoke.sh` against the real rules engine in the Firestore emulator. What follows is
that file's shape, with the two corrections implementation forced.

```javascript
function tenantOf() {
  return hd() != null
       ? hd()                                  // Workspace domain — the enterprise
       : (isAnonymous() ? "anon:" + request.auth.uid   // an unclaimed visitor
                        : "u:" + request.auth.uid);    // consumer account — a solo tenant
}

match /spec_nodes/{id}  { allow read: if request.auth != null; allow write: if false; }
match /spec_values/{id} { allow read: if request.auth != null; allow write: if false; }
match /spec_docs/{id}   { allow read: if request.auth != null; allow write: if false; }
match /spec_chunks/{id} { allow read: if request.auth != null; allow write: if false; }

match /tenants/{t}                        { allow read: if tenantOf() == t;
                                            allow write: if false; }

// Collections a client may READ within its tenant but never WRITE.
function serverWritten(c) {
  return c in ['members', 'records', 'decisions', 'readings', 'procedure_versions'];
}
// Claims a client may never make for itself, at any depth.
function clientMayNotClaim() {
  return request.resource.data.get('provenance_class', '') != 'measured'
      && request.resource.data.get('capture_surface', '') != 'app_instrument'
      && request.resource.data.get('status', '') != 'sealed'
      && request.resource.data.get('tool_id', '') == '';
}

match /tenants/{t}/{collection}/{doc=**} {
  allow read:  if tenantOf() == t;
  allow write: if tenantOf() == t && !serverWritten(collection) && clientMayNotClaim();
}

match /records/{publicId} { allow read: if true;         allow write: if false; }
match /user_secrets/{uid} { allow read, write: if false; }
```

The catalogue is operator-seeded and read-only to every tenant. Tenant data is reachable only
by its own tenant. Both follow from §7's identity model with no additional concepts.

> **Correction 1 — `hd` does not arrive by itself.** A Firebase ID token carries `sub`,
> `email`, `email_verified` and `firebase.identities`, and **drops the rest of the OIDC
> payload including Google's `hd`**. Written naively, every Workspace user resolves to a solo
> tenant and the enterprise model never fires — silently, because a solo tenant is a
> perfectly valid place to land. The fix takes the second token: `signInWithPopup` also
> returns Google's *own* ID token, which does carry `hd`. The server verifies it against
> Google's certificates, checks it belongs to the same Google account as the Firebase user,
> and writes `hd` as a **custom claim** — which Firebase *does* put in subsequent ID tokens,
> and which therefore appears at `request.auth.token.hd` exactly where the rule above looks.
> See `web/src/auth/google-hd.ts`.

> **Correction 3 — read and write cannot be granted together.** The original rule above was
> `allow read, write: if tenantOf() == t` for the whole tenant subtree, which made EVERY
> document writable by every member of that tenant at every depth. That contradicted four
> things stated elsewhere in this document and the contract: a sealed record "written once,
> never updated" that any member could overwrite; a `waived_by` requiring "a named person with
> standing" whose role that person could set themselves; agent decisions a public record quotes
> that anyone could forge; and readings whose `tool_id` is the only thing separating a measured
> number from a typed one. Firestore rules are **OR'd and have no deny**, so a narrower rule
> written afterwards cannot take a grant back — the write has to be narrowed at the point it is
> granted. Verified against the real rules engine; see `web/scripts/rules.test.mjs`.

> **Correction 2 — the `{collection}` segment is load-bearing.** In `rules_version = '2'` a
> recursive wildcard matches **zero** or more segments, so the obvious
> `match /tenants/{t}/{doc=**}` **also matches `/tenants/{t}` itself** and silently re-grants
> the write the line above it refuses. An outsider could create `acme.com` before anyone at
> acme.com had signed in and be sitting inside the enterprise when they arrived. Consuming
> the subcollection name explicitly means the shortest path the recursive rule can match is
> a collection, which is never a write target. This was found by the test, not by reading.

### Required indexes
| Collection | Index |
|---|---|
| `tasks` | **COLLECTION_GROUP**: `status` + `notify_after` — the cross-tenant sweep |
| `tasks` | `assignee_uid` + `status` + `due_at`; `assignee_role` + `status` + `due_at` |
| `procedures` | `status` + `updated_at` desc |
| `members` | `role` + `display_name` |
| `spec_chunks` | composite **vector**: `node_urns` array-contains + `embedding` (1536) |
| `nodes`, `spec_nodes` | `path` array-contains + `iso14224_level` |
| `readings` | `key` + `at` desc |
| `placements` | `position_urn` + `to` |

---

## 8. Seeding the catalogue

Three sources, deliberately chosen with three different licences — the catalogue records a
licence per document, and the spread is what makes the compliance story demonstrable rather
than asserted.

| Source | Licence | Gives | Use |
|---|---|---|---|
| **NHTSA vPIC** | US Government, public domain, no auth | Make / model / year for every US vehicle from 1981 | **Breadth** — thousands of type-space nodes, instantly |
| **Open Source Ecology GVCS** | **CC BY-SA 4.0** — no NonCommercial clause | 50 industrial machines — tractor, backhoe, sawmill, CEB press — with modules, BOMs and DXF CAD | **Depth. The primary seed** |
| **iFixit** | **CC BY-NC-SA 3.0 — NonCommercial** | Large device tree, step-by-step guides, repair API | The licence-gated example. See the caution below |

**Why OSE fits almost suspiciously well.** Its own documentation states that *machines are
composed of modules, and sometimes incorporate other machines* — that is ISO 14224 levels 6–8,
already structured. The CEB Press has 16 modules plus the machine. And OSE documents on
Dozuki, which is iFixit's enterprise product, so the procedures are already step-structured
and import near 1:1 into a Warrant procedure.

> **Caution on iFixit.** `BY-NC-SA` prohibits commercial use, and a submission competing for a
> cash prize is not comfortably non-commercial. Seed the catalogue from **vPIC and OSE**. Use
> iFixit, if at all, as the worked example of a document the promotion flow *refuses* — which
> is a better demonstration than shipping its content would be.

### Promotion
Uploads are tenant-scoped by default. Moving a document into the catalogue is an explicit,
reviewed, one-way act, and every promoted document is scanned by Model Armor on ingestion —
a poisoned chunk in a shared corpus reaches every tenant that reads it, which is the §8 threat
model applied to documents rather than photographs.

We do not verify the licensing position of promoted documents. That belongs in §12.

---

## 9. The search surface

The catalogue search is how an asset gets created: search type space, pick a model, instantiate
an instance node with a `type_ref`. From that moment the asset inherits every torque figure,
diagram and procedure attached to its type — including for a solo operator on a consumer
account, who gets the same manufacturer grounding a franchised dealership has.
