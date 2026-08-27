// What may call itself MEASURED.
//
// `classify()` promotes a field to `measured` when a reading carries a `tool_id`, and
// `earnedTier()` promotes the record to `instrumented` on the same evidence. So every test here
// is really asking the same question: can something that is not an instrument in THIS tenant
// cause a tool_id to be written?

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseRegistry, findInstrument, signReading, signatureMatches, counterIsFresh,
  decodeReferenceValue, fromHex, identify,
} from "../src/server/instruments.ts";

/** The reference wire format: 4 bytes, little-endian float32. */
function frameBytes(value) {
  const b = Buffer.alloc(4);
  b.writeFloatLE(value, 0);
  return new Uint8Array(b);
}
const hex = (u8) => Buffer.from(u8).toString("hex");

const ENV = { WARRANT_INSTRUMENT_KEYS: "acme.com|torque-01|s3cr3t,other.com|torque-01|different" };

describe("the registry", () => {
  test("a device belongs to exactly one tenant", () => {
    const { devices, problems } = parseRegistry(ENV);
    assert.equal(problems.length, 0);
    assert.deepEqual(devices.map((d) => [d.tenantId, d.toolId]),
                     [["acme.com", "torque-01"], ["other.com", "torque-01"]]);
  });

  // THE BUG THIS FILE EXISTS FOR. Two shops may name a tool the same thing; they are different
  // devices and neither may speak for the other.
  test("the same tool id in two tenants is two different secrets", () => {
    assert.equal(findInstrument("acme.com", "torque-01", ENV).secret, "s3cr3t");
    assert.equal(findInstrument("other.com", "torque-01", ENV).secret, "different");
  });

  test("a device is invisible from a tenant it is not registered in", () => {
    assert.equal(findInstrument("evil.com", "torque-01", ENV), null);
  });

  // The old format named no tenant, which is why one key could write into every tenant. It is
  // refused rather than reinterpreted — a compatibility shim here is a compatibility shim for
  // the vulnerability.
  test("the old tenant-less key is refused, loudly", () => {
    const { devices, problems } = parseRegistry({ WARRANT_INSTRUMENT_KEY: "legacy" });
    assert.equal(devices.length, 0);
    assert.match(problems.join(" "), /no longer honoured/);
  });

  test("a malformed entry is reported rather than silently skipped", () => {
    const { devices, problems } = parseRegistry({ WARRANT_INSTRUMENT_KEYS: "torque-01|s3cr3t" });
    assert.equal(devices.length, 0);
    assert.match(problems.join(" "), /must name its tenant/);
  });
});

describe("the signature", () => {
  test("a frame the device signed verifies", () => {
    const raw = frameBytes(7.5);
    const sig = signReading("s3cr3t", "torque-01", 1, raw);
    assert.ok(signatureMatches("s3cr3t", "torque-01", 1, raw, sig));
  });

  test("a frame signed with another tenant's secret does not", () => {
    const raw = frameBytes(7.5);
    const sig = signReading("different", "torque-01", 1, raw);
    assert.equal(signatureMatches("s3cr3t", "torque-01", 1, raw, sig), false);
  });

  // The relay must not be able to carry one number and report another. Because the value is
  // decoded from the signed bytes, altering it is altering the signed material.
  test("changing the value invalidates the signature", () => {
    const sig = signReading("s3cr3t", "torque-01", 1, frameBytes(7.5));
    assert.equal(signatureMatches("s3cr3t", "torque-01", 1, frameBytes(9.9), sig), false);
  });

  test("a device cannot speak as another device", () => {
    const raw = frameBytes(7.5);
    const sig = signReading("s3cr3t", "torque-01", 1, raw);
    assert.equal(signatureMatches("s3cr3t", "torque-02", 1, raw, sig), false);
  });

  test("the counter is signed too, so a frame cannot be renumbered", () => {
    const raw = frameBytes(7.5);
    const sig = signReading("s3cr3t", "torque-01", 1, raw);
    assert.equal(signatureMatches("s3cr3t", "torque-01", 2, raw, sig), false);
  });

  test("an empty or junk signature is refused rather than throwing", () => {
    const raw = frameBytes(7.5);
    assert.equal(signatureMatches("s3cr3t", "torque-01", 1, raw, ""), false);
    assert.equal(signatureMatches("s3cr3t", "torque-01", 1, raw, "zzzz"), false);
  });
});

