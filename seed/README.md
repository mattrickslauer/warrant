# seed/

Downloaded catalogues for **type space** — the `spec/…` namespace in
[`docs/data-model.md`](../docs/data-model.md). Nothing here is tenant data, and nothing here
is ours; each source keeps its own licence, recorded below and enforced by the promotion flow.

Re-fetch any of it:

```bash
python3 scripts/fetch_seed_ose.py       # Open Source Ecology  -> seed/ose/
python3 scripts/fetch_seed_vpic.py      # NHTSA vPIC           -> seed/vpic/
python3 scripts/fetch_seed_ifixit.py    # iFixit taxonomy only -> seed/ifixit/
```

All three are resumable and re-runnable; the OSE fetcher skips guides it already has.

## Inventory — fetched 2026-08-18, 8.6 MB

| Source | Licence | Contents |
|---|---|---|
| **ose/** | CC BY-SA 4.0 | 12 machines · 61 tree nodes · 121/121 guides · **931 steps** across 108 procedural guides |
| **vpic/** | US Gov, public domain | 12,337 manufacturers · 9 vehicle types · 1,684 motorcycle marques · 4,609 model-year rows across 14 marques |
| **ifixit/** | CC BY-NC-SA 3.0 | 5,382 taxonomy nodes. **No guide content** — see below |

Makes per vehicle type: Trailer 9,559 · Motorcycle 1,684 · Low Speed Vehicle 517 · Truck 207 ·
Passenger Car 195 · Bus 132 · Incomplete Vehicle 125 · MPV 111 · **Off Road Vehicle 0**
(vPIC returns an empty set for that type; it is not a fetch failure).

---

## ose/ — the primary seed

**Open Source Ecology, Global Village Construction Set. CC BY-SA 4.0.**
No NonCommercial clause, so it can be ingested into the catalogue.

| File | Contents |
|---|---|
| `categories.json` | The machine → module → component tree, 12 machines |
| `guides_index.json` | All 121 guides in summary form |
| `guides/{id}.json` | Each guide in full — steps, lines, tools, parts, per-step time |

Machines: CEB Press · PowerCube · LifeTrac (tractor) · Backhoe · Bulldozer · Laser Cutter ·
3D Printer · Rototiller and Soil Pulverizer · MicroHouse v1–v4.

**Why this one is the primary seed.** Its hierarchy is already ISO 14224 levels 6–8, with no
transformation needed:

```json
"CEB Press": {                          // level 6, equipment unit
  "CEB Press - Modules": {              // level 7, subunit
    "Frame": {}, "Hopper": {},          // level 8, maintainable item
    "Controller": {}, "Module - Grate": {}, "Module - Roller Guides": {}
  }
}
```

And the guides are already step-structured, so they map onto a Warrant procedure almost
one-for-one — a guide becomes a procedure, a step becomes a step, `parts` and `tools` become
the preconditions:

```
CEB Shaker Hammer and Shaft — 4 steps
  parts: Welder, Angle grinder, Drill press, Chalk or something to mark steel with
  step 1 "Prepare the hammer": Drill or punch the hole in the flatbar.
```

OSE documents on Dozuki, which is iFixit's enterprise product, which is why the read API and
the shape are the same.

---

## vpic/ — the breadth

**NHTSA Vehicle Product Information Catalog. US federal government work, public domain.**
No key, no authentication, no rate limit published.

| File | Contents |
|---|---|
| `makes.json` | Every manufacturer vPIC knows |
| `vehicle_types.json` | The nine vehicle types it classifies makes under |
| `makes_by_type.json` | Manufacturers per type |
| `motorcycle_models.json` | Models by make and year, 2018–2026, for the marques a working bike shop sees |

vPIC stops at ISO 14224 **level 6**. It knows what a machine *is*, never what it is made of —
which is exactly the division of labour with OSE, which goes deep on few machines while vPIC
goes wide on many.

---

## ifixit/ — taxonomy only, deliberately

**iFixit. CC BY-NC-SA 3.0 — NonCommercial.**

A submission competing for a cash prize does not sit comfortably inside a NonCommercial
clause, so `scripts/fetch_seed_ifixit.py` takes **the category tree and nothing else**: device
names and their nesting, 5,382 nodes. No guide text, no steps, no images.

It is not ingested. It is retained as the worked example of a document the promotion flow
**refuses** on licence grounds — see `docs/data-model.md` §8. A licence gate you can watch
reject something is worth more than the content would have been.

---

## How this lands in Firestore

| Here | Becomes |
|---|---|
| `ose/categories.json` | `/spec_nodes` — `urn`, `path`, `iso14224_level`, `parent` |
| `ose/guides/*.json` | Procedures, and `/spec_values` where a guide states a figure |
| `vpic/makes*.json`, `motorcycle_models.json` | `/spec_nodes` at level 6 |
| `ifixit/categories.json` | Nothing. The refusal demo |

Every `/spec_nodes` document carries the `source` block recording catalogue, licence, URL and
retrieval date, so a sealed record citing a spec value can also say where that value came from
and under what terms.
