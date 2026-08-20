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
