# firmware/

The reference instrument, and the hardware half of gate **G1**: *an ESP32 GATT read reaches the
client*.

## What this is

`warrant_reference_instrument.ino` turns any ESP32 dev board into a BLE peripheral that
notifies a float twice a second. The Android client's `Esp32ReferenceDriver` reads it and fills
a `measurement` field.

**What it measures is irrelevant.** It exists to prove the path end to end and to make the
driver abstraction concrete. Replace `readSensor()` with a real sensor and nothing above the
driver changes — that substitution is the whole argument.

## The contract

These four lines must agree with `android/…/instrument/Drivers.kt`:

| | |
|---|---|
| service | `6e1a0001-b5a3-f393-e0a9-e50e24dcca9e` |
| characteristic | `6e1a0002-b5a3-f393-e0a9-e50e24dcca9e` (notify + read) |
| payload | 4 bytes, little-endian IEEE-754 float |
| device name | `Warrant Ref 01` |

## Flashing

**PlatformIO, no IDE:**

```bash
cd firmware
pio run -t upload          # first run downloads the toolchain, ~2 minutes
pio device monitor         # 115200; prints on boot and on every notify
```

`platformio.ini` pins the platform deliberately — see the comment in it. Flashed and verified
against a CH340 board on 2026-08-20: ~1.1 MB image, 84% of flash.

**Or Arduino IDE:** board **ESP32 Dev Module**, no extra libraries. Upload, then open the serial
monitor at 115200 to watch it advertise and notify.

Note that `loop()` only prints once a client is connected, so silence on the monitor with
nothing paired is correct and is not a sign the board failed to start.

## If your ESP32 already runs something else

You do not have to reflash. The client connects to an unrecognised device and works down three
rungs, in this order:

1. **The device declares its encoding.** If the chosen characteristic carries a `0x2904`
   presentation-format descriptor, it has stated its own width, scale and unit, and
   `DeclaredFormatDriver` follows that specification. Nothing is inferred and no per-vendor code
   was written. The tool id is prefixed `declared-`.
2. **We cannot resolve the declared unit, or there is no descriptor.** `GenericGattDriver`
   decodes as a little-endian float or int16. That is a guess, and the tool id says so with an
   `unvetted-` prefix.
3. **Nothing on the device could carry a reading.** The connection fails with that message,
   which is a real outcome and is not a zero.

Which characteristic gets chosen is not "the first one that answers". `GattTree.readingCandidates`
excludes the infrastructure services and the known decoys first — battery level above all, a
uint8 between 0 and 100 that decodes cleanly, passes plausibility, and is not a measurement.

A reading from rungs 1 and 2 is still `measured`: it genuinely came from a paired device without
passing through a human. The prefix records how much is known about *how* it was decoded, which
is a different question and one the record should not blur.

Rung 2 is the slot **Wright** fills properly: enumerate the GATT tree, read the public spec,
infer the encoding, emit a real driver, compile it, run it against the live device, retry on
failure. See `specs/2026-08-19-wright-design.md`.
