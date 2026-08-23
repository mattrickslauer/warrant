// The Play Integrity payload, pinned — and the negative paths especially.
//
// The rule under test is one sentence: this code never reports an attestation it did not
// receive. A fabricated MEETS_DEVICE_INTEGRITY would raise the tier ceiling on a record and
// be indistinguishable, forever, from one that earned it.
//
//   cd web && node --experimental-strip-types --conditions=react-server \
//     --import ./scripts/ts-resolve.mjs --test scripts/attest.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readPayload, verifyIntegrity } from "../src/server/adjudicate/attest.ts";

const PKG = "ink.warrant";

const GENUINE = {
  tokenPayloadExternal: {
    appIntegrity: { packageName: PKG, appRecognitionVerdict: "PLAY_RECOGNIZED" },
    deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY",
                                                  "MEETS_BASIC_INTEGRITY"] },
    requestDetails: { requestHash: "abc123" },
    accountDetails: { appLicensingVerdict: "LICENSED" },
  },
};

describe("readPayload", () => {
  test("a genuine device attests", () => {
    const a = readPayload(GENUINE, PKG);
    assert.equal(a.verdict, "MEETS_DEVICE_INTEGRITY");
  });

  // THIS TEST USED TO ASSERT THE BUG.
  //
  // It expected `deviceId === "abc123"`, which is the `requestDetails.requestHash` in the
  // fixture above — and a requestHash is a string the CLIENT puts in its own token request.
  // So the field the tier ceiling is priced on was being filled from the party being attested,
  // which is the exact fabrication attest.ts's own header says it never falls back to. (The
  // line producing it was `licensed ? requestHash : requestHash`, identical in both branches,
  // which is how it survived review.)
  //
  // Google's payload carries no stable per-install identifier, so there is nothing honest to
  // put here. Null is the answer, and the VERDICT — which Google supplies and a client cannot
  // forge — is what `Tier.ATTESTED` actually rests on.
  test("no device id is invented from something the client chose", () => {
    const a = readPayload(GENUINE, PKG);
    assert.equal(a.deviceId, null,
      "requestHash is client-supplied and must never be reported as a device identity");
  });

  test("a token that will not say which app it is for is not an attestation", () => {
    const anonymous = structuredClone(GENUINE);
    delete anonymous.tokenPayloadExternal.appIntegrity.packageName;
    const a = readPayload(anonymous, PKG);
    assert.equal(a.verdict, "UNATTESTED",
      "an absent package name is the shape a truncated or forged payload has");
  });

  test("an unrecognised device FAILS rather than going quiet", () => {
    const rooted = structuredClone(GENUINE);
    rooted.tokenPayloadExternal.deviceIntegrity.deviceRecognitionVerdict = [];
    const a = readPayload(rooted, PKG);
    assert.equal(a.verdict, "FAILED_DEVICE_INTEGRITY",
      "Google answering 'no' is not the same as not having asked");
  });

  test("basic integrity alone does not meet device integrity", () => {
    const weak = structuredClone(GENUINE);
    weak.tokenPayloadExternal.deviceIntegrity.deviceRecognitionVerdict =
      ["MEETS_BASIC_INTEGRITY"];
    assert.equal(readPayload(weak, PKG).verdict, "FAILED_DEVICE_INTEGRITY");
  });

  test("a token minted for another app is not evidence about this one", () => {
    const other = structuredClone(GENUINE);
    other.tokenPayloadExternal.appIntegrity.packageName = "com.someone.else";
    const a = readPayload(other, PKG);
    assert.equal(a.verdict, "UNATTESTED");
    assert.match(a.detail, /com\.someone\.else/);
  });

  test("an empty payload is UNATTESTED, never attested", () => {
    assert.equal(readPayload({}, PKG).verdict, "UNATTESTED");
    assert.equal(readPayload(null, PKG).verdict, "UNATTESTED");
  });

  test("no device id is ever invented", () => {
    const noHash = structuredClone(GENUINE);
    delete noHash.tokenPayloadExternal.requestDetails;
    assert.equal(readPayload(noHash, PKG).deviceId, null);
  });
});

describe("verifyIntegrity", () => {
  test("no token is UNATTESTED and says why", async () => {
    const a = await verifyIntegrity(null, PKG);
    assert.equal(a.verdict, "UNATTESTED");
    assert.match(a.detail, /no integrity token/i);
  });

  test("an API failure is UNATTESTED, never a pass", async () => {
    const a = await verifyIntegrity("tok", PKG, async () => ({
      ok: false, status: 403, text: async () => "denied", json: async () => ({}),
    }));
    assert.equal(a.verdict, "UNATTESTED");
    assert.match(a.detail, /403/);
  });
});
