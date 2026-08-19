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
  "kind": "range", "min": 26, "max": 30, "unit": "Nm",
  "cite": { "doc_id": "…", "section": "4.2", "page": 61, "quote": "Torque to 26–30 N·m" }
}
```

This introduces a **fourth provenance class** to `architecture.md` §1, which currently has
three (measured, inferred, asserted) across five rules. An acceptance rule of
`within(26, 30, "Nm")` is no longer invented in a Scoper conversation — it is **cited**, and
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

### `/tenants/{t}/components/{cid}/readings/{id}` — the measured series
```jsonc
{ "key": "pad_thickness", "value": 4.2, "unit": "mm",
  "at": "2026-07-14T…", "tool_id": "esp32-…",
  "job_ref": "…", "field_ref": "…" }
```

**Never embedded, never consolidated, never in Memory Bank.** These are numbers, queried
exactly and ordered by time. They are what `consistent_with(asset.history)` reads, and they
are the reason wear *rate* is computable at all.

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
  "acceptance": { "rule": "within", "min": 26, "max": 30, "unit": "Nm" },
  "resolved_from": { "order": "spec",     // see §5
                     "spec_value_ref": "spec_values/…",
                     "cite": { "doc_id": "…", "section": "4.2", "page": 61 } },
  "provenance_class": "measured",
  "verdict": { "status": "PASS", "agent": "inspector",
               "model": "gemini-3.5-flash-…", "at": "…" } }
```

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

```javascript
function tenantOf() {
  return request.auth.token.hd != null
       ? request.auth.token.hd                 // Workspace domain — the enterprise
       : "u:" + request.auth.token.sub;        // consumer account — a solo tenant
}

match /spec_nodes/{id}  { allow read: if request.auth != null; allow write: if false; }
match /spec_values/{id} { allow read: if request.auth != null; allow write: if false; }
match /spec_docs/{id}   { allow read: if request.auth != null; allow write: if false; }
match /spec_chunks/{id} { allow read: if request.auth != null; allow write: if false; }

match /tenants/{t}/{doc=**} { allow read, write: if tenantOf() == t; }
```

The catalogue is operator-seeded and read-only to every tenant. Tenant data is reachable only
by its own tenant. Both follow from §7's identity model with no additional concepts.

### Required indexes
| Collection | Index |
|---|---|
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
