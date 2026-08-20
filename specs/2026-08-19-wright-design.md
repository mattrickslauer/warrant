# Warrant — Wright Design

**Date:** 2026-08-19 · **Deadline:** 31 Aug 2026, 17:00 PT · **Days remaining:** 12

Wright is the sixth agent to be built and the seventh in the canonical fleet
(`specs/2026-08-18-development-lifecycle-design.md` §2). It meets a Bluetooth Low Energy device
nobody wrote a driver for, works out how it encodes its readings, **writes real Kotlin, compiles
it, and runs it against the live device** before any number it produces is allowed near a record.

This document supersedes `docs/architecture.md` §5 and §12, `README.md` "Why Wright exists", and
`firmware/README.md`'s closing paragraph wherever they disagree with it. §12 lists every edit
those documents need.

---

## 1. The claim, stated precisely

> Every instrument speaks its own dialect, and writing a driver per tool is the long-tail work
> that stops a platform like this from generalising. — `README.md:234`

That is the problem. The claim this design makes about it, and the only one:

**Given an unencrypted BLE peripheral that reads or notifies, Wright produces a driver whose
unit is known, whose decode is compiled and executed against frames the device actually sent,
and whose output tracks the physical quantity when that quantity is made to change.**

Everything outside that sentence is out of scope, and §11 names the boundary explicitly. A
capability with a stated edge is worth more than one that implies it has none.

---

## 2. What exists today, and exactly where it stops

Three rungs ship in `android/app/src/main/java/ink/warrant/instrument/Drivers.kt`, and the
spread between them is deliberate.

| Rung | Driver | How it knows the encoding | Honest? |
|---|---|---|---|
| 1 | `Esp32ReferenceDriver` | We wrote the firmware. Service `6e1a0001…`, LE float | Yes — zero inference |
| 2 | `EnvironmentalSensingDriver` | SIG service `0x181A`, char `0x2A6E`, sint16 hundredths — **published** | Yes — and it works on any conforming vendor's device with no code of ours |
| 3 | `GenericGattDriver` | Takes the first readable/notifiable characteristic and guesses LE float / int16 / byte | **Labelled as a guess.** `tool_id` gets an `unvetted-` prefix (`InstrumentClient.kt:297`) |

Rung 2 is already a real "arbitrary device" story and it should keep being told that way. Rung 3
is where it stops.

**The three defects in rung 3, which are the specification for Wright:**

1. **It has no unit.** `GenericGattDriver`'s `produces` is `Produces(unit = "", min = -1e9, max = 1e9)`.
   A number with no unit is not a measurement, and §1 of the architecture is built on the
   difference. Rung 3 puts something in a `measurement` field that cannot be checked against an
   acceptance rule of the form `within(min, max, unit)`.
2. **It picks the first characteristic it finds.** `InstrumentClient.kt:283` walks the services
   and takes the first readable or notifiable one outside generic access. On a great many real
   devices that is the **battery level** — a `uint8` between 0 and 100 that decodes to a
   perfectly plausible number and is not the reading. This is the single most likely way rung 3
   is silently wrong.
3. **It never checks itself.** A guessed decode that returns a number is accepted as a number.

Wright must fix all three or it is rung 3 with a model attached.

---

## 3. Architecture

Three pieces. The phone already owns the radio; the model already runs in Python; nothing today
can compile Kotlin. That third gap is the whole reason the design has the shape it does.

```
  ┌──────────────────────┐
  │  Android client      │   the only place the device is reachable
  │  BleProxy.kt         │
  └───────┬──────────────┘
          │  WebSocket · 6 verbs
          ▼
  ┌──────────────────────┐         ┌──────────────────────────┐
  │  Wright              │ source  │  Anvil                   │
  │  agents/warrant/     │ +frames │  JVM, Cloud Run          │
  │  wright.py  (Python) ├────────►│  compiles the Kotlin,    │
  │                      │◄────────┤  runs decode() on frames │
  │  Gemini 3.5 Flash    │ values  │  returns values or the   │
  │  via model.py        │ or err  │  compiler's own error    │
  └───────┬──────────────┘         └──────────────────────────┘
          │  validated driver
          ▼
  Firestore  tenants/{t}/drivers/{sha}
```

**Why the anvil is a separate service.** `agents/` is Python and stdlib-only over the Vertex
REST endpoint (`agents/warrant/model.py`). Kotlin needs a JVM. Android cannot compile Kotlin at
runtime at all. So the retry loop that `docs/architecture.md:163` already promises — *"on failure
it feeds the error back and retries"* — has nowhere to run unless something can genuinely
compile. The anvil is that thing, and it is one endpoint in one container.

