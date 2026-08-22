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
  /** Google's per-app-install stable identifier, when it gave one. Never invented. */
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
  const named = payload.appIntegrity?.packageName;
  if (named && named !== packageName) {
    return { verdict: "UNATTESTED", deviceId: null,
             detail: `The token was issued for ${named}, not ${packageName}.` };
  }

  const device: string[] = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  const deviceId: string | null =
    payload.accountDetails?.appLicensingVerdict === "LICENSED"
      ? (payload.requestDetails?.requestHash ?? null)
      : (payload.requestDetails?.requestHash ?? null);

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
