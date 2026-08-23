import type { Metadata } from "next";
import Link from "next/link";
import { Wrap, Rule } from "@/components";
import { AppShell } from "../shell/AppShell";

// The instrument manual. Static, no client JS, no data — it is a document.
//
// DELIBERATELY UNLINKED except from the footer of /about. The product's argument does not
// depend on anyone reading this; it depends on the driver abstraction being real. This page is
// the receipt for that claim, for the one reader in a hundred who goes looking for it.
//
// Everything stated here is checked against the source it describes:
//   firmware/warrant_reference_instrument.ino    the sketch
//   firmware/platformio.ini                      the pinned toolchain
//   android/…/instrument/Drivers.kt              the three shipped drivers
//   android/…/instrument/GattTree.kt             the unit table, the decoys, the ranking
//   android/…/instrument/DeclaredFormatDriver.kt the declared- path
//   android/…/instrument/ScanFailure.kt          the connection-failure wording
// If one of those changes, this page is wrong until it is changed too.

export const metadata: Metadata = {
  title: "Warrant — the instrument manual",
  description:
    "The open-source ESP32 reference instrument: the wire contract, how to flash it, how to put your own sensor behind it, and how the client reads a device nobody wrote a driver for.",
};

const CONTENTS = [
  ["what", "What you are flashing"],
  ["contract", "The wire contract"],
  ["flash", "Flashing it"],
  ["sensor", "Putting your own sensor behind it"],
  ["declare", "Declaring your own unit"],
  ["rungs", "A device you cannot reflash"],
  ["refuses", "What the client refuses to do"],
  ["trouble", "When it does not work"],
  ["source", "Licence and source"],
] as const;