describe("replay", () => {
  test("a counter must strictly increase", () => {
    assert.ok(counterIsFresh(null, 0));
    assert.ok(counterIsFresh(4, 5));
    assert.equal(counterIsFresh(5, 5), false);
    assert.equal(counterIsFresh(5, 4), false);
  });
  test("a non-integer or negative counter is not a counter", () => {
    assert.equal(counterIsFresh(null, 1.5), false);
    assert.equal(counterIsFresh(null, -1), false);
  });
});

describe("the wire format", () => {
  test("four little-endian bytes decode to the value the firmware sent", () => {
    assert.ok(Math.abs(decodeReferenceValue(frameBytes(7.5)) - 7.5) < 1e-6);
  });
  // A driver that guesses here produces a plausible number from nonsense, which is the single
  // worst thing it could do.
  test("anything that is not four bytes is not a reading", () => {
    assert.equal(decodeReferenceValue(new Uint8Array([1, 2, 3])), null);
    assert.equal(decodeReferenceValue(new Uint8Array(8)), null);
  });
  test("hex that is not hex is refused", () => {
    assert.equal(fromHex("abc"), null);
    assert.equal(fromHex("zz"), null);
    assert.equal(fromHex(""), null);
  });
});

describe("identify — the whole decision", () => {
  const raw = frameBytes(7.5);
  const good = {
    counter: 3, rawHex: hex(raw),
    signature: signReading("s3cr3t", "torque-01", 3, raw),
  };

  // The tool id is DERIVED from whichever secret verifies, never named by the caller. The
  // handset could not name it honestly anyway: the id it derives locally comes from the BLE
  // address, and the id the firmware signs with is flashed into the board.
  test("a genuine frame identifies its device, and the value comes from the BYTES", () => {
    const out = identify("acme.com", good, ENV);
    assert.equal(out.attested, true);
    assert.equal(out.toolId, "torque-01");
    assert.ok(Math.abs(out.value - 7.5) < 1e-6);
    assert.equal(out.counter, 3);
  });

  // THE CROSS-TENANT HOLE, pinned. `other.com` registers a device with this very tool id and a
  // different secret; acme's frame must mean nothing there.
  test("acme's signed frame identifies nothing in another tenant", () => {
    assert.equal(identify("other.com", good, ENV).attested, false);
  });

  test("a tenant with no instruments at all identifies nothing", () => {
    assert.equal(identify("evil.com", good, ENV).attested, false);
  });

  // The unsigned case is the common one, and it must be a plain honest "no" rather than an
  // error: the number still reaches the form, it simply is not measured.
  test("no frame at all is an admitted gap, not a crash", () => {
    const out = identify("acme.com", undefined, ENV);
    assert.equal(out.attested, false);
    assert.match(out.why, /no device signature/);
  });

  test("a frame with a junk counter is refused", () => {
    assert.equal(identify("acme.com", { ...good, counter: -1 }, ENV).attested, false);
    assert.equal(identify("acme.com", { ...good, counter: 1.5 }, ENV).attested, false);
  });

  // A caller probing for which instruments a tenant holds must not learn it from the wording.
  test("an unknown device and a bad signature answer identically", () => {
    const forged = { ...good, signature: signReading("guess", "torque-01", 3, raw) };
    assert.equal(identify("acme.com", forged, ENV).why,
                 identify("evil.com", good, ENV).why);
  });

  test("a frame whose bytes are not a reading does not identify", () => {
    const eight = new Uint8Array(8);
    const sig = signReading("s3cr3t", "torque-01", 4, eight);
    const out = identify("acme.com", { counter: 4, rawHex: hex(eight), signature: sig }, ENV);
    assert.equal(out.attested, false);
    assert.match(out.why, /did not carry a reading/);
  });
});

// THE WIRE FORMAT, PINNED.
//
// The firmware signs in C and the server verifies in TypeScript, and nothing but this vector
// makes the two agree. A change to the domain separator, the field order, the delimiter or the
// byte encoding shows up here as a failing hex string rather than as a torque wrench whose
// readings silently stopped counting as measured.
//
// The C side is:
//   snprintf(prefix, "%s|%s|%u|", SIGNATURE_V1, TOOL_ID, counter);
//   hmac_update(prefix); hmac_update(raw, 4);
describe("the firmware and the server agree", () => {
  test("golden vector: 7.5 as tool warrant-ref-01 at counter 1", () => {
    const raw = frameBytes(7.5);
    assert.equal(hex(raw), "0000f040");
    assert.equal(
      signReading("change-me-before-flashing", "warrant-ref-01", 1, raw),
      "a20e0339c0a447354ef6a5064506b16521769fe42a4c645f8b10fc7918661a7c",
    );
  });
});
