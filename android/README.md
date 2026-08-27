# android/

The technician's app. **Where evidence is made** — the only surface that cannot be
substituted, and therefore the one that got built first.

Native Kotlin and Jetpack Compose, with CameraX and the platform BLE stack. No bridge, no
wrapper to fight when a device misbehaves.

---

## Build and install

```bash
cd android
./gradlew assembleDebug                   # → app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Requires JDK 17 and an Android SDK with platform 35. `local.properties` points at the SDK and
is not committed.

```bash
./gradlew testDebugUnitTest lintDebug     # 17 unit tests, lint clean
```

---

## What is real and what is scripted

Being precise about this matters more than the demo looking good.

| | |
|---|---|
| **Real** | Camera capture, on-device face redaction, BLE scan / connect / GATT read, driver decoding, the tier refusal, the Seal and the Gate |
| **Scripted** | Agent verdicts, their rationales and their costs — played from `data/Fixtures.kt` on a clock |
| **Not built yet** | Google sign-in, the network layer, Play Integrity attestation, plate redaction, speech-to-text on spoken reasons |

The app says so on screen. The fixture banner at the top of a job is not decoration: a demo
that looks like production is how somebody gets misled.

---

## The home screen

No title, no tagline — **the screen IS the picker**, the same decision the web landing page
made. A person opening this is here to do a job, and a masthead costs them a scroll before they
can start one.

- A snapping **carousel** of the public procedures, one card each, mirroring
  `web/src/app/page.tsx` exactly — same order, names, notes and artwork. A judge who opens the
  hosted page and then installs the app must land on the same six tasks, because the only
  intended difference between the surfaces is what each can *prove*.
- Cards carry the classes the task reaches AND the struck-through ones it cannot, plus the
  refusal when this surface is below the procedure's minimum tier.
- Under it, a thin **Create a procedure ›** bar → `procedure/create`, behind Google sign-in.

Authoring is gated and running a task is not, deliberately: a stranger should be able to make a
record in seconds, but a procedure governs every job ever run against it, so it belongs to a
tenant — and there is no tenant without an identity.

### Sign-in needs a client id

`res/values/auth.xml` ships with `google_web_client_id` **empty**, because a client id belongs
to whoever deploys this. Until it is set the gate says so plainly rather than offering a button
that cannot work. Get one from Google Cloud console → APIs & Services → Credentials → OAuth
client ID → **Web application** (Credential Manager wants the web client id, not the Android
one, though an Android client for this package and signing certificate must exist in the same
project).

The `hd` claim on the account decides the tenant shape, per `docs/architecture.md` §7: a
Workspace domain is an enterprise tenant, a consumer account is a tenant of one.

## The shape of it

```
contract/Types.kt        The entities, hand-written from contract/entities/, guarded by a test
data/DataSource.kt       The seam. Every screen reads and writes through this and nothing else
data/FixtureSource.kt    The scripted timeline — deliberately slow in the right places
data/Seal.kt             The deterministic core: ceiling, deficiencies, Gate, seal
design/                  Tokens.kt (generated) + WarrantTheme
instrument/              The Driver contract, three drivers, the BLE client, the session
capture/Redactor.kt      ML Kit face masking, before anything leaves the device
auth/                    Google sign-in via Credential Manager; hd claim -> tenant
ui/components/           The primitives, mirroring web/src/components by name
ui/PublicTasks.kt        The carousel's cards, mirroring web/src/app/page.tsx
ui/job/                  The capture surface
ui/procedure/            Create a procedure, behind the sign-in gate
```

### The seam

Screens depend on `DataSource` only. Swapping `FixtureSource` for `LiveSource` is one line in
`WarrantApplication.Container` and touches no screen — that is the whole point, and keeping the
decision in one visible place is what stops it leaking back into the UI.

`FixtureSource` plays a **timeline**, not a set of settled answers. Capture returns immediately
and a verdict lands seconds later, sometimes appending a field the procedure did not contain
when the job started. Screens built against settled answers all break the day the real backend
arrives; these could not have been.

### One token source

`design/tokens.json` at the repo root generates `design/Tokens.kt` **into this source tree**:

```bash
node design/build-tokens.mjs      # writes tokens.css (web) and Tokens.kt (here)
```

Never edit `Tokens.kt`. `WarrantTheme.kt` decides which token plays which role on which
ground; it invents no colours.

### One rule that is not cosmetic

Carried over verbatim from `web/src/components/library.css`:

- **mono + tabular numerals** — the value came from a machine (measured, specified, timestamps,
  tool ids, part numbers, money)
- **sans** — the value came from a person (assertions, signatures, reasons, explanations)

Provenance is legible in the typeface before you reach the colour chip. Do not mix them.

---

## The instrument

`instrument/Driver.kt` is the contract from `docs/architecture.md` §5: `matches` (scan filter),
`produces` (kind, unit, range), `decode` (raw bytes → value). **Nothing above it cares which
tool it is.** A `measurement` field knows only that a number arrived from a paired device
without passing through a human, and that is the sole property that makes it *measured*.

Three drivers ship:

| Driver | For |
|---|---|
| `Esp32ReferenceDriver` | Our reference instrument — see `firmware/` |
| `EnvironmentalSensingDriver` | The BLE SIG Environmental Sensing profile, any conforming device |
| `GenericGattDriver` | An unrecognised device: first readable characteristic, decoded as float or int16, tool id marked `unvetted-` |

`FakeDriver` produces simulated readings so the flow can be shown with nothing paired. Its tool
id is prefixed `fake-` and every surface marks it, because a fabricated reading must never be
able to reach a record as a measurement.

**The measurement field has no keyboard.** Not an oversight — if a person can type the number,
the number is asserted, and calling it measured afterwards would be a lie told by the user
interface. With no instrument paired the field cannot be satisfied at all, and the step gets
explained through the second exit instead.

---

## Verified on hardware

Run on a Xiaomi 2312FPCA6G, Android 13 (SDK 33), arm64-v8a, 19 Aug 2026. No crashes.

- [x] Installs, launches, renders in the workshop ground
- [x] **Capture never waits on a model** — the shutter writes a file, the step advances, and
      "Verification is running behind you" appears immediately
- [x] **On-device ML Kit redaction runs** — reported "No faces found. Nothing to mask."
- [x] **ADD FIELD arrives late and lands on the JOB** — ~2.7s after the step-2 capture, an
      alert appeared offering *Go to that step* / *Later*. The form grew a field the procedure
      did not contain when the job started
- [x] **The tier refusal holds** — Front brake service is greyed with a stated reason rather
      than quietly downgraded
- [x] **BLE scan against real radios** — ten devices discovered, sorted by RSSI, each correctly
      reported as claimed by no shipped driver
- [x] A simulated instrument connects but does NOT raise the tier

Four defects were found this way and fixed: content sliding under the system bars; the camera
`SurfaceView` painting over the field prompt and evidence chip; chips compressing to one letter
per line; and — the serious one — `CaptureTile` state leaking between steps, so step 2 showed
step 1's photograph.

## Still to verify

Needs the ESP32 powered and flashed:

- [ ] **G1 — an ESP32 GATT read reaches the client.** Flash `firmware/`, scan, connect, watch a
      reading fill `pad_torque`. This is the hello-world for the entire system, and it is the
      one claim in this README that hardware has not yet backed.
- [ ] The hold-to-speak second exit, including the microphone permission path.
- [ ] Behaviour when the instrument disconnects mid-job.

### One decision this raises

`Front brake service` needs the `instrumented` tier, so **with no ESP32 it cannot be started at
all** — which means the measurement field and `ReadingBadge`, the surfaces that carry the whole
argument, cannot be shown without hardware. The simulated instrument deliberately does not lift
the tier.

That is correct as a guarantee and risky as a demo, since it puts the most important screen
behind a breadboard working on the day. `architecture.md` §2 already says where the guarantee
belongs — *"the gate is the seal, not the step"* — so the alternative is to let a simulated
instrument satisfy the tier, run the job, and have the **Seal** refuse the reading and stamp the
record deficient. Same guarantee, later, and the demo survives the hardware failing. Not changed
without a decision.