/** SIG unit codes the client can resolve. Mirrors `PresentationFormat.UNITS` in GattTree.kt. */
const UNITS: Array<[string, string, string]> = [
  ["0x2701", "m", "metre"],
  ["0x2702", "kg", "kilogram"],
  ["0x2703", "s", "second"],
  ["0x2704", "A", "ampere"],
  ["0x2705", "K", "kelvin"],
  ["0x2712", "m/s", "metre per second"],
  ["0x2713", "m/s²", "metre per second squared"],
  ["0x2722", "Hz", "hertz"],
  ["0x2723", "N", "newton"],
  ["0x2724", "Pa", "pascal"],
  ["0x2725", "J", "joule"],
  ["0x2726", "W", "watt"],
  ["0x2728", "V", "volt"],
  ["0x272F", "°C", "degree Celsius"],
  ["0x27AD", "%", "percentage"],
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="stack" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Code({ caption, children }: { caption?: string; children: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <pre className="manual__code">{children}</pre>
      {caption ? <p className="manual__caption">{caption}</p> : null}
    </div>
  );
}

function M({ children }: { children: React.ReactNode }) {
  return <span className="manual__inline">{children}</span>;
}

export default function FirmwareManual() {
  return (
    <AppShell tone="work" frame="app">

        <main className="page__body">
          <Wrap>
            <article className="manual stack stack--lg">

              <div className="stack">
                <p className="eyebrow">Open hardware · MIT</p>
                <h1 className="hero">The instrument is the cheap part.</h1>
                <p className="lede">
                  A value is <strong>measured</strong> when it reached the record from a paired
                  device without passing through a human. Nothing in that sentence says what the
                  device cost, who made it, or what it measures. This page is the whole of the
                  hardware side: a 112-line sketch, four lines of wire contract, and the three
                  ways the client will read a device that has never heard of us.
                </p>
              </div>

              <nav className="manual__toc" aria-label="Contents">
                {CONTENTS.map(([id, label]) => (
                  <a key={id} href={`#${id}`}>{label}</a>
                ))}
              </nav>

              <Rule />

              <Section id="what" title="What you are flashing">
                <p>
                  <M>firmware/warrant_reference_instrument.ino</M> turns any ESP32 dev module into
                  a BLE peripheral that notifies a 32-bit float twice a second. The Android client
                  recognises it, reads it, and drops the number into a <M>measurement</M> field on
                  a live form. No libraries beyond the ESP32 Arduino core.
                </p>
                <div className="manual__note">
                  <b>What it measures is irrelevant.</b>
                  <p>
                    The shipped sketch returns a sine sweep across 25–31, so you can watch the
                    client both pass and fail an acceptance rule of 26–30 Nm without anybody
                    faking a number. It is not a torque wrench and the record does not pretend it
                    is. It exists to prove the path end to end and to make the driver abstraction
                    concrete — replace one function and nothing above the driver changes. That
                    substitution is the entire argument.
                  </p>
                </div>
              </Section>

              <Rule />

              <Section id="contract" title="The wire contract">
                <p>
                  Four facts, and they must agree with{" "}
                  <M>Esp32ReferenceDriver</M> in the Android client. Change them in one place and
                  you must change them in the other — or change nothing and fall back to the
                  generic path, which reads the device but marks the reading as unvetted.
                </p>
                <div className="manual__tablewrap">
                  <table className="manual__table">
                    <thead>
                      <tr><th scope="col">Field</th><th scope="col">Value</th></tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Service UUID</td>
                        <td><code>6e1a0001-b5a3-f393-e0a9-e50e24dcca9e</code></td>
                      </tr>
                      <tr>
                        <td>Characteristic UUID</td>
                        <td><code>6e1a0002-b5a3-f393-e0a9-e50e24dcca9e</code> — read + notify</td>
                      </tr>
                      <tr>
                        <td>Payload</td>
                        <td><code>4 bytes</code>, little-endian IEEE-754 float</td>
                      </tr>
                      <tr>
                        <td>Device name</td>
                        <td><code>Warrant Ref 01</code> — the driver also matches the <code>Warrant</code> name prefix</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p>
                  The characteristic carries a <M>0x2902</M> CCCD descriptor. Without it a client
                  can subscribe and will simply never be notified, which looks exactly like dead
                  hardware.
                </p>
                <div className="manual__note">
                  <b>Endianness is the contract, not a client setting.</b>
                  <p>
                    If you port the sketch to a big-endian part, byte-swap in the firmware. The
                    client decodes little-endian because the wire format says little-endian.
                  </p>
                </div>
              </Section>

              <Rule />

              <Section id="flash" title="Flashing it">
                <h3>PlatformIO, no IDE</h3>
                <Code caption="First run downloads the toolchain, about two minutes. Monitor is 115200.">
{`cd firmware
pio run -t upload
pio device monitor`}
                </Code>
                <p>
                  <M>platformio.ini</M> pins <M>espressif32@~6.5.0</M> deliberately. That release
                  ships arduino-esp32 2.0.x, whose <M>BLEServerCallbacks::onDisconnect</M> takes
                  one parameter. Core 3.x added a second, and the sketch marks the override — so
                  an unpinned build fails to compile on a newer core rather than misbehaving
                  quietly.
                </p>

                <h3>Arduino IDE</h3>
                <p>
                  Board <strong>ESP32 Dev Module</strong>. Upload, then open the serial monitor at
                  115200. You should see it announce itself and then go quiet:
                </p>
                <Code>
{`Warrant reference instrument starting
advertising as Warrant Ref 01`}
                </Code>
                <p>
                  <M>loop()</M> only prints once a client is connected, so <strong>silence with
                  nothing paired is correct</strong> and is not a sign the board failed to start.
                  Pair from the app and the notifications begin.
                </p>
              </Section>

              <Rule />

              <Section id="sensor" title="Putting your own sensor behind it">
                <p>
                  One function. Everything above it — the driver, the form field, the acceptance
                  rule, the sealed record — is untouched.
                </p>
                <Code caption="firmware/warrant_reference_instrument.ino">
{`static float readSensor() {
  `}<i>{`// the shipped stand-in: a slow sweep across the acceptance band`}</i>{`
  static float t = 0.0f;
  t += 0.05f;
  return 28.0f + 3.0f * sinf(t);
}`}
                </Code>
                <Code caption="Any sensor, any bus. Return a float in the unit you intend to report.">
{`static float readSensor() {
  `}<b>{`return myLoadCell.getNewtonMetres();`}</b>{`
}`}
                </Code>
                <p>
                  Return whatever your sensor produces, as a float, in a unit you have decided on.
                  Do not average, clamp or smooth it into looking healthy — a reading that is out
                  of band is a real outcome and the product is built to show it as one.
                </p>
                <div className="manual__note">
                  <b>The unit does not travel on the wire.</b>
                  <p>
                    Four bytes of float carry no unit, so <M>Esp32ReferenceDriver</M> supplies one
                    — and it says <M>Nm</M>, because that is what the reference instrument claims.
                    Attach a thermometer without changing anything else and the record will read{" "}
                    <M>21.4 Nm</M>: measured, sealed, and wrong. You have two honest ways out.
                  </p>
                </div>
                <ol>
                  <li>
                    <strong>Edit the driver.</strong> Change <M>produces</M> in{" "}
                    <M>Drivers.kt</M> — unit, and the plausible min and max. Correct, one line,
                    and it means your build of the app is now specific to your instrument.
                  </li>
                  <li>
                    <strong>Let the device declare it.</strong> Add a presentation-format
                    descriptor and the client reads the unit off the hardware, with no per-vendor
                    code written on our side. This is the better answer and it is the next
                    section.
                  </li>
                </ol>
              </Section>

              <Rule />

              <Section id="declare" title="Declaring your own unit">
                <p>
                  The <M>0x2904</M> Characteristic Presentation Format descriptor is seven bytes
                  in which a device states its own width, its own scale and its own unit. Where it
                  is present, decoding is following a specification rather than inferring one, and
                  a reading from it is marked <M>declared-</M> instead of <M>unvetted-</M>.
                </p>
                <Code caption="arduino-esp32 2.0.x. Add this beside the BLE2902 already in setup().">
{`#include <BLE2904.h>

BLE2904* fmt = new BLE2904();
fmt->setFormat(BLE2904::FORMAT_FLOAT32);   `}<i>{`// 0x14 — 4 bytes, little-endian`}</i>{`
fmt->setExponent(0);                       `}<i>{`// value = wire × 10^exponent`}</i>{`
fmt->setUnit(0x272F);                      `}<i>{`// °C, from the SIG assigned numbers`}</i>{`
fmt->setNamespace(1);
fmt->setDescription(0);
characteristic->addDescriptor(fmt);`}
                </Code>
                <p>
                  The exponent is a signed base-10 scale, so a sint16 in hundredths declares{" "}
                  <M>FORMAT_SINT16</M> with an exponent of <M>-2</M> and sends whole integers on
                  the wire. Sign extension happens from the top of the declared <em>format</em>,
                  not the top of the byte width — a sint12 signs from bit 11, which is why the
                  client tracks both.
                </p>

                <h3>Units the client can resolve</h3>
                <p>
                  Fifteen codes, and the table is partial on purpose. A missing code surfaces as
                  null and stops the driver; a wrong code puts a confident, incorrect unit on a
                  sealed record, which is the exact failure this product exists to prevent.
                </p>
                <div className="manual__tablewrap">
                  <table className="manual__table manual__table--units">
                    <thead>
                      <tr>
                        <th scope="col">Code</th><th scope="col">Unit</th><th scope="col">Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {UNITS.map(([code, unit, name]) => (
                        <tr key={code}>
                          <td><code>{code}</code></td>
                          <td><span className="manual__val">{unit}</span></td>
                          <td>{name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="manual__note">
                  <b>Declare a code outside this table and the driver refuses to exist.</b>
                  <p>
                    A number with no unit is not a measurement and cannot be checked against an
                    acceptance rule, so the client falls back to the generic path and labels the
                    reading as a guess rather than inventing a unit. Torque is the case you will
                    hit first: the SIG has a code for newton metre and this table does not carry
                    it yet. Add codes to <M>PresentationFormat.UNITS</M> in <M>GattTree.kt</M>{" "}
                    against the published assigned-numbers list — never from memory.
                  </p>
                </div>
                <p>
                  <M>0x2700</M>, unitless, is absent rather than mapped to an empty string. A
                  characteristic that declares itself unitless is not carrying a measurement and
                  is treated exactly like an unknown code.
                </p>
                <p>
                  While you are adding descriptors, <M>0x2901</M> — the user description — costs
                  nothing and gives the pairing screen your own words for what the characteristic
                  is. It is free context and almost every device omits it.
                </p>
              </Section>

              <Rule />

              <Section id="rungs" title="A device you cannot reflash">
                <p>
                  You do not have to run our firmware at all. Point the client at an unfamiliar
                  BLE device and it works down three rungs, in this order, and records which one
                  it landed on. Below them is a fourth outcome, which is not a reading at all.
                </p>
                <div className="manual__rungs">
                  <div className="manual__rung">
                    <header>
                      <h3>A driver we wrote</h3>
                      <span className="manual__prefix">no prefix — vetted</span>
                    </header>
                    <p>
                      The reference instrument, or the Bluetooth SIG Environmental Sensing service
                      that any conforming sensor exposes — sint16 in hundredths of a degree,
                      specified by the profile rather than guessed. Someone checked the encoding
                      against firmware or a published spec by hand.
                    </p>
                  </div>
                  <div className="manual__rung">
                    <header>
                      <h3>The device declared its encoding</h3>
                      <span className="manual__prefix">declared-</span>
                    </header>
                    <p>
                      A <M>0x2904</M> descriptor stated the width, scale and unit, and the client
                      followed that specification. Nothing was inferred and no per-vendor code was
                      written. This is the rung the previous section puts you on.
                    </p>
                  </div>
                  <div className="manual__rung">
                    <header>
                      <h3>Nobody knows, so it says so</h3>
                      <span className="manual__prefix">unvetted-</span>
                    </header>
                    <p>
                      No usable descriptor. The client decodes as a little-endian float or sint16.
                      That is a guess, and the tool id on the record says it is a guess.
                    </p>
                  </div>
                  <div className="manual__rung">
                    <header>
                      <h3>Nothing on the device could carry a reading</h3>
                      <span className="manual__prefix">no reading</span>
                    </header>
                    <p>
                      The connection fails with that message. That is a real outcome and it is not
                      a zero.
                    </p>
                  </div>
                </div>
                <div className="manual__note">
                  <b>Every rung above the last is still a measured value.</b>
                  <p>
                    The reading genuinely came from a paired device without passing through a
                    human, which is the property that decides the class. The prefix records how
                    much is known about <em>how it was decoded</em> — a different question, and one
                    the record is not allowed to blur into the first.
                  </p>
                </div>
              </Section>

              <Rule />

              <Section id="refuses" title="What the client refuses to do">
                <p>
                  Which characteristic gets read is not &ldquo;the first one that answers&rdquo;.
                  Before anything is decoded the client throws candidates away:
                </p>
                <ul>
                  <li>
                    <strong>Infrastructure services</strong> — generic access and attribute,
                    device information, battery, transmit power, current time, DST, reference
                    time. They describe the device; they do not measure anything.
                  </li>
                  <li>
                    <strong>Known decoys.</strong> Battery level above all: a <M>uint8</M> of 87
                    decodes cleanly, passes any plausibility check, is enumerated before the
                    vendor characteristic on a great many devices, and is not a measurement. The
                    clock characteristics are on the list too — they decode cleanly{" "}
                    <em>and</em> change constantly, so they survive a naive does-it-move test as
                    well, and were caught ranking as candidates against a real device.
                  </li>
                  <li>
                    <strong>Anything neither readable nor subscribable.</strong>
                  </li>
                </ul>
                <p>
                  What survives is ranked with a declared encoding ahead of one that must be
                  inferred. Then, on connect, every characteristic on the device is written to the
                  log with the verdict on each — not what was chosen, but why the rest lost:
                </p>
                <Code caption="GattTree.explain(), written on every connect.">
{`6e1a0001/6e1a0002 [notify+read] declared=float32e0 °C - CHOSEN
0000180f/00002a19 [read] - skipped, known decoy and never a reading
0000180a/00002a29 [read] - skipped, infrastructure service
0000fff0/0000fff3 [write] - skipped, neither readable nor subscribable
0000fff0/0000fff1 [read] - candidate, outranked`}
                </Code>
                <p>
                  At a bench with a phone and an unfamiliar device, a chosen characteristic with
                  no account of the alternatives is the point at which you start guessing. Nothing
                  is allowed to drop out of that list silently.
                </p>
                <p>The decode itself refuses in four more places:</p>
                <ul>
                  <li>
                    A frame narrower than the declared format returns nothing. Decoding four bytes
                    as a sint32 when three arrived means inventing the fourth, and the result is
                    indistinguishable from a real number.
                  </li>
                  <li>
                    A value outside what the wire format can express is out of range and flagged.
                  </li>
                  <li>
                    A garbage frame read as a float arrives as NaN or an infinity. It renders as{" "}
                    <M>invalid</M>, never as <M>Infinity Nm</M> inside a green measured badge.
                  </li>
                  <li>
                    Readings are written to two decimal places. A 32-bit float widens to{" "}
                    <M>26.606204986572266</M> — seventeen significant digits from a sensor with
                    nothing like that resolution. A number carries an implicit claim about how
                    precisely it was measured.
                  </li>
                </ul>
              </Section>

              <Rule />

              <Section id="trouble" title="When it does not work">
                <div className="manual__tablewrap">
                  <table className="manual__table">
                    <thead>
                      <tr><th scope="col">Symptom</th><th scope="col">Cause</th></tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Serial monitor goes quiet after boot</td>
                        <td>Correct. <code>loop()</code> only prints once a client is connected.</td>
                      </tr>
                      <tr>
                        <td>Device vanishes after the first disconnect</td>
                        <td>
                          Advertising was not restarted. The shipped sketch calls{" "}
                          <code>startAdvertising()</code> from <code>onDisconnect</code> for
                          exactly this reason — it reads as dead hardware and costs an hour every
                          time.
                        </td>
                      </tr>
                      <tr>
                        <td>Client subscribes, no notifications ever arrive</td>
                        <td>The <code>BLE2902</code> CCCD descriptor is missing.</td>
                      </tr>
                      <tr>
                        <td><code>status 133</code> on connect</td>
                        <td>
                          Android&rsquo;s generic Bluetooth error and by a distance the most common
                          BLE failure on the platform. Usually transient — try again, and wake the
                          device first if it sleeps.
                        </td>
                      </tr>
                      <tr>
                        <td><code>status 8</code></td>
                        <td>Out of range, or the device slept before the connection finished.</td>
                      </tr>
                      <tr>
                        <td><code>status 19</code> / <code>status 22</code></td>
                        <td>The device ended the connection, or this phone did.</td>
                      </tr>
                      <tr>
                        <td>Build fails on <code>onDisconnect</code></td>
                        <td>
                          An unpinned ESP32 core. 3.x added a second parameter and the sketch marks
                          the override — see <code>platformio.ini</code>.
                        </td>
                      </tr>
                      <tr>
                        <td>The reading is a battery percentage</td>
                        <td>
                          It should not be — battery level is on the decoy list. If it happens,
                          read the <code>explain()</code> log and open an issue with it.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p>
                  Stopping is not failing. Tapping a device to connect cancels the scan, which is
                  the whole point of tapping, and so does leaving the screen. Neither is reported
                  as a fault.
                </p>
              </Section>

              <Rule />

              <Section id="source" title="Licence and source">
                <p>
                  MIT. The firmware is three files — the sketch, a <M>platformio.ini</M> and a
                  README — and the client-side drivers it talks to are another six. Take any of it.
                </p>
                <Code>
{`git clone https://github.com/mattrickslauer/warrant
cd warrant/firmware`}
                </Code>
                <p>
                  Rung three is the interesting unfinished work: enumerate the GATT tree, read the
                  public spec for the service, infer the encoding, emit a real driver, compile it,
                  run it against the live device, retry on failure. That is what Wright is for, and{" "}
                  <Link href="/about">the About page</Link> says where it has got to.
                </p>
                <div className="w-step__exits">
                  <Link className="w-btn" href="/">Try a task</Link>
                  <Link className="w-btn w-btn--ghost" href="/about">What this is for</Link>
                </div>
              </Section>

            </article>
          </Wrap>
        </main>

        <footer className="w-wrap footer">
          <span>Warrant</span>
          <span>Firmware and drivers are MIT licensed</span>
        </footer>
    </AppShell>
  );
}
