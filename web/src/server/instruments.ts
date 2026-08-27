import "server-only";

// What makes a number MEASURED rather than typed.
//
// This is the smallest, most load-bearing claim in the product: `classify()` in seal.ts
// promotes a field to `measured` when a `readings` document carries a `tool_id`, and
// `earnedTier()` promotes the whole record to `instrumented` on the same evidence. So the
// question "may this reading carry a tool_id" is the question "may this record claim a machine
// produced this number", and it is answered here.
//
// ## What it used to be, and why that was not an answer
//
// `/api/ingest/reading` authenticated with `x-warrant-tool-key`, a shared secret from
// `WARRANT_INSTRUMENT_KEYS`, and looked the tool_id up from it. Two things were wrong with
// that, and they compound:
//
//   1. NOTHING BOUND A DEVICE TO A TENANT. The route took the tenant out of the caller's own
//      `job_id`, checked only that the job existed, and wrote under Admin credentials — which
//      bypass firestore.rules. A Workspace tenant id is literally a domain name. So one leaked
//      key minted `measured` readings into ANY shop's job, and the comment claiming the tenant
//      "now comes from the job id" described a check that was never a check: the job id is the
//      caller's to choose.
//
//   2. THE SECRET WAS ON THE PHONE. The ESP32 (firmware/warrant_reference_instrument.ino) has
//      no pairing, no bonding and no signing — it broadcasts a plaintext float on a fixed UUID,
//      and anything can advertise the same name. The handset held the credential and vouched
//      for the number. So `measured` meant "an app holding a password said so", which is a
//      strictly weaker claim than "an instrument produced this" and was being recorded as the
//      stronger one.
//
// ## What it is now
//
// The two questions are separated, because they were never the same question:
//
//   MAY YOU WRITE HERE       the technician's own verified session, exactly like every other
//                            route in this system. The tenant comes from the session and never
//                            from the request, which is what closes (1) — structurally, rather
//                            than by remembering to check.
//
//   DID A MACHINE MEASURE IT the DEVICE's HMAC over its own raw bytes, which closes (2). The
//                            phone never holds this key. It relays a signed frame it cannot
//                            forge and cannot alter.
//
// The signature covers the RAW BYTES, and the server decodes the value from those bytes rather
// than believing the `value` the phone sent. That is the difference between a relay and a
// witness: there is no field on the wire the handset can change without invalidating the
// signature.
//
// An unsigned reading is not refused — it is recorded WITHOUT a tool_id, so it shows on the
// form and cannot confer `measured`. That is this codebase's standing posture (armor.ts: "an
// admitted gap beats a fabricated pass") applied to the class it matters most for. It also
// makes SimulatedReading's own comment true for the first time: it says a simulated value
// "still cannot seal as measured", and until now a `fake-` tool id was truthy and sealed
// exactly that way.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/** The domain separator. Signed by the firmware; changing it invalidates every device. */
export const READING_SIGNATURE_V1 = "warrant-reading-v1";

export interface RegisteredInstrument {
  toolId: string;
  tenantId: string;
  secret: string;
}

export interface SignedFrame {
  /** Strictly increasing per device. Replay protection — see `counterIsFresh`. */
  counter: number;
  /** The device's own bytes, hex. The value is decoded from THESE, never from the caller. */
  rawHex: string;
  /** HMAC-SHA256, hex. */
  signature: string;
}

/**
 * The devices this deployment knows about.
 *
 * `WARRANT_INSTRUMENT_KEYS` is `tenant|toolId|secret`, comma separated. THE TENANT IS FIRST AND
 * IT IS NOT OPTIONAL: a device belongs to a shop, and a registry that cannot say which shop is
 * the registry that let one key write into all of them.
 *
 * Pipe-separated rather than colon-separated, and that is not cosmetic — a tenant id is a
 * domain (`acme.com`) OR `u:<uid>` OR `anon:<uid>`, so a colon-delimited format is ambiguous
 * exactly where getting it wrong puts a device in the wrong tenant.
 *
 * The old single-key `WARRANT_INSTRUMENT_KEY` is deliberately NOT honoured any more. It named
 * no tenant, so there was no safe way to interpret it; keeping it working "for compatibility"
 * would keep the vulnerability working for compatibility. `parseRegistry` reports it instead.
 */
