import "server-only";

// Play Integrity, verified where a client cannot reach it.
//
// `attestation_device_id` has shipped as the literal string "fixture-device" and
// `attestation_play_integrity` as null. The first is a claim about a device nobody checked;
// the second at least admitted it.
//
// The whole value of an attestation is that the party being checked cannot produce it. So the
// phone obtains an opaque token it cannot read or forge, and THIS code — server side, holding
// credentials the phone does not have — asks Google what the token says. firestore.rules
// already refuses attestation fields from any client, which is what makes that division real
// rather than a convention.
//
// ## What it can and cannot say
//
// A verdict of MEETS_DEVICE_INTEGRITY means Google recognises the device and the app as
// genuine and unmodified. It does NOT mean the photograph is honest — a genuine device in the
// hands of someone pointing it at the wrong machine still produces a genuine attestation. It
// raises the tier ceiling and nothing else, which is exactly what `Tier.ATTESTED` claims.

import { GoogleAuth } from "google-auth-library";

export type AttestationVerdict =
  /** Google recognises the device and this app. */
  | "MEETS_DEVICE_INTEGRITY"
  /** A real answer, and a negative one: emulator, rooted, or a modified build. */
  | "FAILED_DEVICE_INTEGRITY"
  /** No answer at all. The overwhelmingly common case off Google Play. */
  | "UNATTESTED";

export interface Attestation {
  verdict: AttestationVerdict;
  /**
   * Always null today, and deliberately so.
   *
   * Play Integrity's payload carries no stable per-install identifier. What it does carry is
   * `requestDetails.requestHash`, which this file used to report here and which the CLIENT
   * chooses — see `readPayload`. Kept on the interface because the capture document has the
   * field and a future nonce-bound flow would fill it honestly.
   */
  deviceId: string | null;
  detail: string;
}

const SCOPE = "https://www.googleapis.com/auth/playintegrity";

/**
 * Decode one integrity token.
 *
 * Every failure returns UNATTESTED with the reason. It NEVER returns a positive verdict it did
 * not receive, and it never falls back to a device id the client supplied — a client-supplied
 * device id is exactly the fabrication the tier ceiling exists to price.
 */
export async function verifyIntegrity(
  token: string | null,
  packageName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Attestation> {
  // NOTE, and it is a real limit rather than a defect being hidden: this verifies that Google
  // issued the token for this app and what it says about the device. It does NOT bind the token
  // to THIS capture, because that requires a server-issued nonce echoed back in `requestHash`,
  // and the phone has no round trip to collect one before it shoots. So a valid token can be
  // replayed across captures from the same install. That raises the tier ceiling on evidence it
  // did not accompany, and nothing more — it cannot make a photograph honest, which is the
  // point `Tier.ATTESTED` is careful to make. Issuing a nonce at step start would close it.

  if (!token) {
    return {
      verdict: "UNATTESTED",
      deviceId: null,
      // The honest common case: a sideloaded or emulator build cannot mint a token at all.
      detail: "The device offered no integrity token.",
    };
  }

  let accessToken: string | null = null;
  try {
    const client = await new GoogleAuth({ scopes: [SCOPE] }).getClient();
    const t = await client.getAccessToken();
    accessToken = typeof t === "string" ? t : (t?.token ?? null);
  } catch (error) {
    return { verdict: "UNATTESTED", deviceId: null,
             detail: `No credential with which to verify: ${String(error)}` };
  }

  let body: any;
  try {
    const response = await fetchImpl(
      `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}` +
        `:decodeIntegrityToken`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json",
                   Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ integrityToken: token }),
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { verdict: "UNATTESTED", deviceId: null,
               detail: `Play Integrity returned ${response.status}: ${text.slice(0, 200)}` };
    }
    body = await response.json();
  } catch (error) {
    return { verdict: "UNATTESTED", deviceId: null,
             detail: `Play Integrity was unreachable: ${String(error)}` };
  }

  return readPayload(body, packageName);
}

/** Exported for test. The payload is nested and the negative cases are the interesting ones. */
export function readPayload(body: unknown, packageName: string): Attestation {
  const payload = (body as any)?.tokenPayloadExternal;
  if (!payload) {
    return { verdict: "UNATTESTED", deviceId: null,
             detail: "Play Integrity returned no token payload." };
  }

  // The token is issued FOR a package. A token minted for another app is not evidence about
  // this one, however genuine it is.
  //
  // An ABSENT package name is refused too, and that is the change: `named && named !== ...`
  // accepted a payload that simply did not say which app it was for, which is the one shape a
  // forged or truncated payload is most likely to have. An attestation that cannot say what it
  // attests is not an attestation.
  const named = payload.appIntegrity?.packageName;
  if (named !== packageName) {
    return { verdict: "UNATTESTED", deviceId: null,
             detail: named
               ? `The token was issued for ${named}, not ${packageName}.`
               : "The token did not say which app it was issued for." };
  }

  const device: string[] = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];

  // WHAT A DEVICE ID IS, AND WHAT `requestHash` IS NOT.
  //
  // This field used to read `appLicensingVerdict === "LICENSED" ? requestHash : requestHash` —
  // a ternary whose branches are identical, which is a bug on its own, but the smaller one.
  // `requestDetails.requestHash` is a hash the CLIENT chooses and puts in the token request. So
  // `attestation_device_id` — the field the whole tier ceiling is priced on — was a value
  // supplied by the party being attested, which is precisely what the header of this file says
  // it never falls back to.
  //
  // Google's stable per-app-install identifier is `accountDetails.appLicensingVerdict`-gated
  // and does not appear in the standard payload at all; what does is
  // `deviceIntegrity.deviceAttributes`, and nothing in it is a stable id either. So there is no
  // device id to report, and the honest answer is to report none rather than to report the
  // client's own string. `Tier.ATTESTED` rests on the VERDICT, which Google does supply and the
  // client cannot forge — that is the part that was always doing the work.
  const deviceId: string | null = null;

  if (device.includes("MEETS_DEVICE_INTEGRITY")) {
    return { verdict: "MEETS_DEVICE_INTEGRITY", deviceId,
             detail: `Google recognises this device and app: ${device.join(", ")}.` };
  }

  if (device.length === 0) {
    // An explicit, meaningful negative: Google answered, and the answer is that it does not
    // recognise this device. That is NOT the same as not having asked.
    return { verdict: "FAILED_DEVICE_INTEGRITY", deviceId,
             detail: "Google returned no device recognition verdict for this device." };
  }

  return { verdict: "FAILED_DEVICE_INTEGRITY", deviceId,
           detail: `Device recognition returned ${device.join(", ")}.` };
}