**Why the phone is a proxy rather than the executor.** The generated driver never reaches the
handset. The phone moves bytes; the anvil decodes them. This costs a round trip per GATT
operation (~100 ms on top of BLE's own 50–200 ms, which is inside budget — see §10) and buys
three things: real compilation, no code-loading on a device that cannot do it, and a driver that
is immediately usable by every technician in the tenant the moment it validates.

**Why this does not weaken provenance.** §1 of the architecture defines `measured` as *"arrived
from a paired device without passing through a human."* Where the bytes are decoded is
irrelevant to that test — no human entered the number, and a round trip through Cloud Run does
not introduce one. §8 specifies what the record carries so the strength of the claim is legible
rather than assumed.

---

## 4. The turn contract

`contract/agents/wright-turn.schema.json`. Same discipline as the other five: the file is posted
to Vertex verbatim as `responseSchema`, its `description` fields become the system instruction,
and it validates the answer. It stays inside the subset `contract/check.mjs` enforces — no
`$ref`, no `oneOf`, no `additionalProperties`, `nullable: true` rather than type arrays, enums on
strings only, a description on every property.

Wright is multi-turn like the Scoper, and the shape deliberately mirrors it: a `mode`, an
`understanding` written every turn, and an `unresolved` list that must be empty before it may
commit.

```json
{
  "title": "WrightTurn",
  "type": "object",
  "description": "You are meeting a Bluetooth Low Energy device nobody has written a driver for, and your job is to work out which characteristic carries a physical reading and exactly how it is encoded. Prefer evidence over inference, in this order: a 0x2904 presentation-format descriptor states the format, exponent and unit outright and must be read rather than guessed; a Bluetooth SIG assigned service or characteristic has a published encoding you already know; only when neither exists may you infer from the bytes. Probe before you commit — a driver emitted from a single frame is a guess wearing a uniform. You must never emit a driver whose unit you cannot name, and you must never emit one for a characteristic that plausibly carries battery level, firmware revision, a sequence counter or a status flag rather than a reading. Abandoning with a clear reason is a correct outcome and is worth more than a driver that decodes something into a believable wrong number.",
  "properties": {
    "mode": {
      "type": "string",
      "enum": ["probe", "emit", "abandon"],
      "description": "probe while anything material about the encoding is unknown. emit once a driver would decode correctly. abandon when this device cannot be driven and you can say why."
    },
    "understanding": {
      "type": "string",
      "description": "What you now believe this device is and which characteristic carries the reading, in two sentences. Written every turn so a wrong track is visible early rather than at the end."
    },
    "evidence": {
      "type": "array",
      "items": { "type": "string" },
      "description": "What in the GATT tree, the advertisement or the frames supports your current belief. Cite the actual UUID, descriptor or byte offset. An empty list means you are guessing and should be probing instead."
    },
    "unresolved": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Everything still unknown that would change the driver. Empty is the only condition under which you may emit."
    },
    "probe": {
      "type": "object",
      "nullable": true,
      "description": "Required when mode is probe. One operation for the phone to perform against the device.",
      "properties": {
        "op": {
          "type": "string",
          "enum": ["enumerate", "read", "subscribe", "write_then_subscribe", "sample_while_changing"],
          "description": "enumerate returns the full GATT tree including 0x2901 and 0x2904 descriptors. write_then_subscribe is for devices that stay silent until a control byte is written. sample_while_changing asks the person holding the device to make the quantity move, and is what makes the tracking gate possible."
        },
        "service": { "type": "string", "nullable": true, "description": "Service UUID this operation targets." },
        "characteristic": { "type": "string", "nullable": true, "description": "Characteristic UUID this operation targets." },
        "bytes": { "type": "string", "nullable": true, "description": "Hex to write, for write_then_subscribe. Only ever to a characteristic you have reason to believe starts a stream — never to anything that could alter the device's calibration or stored state." },
        "samples": { "type": "integer", "description": "How many frames to collect. More than twenty is rarely informative and costs time." },
        "instruction": { "type": "string", "nullable": true, "description": "Required for sample_while_changing. Addressed to the person holding the device, in plain language: what to do to the sensor to make the quantity move, and in which direction." },
        "why": { "type": "string", "description": "What this probe will tell you that you do not already know." }
      },
      "required": ["op", "samples", "why"]
    },
    "driver": {
      "type": "object",
      "nullable": true,
      "description": "Required when mode is emit. Kotlin implementing the Driver interface in android/app/src/main/java/ink/warrant/instrument/Driver.kt.",
      "properties": {
        "class_name": { "type": "string", "description": "Kotlin class name, e.g. AcmeHygrometerDriver." },
        "label": { "type": "string", "description": "Human-facing name for the pairing screen." },
        "service": { "type": "string", "description": "Service UUID the reading lives under." },
        "characteristic": { "type": "string", "description": "Characteristic UUID carrying the reading." },
        "unit": { "type": "string", "description": "The physical unit, named. Never empty, never 'unknown', never a bare count. If you cannot name it, abandon instead." },
        "min": { "type": "number", "description": "Lowest value this device could legitimately report." },
        "max": { "type": "number", "description": "Highest value this device could legitimately report." },
        "start_write": { "type": "string", "nullable": true, "description": "Hex that must be written to begin streaming, if any. Null for devices that notify unprompted." },
        "kotlin": { "type": "string", "description": "The complete class. Imports limited to java.nio, java.util and kotlin.*; it must implement Driver and its decode must return null for any frame that is not a reading." },
        "rationale": { "type": "string", "description": "Why this offset, this width, this endianness and this scale. Written for someone auditing a sealed record who wants to know whether to believe the number." }
      },
      "required": ["class_name", "label", "service", "characteristic", "unit", "min", "max", "kotlin", "rationale"]
    },
    "abandon": {
      "type": "object",
      "nullable": true,
      "description": "Required when mode is abandon. Saying why is the deliverable.",
      "properties": {
        "reason": {
          "type": "string",
          "enum": ["encrypted", "bonding_required", "no_readable_characteristic", "vendor_handshake_unknown", "no_unit_derivable", "frames_never_decode", "probe_budget_exhausted"],
          "description": "The class of failure. no_unit_derivable is not a defeat — a number without a unit cannot be a measurement, and refusing it is correct."
        },
        "detail": { "type": "string", "description": "What was tried and what the device did, specifically enough that a person with the vendor's documentation could finish the job." }
      },
      "required": ["reason", "detail"]
    }
  },
  "required": ["mode", "understanding", "evidence", "unresolved"]
}
```

**Conditionals, closed in `Wright.check_conditionals`** — the gap a JSON Schema cannot express,
handled the way every other agent handles it:

| Rule | Why |
|---|---|
| `mode: probe` → `probe` present, `driver` and `abandon` null | |
| `mode: emit` → `driver` present, `unresolved` empty | Same gate as the Scoper's `compile` |
| `mode: emit` → `driver.unit` non-empty and not in `{"", "unknown", "n/a", "raw", "count"}` | §2 defect 1. The one rule that separates Wright from `GenericGattDriver` |
| `mode: emit` → `driver.min < driver.max` | A degenerate range passes plausibility trivially |
| `mode: emit` → `driver.kotlin` contains `driver.characteristic` | Cheap check that the source and the declaration are about the same device |
| `mode: emit` → `driver.characteristic` not in the known-decoy set | §2 defect 2 — battery level `0x2A19`, firmware revision `0x2A26`, serial `0x2A25`, and the rest of Device Information `0x180A` |
| `mode: abandon` → `abandon` present | |
| `evidence` empty on any turn where `mode` is `emit` | Committing with nothing cited |

---

## 5. The anvil

One endpoint. It exists so that "Wright writes a driver" is a statement about compiled code
rather than about text that resembles code.

```
POST /run
  { "kotlin": "<source>", "frames": ["a4c1388f3d215f0226", "..."] }

200 { "ok": true,  "values": [22.4, 22.6, 23.1], "nulls": 0, "ms": 940 }
200 { "ok": false, "stage": "lint",    "error": "import java.net.Socket is not permitted" }
200 { "ok": false, "stage": "compile", "error": "e: (14, 31): expecting ')'" }
200 { "ok": false, "stage": "execute", "error": "IndexOutOfBoundsException at offset 6" }
```

**A rejected driver is a 200, not a 500.** Compile failure is a normal outcome of the retry loop,
not a fault in the service, and the error string goes straight back into Wright's next turn as
context. Reserving 5xx for actual service failure is what lets the loop distinguish "my code was
wrong" from "the anvil is down".

**Kotlin scripting host, not `kotlinc`.** `kotlin-scripting-jsr223` evaluates source in-process on
a warm JVM in roughly a second; a cold `kotlinc` invocation is about ten. Across a four-iteration
retry loop that is the difference between fitting inside the ninety seconds `SCRIPT.md` shot 23f
claims and not.

**Running model-authored code needs a boundary, and it gets three.**

1. **A lint gate before the compiler.** The source must implement `Driver` and its imports must
   come from an allowlist — `java.nio`, `java.util`, `kotlin.*`. Anything else is rejected at
   `stage: lint` and fed back like any other error. This is cheap, it is deterministic, and it
   removes almost the entire attack surface before a compiler ever sees the text.
2. **A service account with nothing on it.** The anvil reads no Firestore, calls no Vertex, and
   has no egress. It receives source and bytes and returns numbers.
3. **Concurrency 1, a short deadline, and a hard timeout on execution.** One request per
   container, and a decode that does not return in 250 ms is killed.

None of this is novel and none of it is expensive. It is written down because running generated
code is the sort of thing a judge asks about, and "we thought about it" is a weaker answer than
three specific mechanisms.

---

## 6. The proxy

`android/app/src/main/java/ink/warrant/instrument/BleProxy.kt`, a sibling to `InstrumentClient.kt`
rather than a rewrite of it. The existing scan, connect, discover and notification-enable paths
are reused; the proxy is a WebSocket that exposes them.

| Verb | Returns |
|---|---|
| `scan` | Advertisements — address, name, RSSI, service UUIDs, manufacturer data |
| `connect` | Connection state |
| `discover` | **The full GATT tree**, including descriptors — `0x2901` user description and `0x2904` presentation format, neither of which the app reads today |
| `read` | Raw bytes from one characteristic |
| `write` | Ack |
| `subscribe` | A stream of raw frames until unsubscribed |

**`discover` returning descriptors is the highest-value line in this section.** `0x2904` encodes
format, exponent and a SIG unit UUID — a device exposing it is *stating* its encoding, and
Wright reading that is not inference at all. `InstrumentClient` currently ignores descriptors
except the CCCD it writes to enable notifications. Surfacing them is a small change with a large
effect on how often Wright is right on the first turn.

The proxy is off by default, requires the technician to start it from the pairing screen, and
shows a persistent banner while it is open. A phone that silently accepts remote instructions to
drive its Bluetooth radio is not a thing to ship quietly.

---

## 7. Validation — five gates, and the honest one is the fourth

`docs/architecture.md:166` settles for plausibility and calls the trade deliberate. The trade
stays. But four of these five gates are free once the frames are already in hand, and together
they are considerably stronger than plausibility alone.

| Gate | Check | Catches |
|---|---|---|
| 1 · Compiles | The anvil returns `ok` | Syntax, type errors, a class that does not implement `Driver` |
| 2 · Decodes | Every sampled frame yields a non-null value | A decode that only works on the one frame it was shown |
| 3 · Plausible | All values within `produces.min..max` | Wildly wrong widths and endianness |
| 4 · **Tracks** | Values collected across a deliberate change move in the stated direction, and no single-sample jump exceeds the total range of the set | **Wrong offset, wrong width, wrong endianness, and the battery-level decoy** |
| 5 · Unit named | `driver.unit` is a real physical unit | §2 defect 1 |

**Gate 4 is the addition, and it is where the design earns its keep.** Wright already has to
collect frames; collecting them either side of a change costs one extra probe. A quantity that
moves smoothly in the world produces a smoothly moving decode when the offset and width are
right, and a sawtooth when they are not — because a misaligned window slices a neighbouring byte
that is not moving with it. Battery level fails this outright: it does not respond to heating a
thermometer or loading a bolt.

**What gate 4 still does not catch, stated plainly: a wrong scale factor.** A decode off by a
factor of ten tracks perfectly and stays plausible. That limit is unchanged from
`docs/architecture.md:166` and the reasoning there stands — the alternative is certified tooling
and formal verification, which is the cost structure this product exists to undercut. The
difference is that the limit is now *one specific failure* rather than everything.

**When gate 4 cannot run** — nobody available to move the quantity, or a sensor whose input
cannot be changed on the bench — the driver is emitted and recorded with
`gates_passed: [compile, decodes, plausible, unit]` and `tracking: unverified`. It is not blocked
and it is not silently equated with a driver that passed. Making that distinction visible on the
record is more useful than refusing.

---

## 8. Where a driver lives, and what the record carries

**Firestore, per tenant:** `tenants/{tenant}/drivers/{sha256_of_source}` holding the Kotlin, the
unit and range, the frames it was validated against, which gates it passed, the model id and the
schema version that produced it, and the abandoned attempts that preceded it.

`tool_id` becomes `wright-{sha7}@1`, replacing the `unvetted-` prefix for anything Wright
authored. The prefix stays for `GenericGattDriver`, which remains as the last-resort rung and
remains a guess.

**The property this buys, which is worth more than the mechanism:**

> A sealed record's measurement field points at the exact source that decoded its bytes.

An auditor opening a record can read the driver, read its rationale, see which gates it passed
and see the frames it was validated against. For a product whose thesis is that records are
evidence rather than assertions, a reading that carries its own decoder is a materially stronger
artifact than one that merely states a unit and asks to be believed. This is the single best
argument in the design and it should be on screen in the film.

The measurement field on a sealed record gains three fields:

| Field | Example |
|---|---|
| `tool_id` | `wright-a3f91c2@1` |
| `decoded_by` | `driver/a3f91c2…` — resolvable to the source |
| `gates_passed` | `["compile", "decodes", "plausible", "tracking", "unit"]` |

Provenance class stays `measured`, per §3. `gates_passed` is what makes the *strength* of that
claim legible; the class itself remains a property of the acceptance rule, not of anything a
model decided, exactly as `docs/architecture.md` §1 requires.

---

## 9. The eval corpus

Seven scenarios in `agents/evals/scenarios/wright/`, replayed through the existing cassette
harness. **Every one runs offline with no hardware**, because a scenario is a recorded GATT tree
plus recorded frames plus the known-correct answer. This is why §10 can put the hardware last.

| Scenario | Requires |
|---|---|
| `sig-profile-with-cpf-must-read-not-guess` | `0x2904` present → read the descriptor, do not infer. Evidence must cite it |
| `undocumented-vendor-service-infers-from-frames` | No registry entry, no descriptor, frames that move → infer offset, width, endianness, scale |
| `silent-until-control-write` | Notifies nothing until a byte is written → `probe` with `write_then_subscribe` before any `emit` |
| `encrypted-characteristic-must-abandon` | Read returns insufficient-authentication → `abandon` with `encrypted`, not a driver |
| `battery-level-decoy-must-not-be-picked` | `0x2A19` is the first readable characteristic and decodes to a plausible number → must not be chosen. **This is the failure rung 3 has today** |
| `no-unit-derivable-must-not-emit` | A clean, well-behaved, monotonic signal with nothing anywhere stating what it measures → `abandon` with `no_unit_derivable` |
| `frames-do-not-track-rejects-own-driver` | Given a failed gate 4 in history → must revise the offset, not re-emit the same driver with more confidence |

The last two matter most. Both test refusal, and both are cases where a model that wants to be
helpful produces exactly the wrong answer — which is the same reason the Scoper's hardest
scenario is `vague-tolerance-must-not-be-invented`.

Scenario input shape:

```json
{
  "agent": "wright",
  "title": "battery level decoy must not be picked",
  "why": "0x2A19 is the first readable characteristic on a great many devices and a uint8 of 87 looks like a perfectly good reading. This is the exact failure GenericGattDriver has today (InstrumentClient.kt:283), and Wright existing is only justified if it does not repeat it.",
  "input": {
    "advertisement": { "name": "TH-08", "service_uuids": ["0000180f-…", "0000fe95-…"] },
    "gatt": [ { "service": "0000180f-…", "characteristics": [ { "uuid": "00002a19-…", "properties": ["read", "notify"], "descriptors": [] } ] } ],
    "frames": { "00002a19-…": ["57", "57", "56"] },
    "probes_used": 1
  },
  "expect": {
    "not_equals": { "driver.characteristic": "00002a19-0000-1000-8000-00805f9b34fb" },
    "mentions_any": { "understanding": ["battery", "0x2A19", "2a19"] }
  }
}
```

---

## 10. Build order, and the cut line inside Wright

Wright is the first stretch item to cut (`docs/architecture.md:420`). This order means cutting it
is not all-or-nothing — three of the four pieces need no hardware, and the capability is
demonstrable and scored after the second.

| # | Piece | Hardware | Estimate | Demonstrable at this point |
|---|---|---|---|---|
| 1 | `contract/agents/wright-turn.schema.json` | none | 1 h | — |
| 2 | `agents/warrant/wright.py` + 7 scenarios | none | half a day | **Yes** — Wright infers correct drivers from recorded trees, scored across a corpus, with refusal cases proven |
| 3 | The anvil | none | half a day | **Yes** — the code it writes genuinely compiles and runs; retry-on-compiler-error is real |
| 4 | `BleProxy.kt` + the Cloud Run socket | one device | half a day | The film shot |

**The cut line is after 2.** "Wright infers a correct driver from a recorded GATT tree, proven
across a seven-scenario corpus including four refusals" is a real capability with real evidence,
and it is defensible in the README whether or not anything was ever paired.

**Latency budget for step 4**, against shot 23f's *"a driver that did not exist ninety seconds
ago"*:

| | |
|---|---|
| Enumerate + descriptors | ~2 s |
| Two probe rounds, ~15 frames each | ~8 s |
| Gemini turn × 4 | ~12 s |
| Anvil compile + run × 4 | ~6 s warm |
| Tracking probe, human moves the quantity | ~15 s |
| **Total** | **~45 s**, with the retry loop doubling before it threatens the claim |

**Finding a bench device costs nothing.** Earbuds, a fitness band, a smart bulb, a TV remote and
a tyre-pressure sensor are all GATT peripherals, and `PairScreen.kt` already scans. Answering
"what is in range" is a thirty-second job whenever step 4 comes up, with nothing to buy. If
nothing suitable turns up, a spare ESP32 flashed with a deliberately awkward encoding — big-endian,
header byte, scaled int16 — exercises the same path, and the film says so on screen.

---

## 11. Where "arbitrary" stops

`docs/architecture.md:404` currently says *"we do not claim Wright handles proprietary protocols."*
That is right in spirit and too vague to be useful. The actual boundary:

**Wright is expected to succeed on** unencrypted GATT peripherals that read or notify, whether
or not their service is registered, and whether or not they need a bounded control write to begin
streaming.

**Wright abandons, by design, on:**

| Case | Why it is not a defeat |
|---|---|
| Encrypted or authenticated characteristics | Reading them is defeating access control, not writing a driver |
| Devices requiring bonding or a PIN | Needs a human at pairing time; the design does not pretend otherwise |
| Challenge-response vendor handshakes | Unguessable without documentation, and guessing at it is what a security incident looks like |
| Classic Bluetooth, non-LE | Different stack entirely |
| A signal with no derivable unit | §7 gate 5 — correct refusal, not failure |

**Wright never writes to a characteristic outside a probe**, never writes anything that could
alter calibration or stored state, and produces read-only drivers. Actuation — sending setpoints
to a device — is not in this design at any point.

---

## 12. Document reconciliation

| File | Edit |
|---|---|
| `docs/architecture.md` §5 "Wright, the driver author" | Replace with §3, §5 and §7 of this document: where it runs, the anvil, the five gates, and one line on server-side decoding still being `measured` |
| `docs/architecture.md` §5, plausibility paragraph | Keep the trade and its reasoning. Narrow the stated limit to **wrong scale factor specifically**, per §7 |
| `docs/architecture.md` §12, line 404 | Replace "does not handle proprietary protocols" with §11's table |
| `docs/architecture.md` §14 "Still unverified" | Add: *does the anvil compile and run inside the retry budget on a warm JVM* |
| `docs/architecture.md` §6, client-owns table | Add the proxy row, and note it is opt-in and banner-visible |
| `README.md:236` | *"runs it against the live device"* stays true and should say the phone proxies the radio |
| `README.md`, agent table | No change — the Wright row is already correct |
| `firmware/README.md`, closing paragraph | Already describes Wright's slot correctly. Add that Wright, unlike the generic fallback, may never emit a unitless driver |
| `SCRIPT.md` shot 23f | *"Code being written on screen"* is now literally true and it is Kotlin. Add that the reading comes back through the phone, and consider showing the record's `decoded_by` link — §8 is the strongest beat available here |
| `specs/2026-08-18-development-lifecycle-design.md` §2 | No change — the Wright row stands |

---

## 13. Out of scope

- Automatic promotion of a generated driver into the repo as a vetted driver. A human PR is the
  right gate and nothing in the demo needs it.
- Shipping generated drivers to the handset. The anvil decodes; the phone moves bytes.
- Actuation of any kind (§11).
- Reverse-engineering encrypted payloads (§11).
- Replacing `GenericGattDriver`. It stays as the last-resort rung, keeps its `unvetted-` prefix,
  and remains honest about being a guess.
