import "server-only";

// Recovering the `hd` claim, which is the whole tenancy model and does not arrive by itself.
//
// docs/architecture.md §7 says a Workspace domain is the enterprise, and docs/data-model.md
// §7 enforces that with `request.auth.token.hd`. But a Firebase ID token does NOT carry
// Google's `hd`: Firebase mints its own token containing sub, email, email_verified and
// firebase.identities, and drops the rest of the OIDC payload. Left alone, every Workspace
// user would silently resolve to a solo tenant and the enterprise model would never fire.
//
// So we take the second token. `signInWithPopup` also hands the browser Google's OWN ID
// token via GoogleAuthProvider.credentialFromResult(), and that one does carry `hd`. The
// server verifies it against Google's published certificates, checks it belongs to the same
// Google account as the Firebase user, and writes `hd` as a CUSTOM CLAIM — which Firebase
// does put in subsequent ID tokens, and which therefore appears at `request.auth.token.hd`
// exactly where the documented rules already look for it.
//
// Net effect: the rules in docs/data-model.md §7 stay true as written.
//
// ## WHAT THIS DOES NOT DO: revoke
//
// The custom claim is written at sign-in and then persists on the Firebase user record. It is
// re-derived on any later sign-in that supplies Google's token — so someone whose domain
// changes is corrected the next time they sign in properly — but nothing expires it on its
// own. Someone REMOVED from a Workspace domain therefore keeps `hd: acme.com`, and with it
// read access to the acme.com tenant, until something else ends their access.
//
// Two things do, and between them they are the offboarding story:
//
//   disabling the Firebase user   ends it the same instant, on both surfaces. The session
//                                 cookie path has always passed `checkRevoked`, and the bearer
//                                 path (the phone) now does too — it did not, which meant the
//                                 handset kept writing evidence after the browser had stopped.
//   the session cookie expiring   five days, after which a browser must sign in again and the
//                                 claim is re-derived from Google.
//
// What is NOT a control here is the claim ageing out by itself, and it is worth being plain
// about why rather than adding a half-measure. `tenantFromClaims` in tenant.ts is the same
// rule as `tenantOf()` in firestore.rules, held to one shared corpus by rules.test.mjs,
// because a divergence between them is a tenancy hole. Rules cannot read a timestamp on a
// custom claim, so an expiry added on the TypeScript side only would make the two disagree —
// trading a bounded staleness window for exactly the class of bug that test exists to catch.
// Removing a departed employee's Firebase account is the operation that ends access, and it
// is the one an administrator should be told to perform.

import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { normaliseHd } from "./tenant";

const client = new OAuth2Client();

export interface GoogleIdentity {
  /** Google's stable subject for this account. Cross-checked against the Firebase user. */
  sub: string;
  /** The hosted domain, already normalised. Null for consumer accounts. */
  hd: string | null;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Verify Google's own ID token and pull the hosted domain out of it.
 *
 * `audience` is checked when GOOGLE_OAUTH_CLIENT_ID is set. It is defence in depth rather
 * than the primary control: the primary control is the caller cross-checking `sub` against
 * the Firebase user's google.com identity, which means a token can only ever assert the
 * hosted domain of the account that actually signed in.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const audience = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const ticket = await client.verifyIdToken(
    audience ? { idToken, audience } : { idToken },
  );
  const payload: TokenPayload | undefined = ticket.getPayload();
  if (!payload?.sub) throw new Error("Google ID token carried no subject.");

  return {
    sub: payload.sub,
    hd: normaliseHd((payload as TokenPayload & { hd?: string }).hd),
    email: payload.email ?? null,
    emailVerified: Boolean(payload.email_verified),
  };
}

/**
 * The Google account behind a Firebase user, as recorded in the verified Firebase token.
 *
 * Returns null when the user has no linked Google identity — an anonymous visitor, for
 * instance, who is a legitimate tenant of one until they claim it.
 */
export function googleSubOf(identities: unknown): string | null {
  if (!identities || typeof identities !== "object") return null;
  const google = (identities as Record<string, unknown>)["google.com"];
  if (Array.isArray(google) && typeof google[0] === "string") return google[0];
  return null;
}