export function parseRegistry(env: NodeJS.ProcessEnv = process.env): {
  devices: RegisteredInstrument[];
  problems: string[];
} {
  const devices: RegisteredInstrument[] = [];
  const problems: string[] = [];

  for (const entry of (env.WARRANT_INSTRUMENT_KEYS ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("|");
    if (parts.length !== 3) {
      problems.push(
        `"${trimmed.slice(0, 24)}…" is not tenant|toolId|secret. A device must name its tenant.`,
      );
      continue;
    }
    const [tenantId, toolId, secret] = parts.map((p) => p.trim());
    if (!tenantId || !toolId || !secret) {
      problems.push(`"${trimmed.slice(0, 24)}…" has an empty tenant, tool id or secret.`);
      continue;
    }
    devices.push({ tenantId, toolId, secret });
  }

  if (env.WARRANT_INSTRUMENT_KEY) {
    problems.push(
      "WARRANT_INSTRUMENT_KEY is no longer honoured: it named no tenant, so one key could " +
        "mint readings into every tenant. Re-provision as WARRANT_INSTRUMENT_KEYS=" +
        "tenant|toolId|secret.",
    );
  }
  return { devices, problems };
}

/**
 * The device registered as `toolId` IN THIS TENANT, or null.
 *
 * Scoped by tenant rather than looked up globally and checked afterwards, so there is no
 * ordering in which the tenant check can be forgotten. Two shops may name a tool the same
 * thing; they are different devices and neither can speak for the other.
 */
export function findInstrument(
  tenantId: string,
  toolId: string,
  env: NodeJS.ProcessEnv = process.env,
): RegisteredInstrument | null {
  const { devices } = parseRegistry(env);
  return devices.find((d) => d.tenantId === tenantId && d.toolId === toolId) ?? null;
}

/**
 * What the device signs.
 *
 * The raw bytes, not a formatted number. A decimal string would make the signature depend on
 * how two languages happen to render a float — and a verification that fails on a rounding
 * difference gets switched off. Signing the bytes is exact, and it means the SERVER decodes the
 * value, so the relay cannot alter the number it is carrying.
 */
export function signingMessage(toolId: string, counter: number, raw: Uint8Array): Buffer {
  return Buffer.concat([
    Buffer.from(`${READING_SIGNATURE_V1}|${toolId}|${counter}|`, "utf8"),
    Buffer.from(raw),
  ]);
}

export function signReading(secret: string, toolId: string, counter: number, raw: Uint8Array): string {
  return createHmac("sha256", secret).update(signingMessage(toolId, counter, raw)).digest("hex");
}

/** Hex to bytes, or null. Rejects odd lengths and anything that is not hex. */
export function fromHex(hex: string): Uint8Array | null {
  if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/**
 * The reference wire format: 4 bytes, little-endian IEEE-754 float.
 *
 * The same encoding `Esp32ReferenceDriver` decodes and the firmware emits — see the contract
 * block at the top of firmware/warrant_reference_instrument.ino. A frame that is not four bytes
 * is not a reading, and guessing would produce a plausible number from nonsense.
 */
export function decodeReferenceValue(raw: Uint8Array): number | null {
  if (raw.length !== 4) return null;
  const value = Buffer.from(raw).readFloatLE(0);
  return Number.isFinite(value) ? value : null;
}

/**
 * Does this frame actually come from this device?
 *
 * Constant time, and both sides are hashed first so the compared buffers are the same length —
 * `timingSafeEqual` throws on a length mismatch, and that throw is itself an oracle. The same
 * shape the sweep secret and the old tool key already used; the reasoning has not changed, only
 * what is being compared.
 */
export function signatureMatches(
  secret: string,
  toolId: string,
  counter: number,
  raw: Uint8Array,
  presented: string,
): boolean {
  if (typeof presented !== "string" || presented.length === 0) return false;
  const expected = signReading(secret, toolId, counter, raw);
  return timingSafeEqual(
    createHash("sha256").update(presented).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

/**
 * A counter that has already been used is a replay.
 *
 * Without this, a signed frame is a bearer token for one number: anyone who observed it — and
 * BLE is broadcast — could re-submit "6.8 Nm, correctly signed" onto a different job for as
 * long as the device lived. The counter must STRICTLY increase, so each frame spends itself.
 *
 * Kept per device rather than per job, because the device is what the counter belongs to.
 */
export function counterIsFresh(last: number | null | undefined, presented: number): boolean {
  if (!Number.isInteger(presented) || presented < 0) return false;
  if (last === null || last === undefined) return true;
  return presented > last;
}

export type Identified =
  | { attested: true; toolId: string; value: number; counter: number }
  | { attested: false; why: string };

/**
 * WHICH REGISTERED DEVICE SIGNED THIS, if any. No I/O, so the whole decision is testable.
 *
 * The tool id is DERIVED FROM THE SECRET rather than read off the request, and that is the
 * property the whole endpoint rests on: a caller cannot name the instrument it wishes to be,
 * because naming is not what identifies it. Every device registered to this tenant is tried and
 * the one whose key verifies is the one that spoke. A shop has a handful of instruments, so the
 * cost is a handful of HMACs.
 *
 * It also means the handset never has to know the device's registered id — which it could not
 * know honestly anyway: the id it derives locally comes from the BLE address, and the id the
 * firmware signs with is a constant flashed into the board. Asking the phone to reconcile those
 * would be asking it to assert an identity again.
 *
 * Only devices in THIS TENANT are considered, so there is no ordering in which the tenant check
 * can be forgotten — a frame from another shop's instrument simply matches nothing here.
 */
export function identify(
  tenantId: string,
  frame: Partial<SignedFrame> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Identified {
  if (!frame || !frame.signature || !frame.rawHex || typeof frame.counter !== "number") {
    return { attested: false, why: "The reading arrived with no device signature." };
  }
  if (!Number.isInteger(frame.counter) || frame.counter < 0) {
    return { attested: false, why: "The signed frame did not carry a usable counter." };
  }
  const raw = fromHex(frame.rawHex);
  if (!raw) return { attested: false, why: "The signed frame was not readable." };

  const { devices } = parseRegistry(env);
  // Every candidate is compared even after a match, so the number of instruments a tenant has
  // registered does not leak through how long this took.
  let matched: RegisteredInstrument | null = null;
  for (const device of devices) {
    if (device.tenantId !== tenantId) continue;
    if (signatureMatches(device.secret, device.toolId, frame.counter, raw, frame.signature)) {
      matched = matched ?? device;
    }
  }
  if (!matched) {
    // One answer for "no such device" and "wrong signature" alike. A caller probing for which
    // instruments a tenant holds learns nothing from the difference.
    return { attested: false, why: "No paired instrument in this tenant signed this reading." };
  }

  const value = decodeReferenceValue(raw);
  if (value === null) {
    return { attested: false, why: "The signed frame did not carry a reading." };
  }
  return { attested: true, toolId: matched.toolId, value, counter: frame.counter };
}
