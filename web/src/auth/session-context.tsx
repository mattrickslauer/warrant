"use client";

// The browser's half of sign-in.
//
// Two tokens leave this file on every Google sign-in: Firebase's, which the server exchanges
// for a session cookie, and Google's own, which is the only place the `hd` claim exists. See
// auth/google-hd.ts for why the second one is necessary.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import {
  GoogleAuthProvider, linkWithPopup, onIdTokenChanged, signInAnonymously,
  signInWithCredential, signInWithPopup, signOut as fbSignOut, type User,
} from "firebase/auth";
import { clientAuth } from "./firebase-client";
import { authConfigured } from "./config";
import type { TenantRef } from "./tenant";

export interface SessionView {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  tenant: TenantRef;
  anonymous: boolean;
}

interface SessionState {
  session: SessionView | null;
  /** True until the first auth state has been observed. Screens should not flash on this. */
  loading: boolean;
  /** False when this build has no Firebase project — the fixture path. */
  configured: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  startAnonymously: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

async function postSession(body: unknown) {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export function SessionProvider({
  initial,
  children,
}: {
  initial: SessionView | null;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<SessionView | null>(initial);
  const [loading, setLoading] = useState(authConfigured);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  // Keep the React view in step with the SDK. This also covers the token refresh that
  // follows an hd claim being written, which is what makes the Workspace tenant appear.
  useEffect(() => {
    if (!authConfigured) return;
    return onIdTokenChanged(clientAuth(), async (user: User | null) => {
      setLoading(false);
      if (!user) {
        setSession(null);
        return;
      }
      const res = await fetch("/api/auth/session");
      const data = (await res.json().catch(() => ({}))) as { session?: SessionView | null };
      setSession(data.session ?? null);
    });
  }, []);

  /**
   * Establish the server session for the currently signed-in Firebase user.
   *
   * The 202 is the hd handshake: the server has just written the claim, and the token in the
   * browser predates it. Refreshing and re-posting is what puts `hd` into the token that
   * Firestore rules will see.
   */
  const establish = useCallback(async (user: User, googleIdToken?: string) => {
    let idToken = await user.getIdToken();
    let res = await postSession({ idToken, googleIdToken });

    if (res.status === 202 && res.body.needsRefresh) {
      idToken = await user.getIdToken(true);
      res = await postSession({ idToken, googleIdToken });
    }

    if (res.status >= 400) {
      throw new Error((res.body.error as string) ?? "Could not establish a session.");
    }
    setSession((res.body.session as SessionView) ?? null);
  }, []);

  const signIn = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const auth = clientAuth();
      const provider = new GoogleAuthProvider();
      const anon = auth.currentUser?.isAnonymous ? auth.currentUser : null;

      // --- The ordinary case ------------------------------------------------------------
      if (!anon) {
        const result = await signInWithPopup(auth, provider);
        const googleIdToken = GoogleAuthProvider.credentialFromResult(result)?.idToken ?? undefined;
        await establish(result.user, googleIdToken);
        return;
      }

      // --- Upgrading a visitor who has already done work --------------------------------
      //
      // linkWithPopup, NOT signInWithPopup: linking upgrades the anonymous user in place so
      // the uid survives, where signing in would swap in a different user and strand every
      // job the visitor had already completed.
      let user: User;
      let googleIdToken: string | undefined;
      try {
        const result = await linkWithPopup(anon, provider);
        googleIdToken = GoogleAuthProvider.credentialFromResult(result)?.idToken ?? undefined;
        user = result.user;
      } catch (e) {
        // The Google account already has a Firebase user of its own — a returning customer
        // who happened to arrive anonymously this time. Linking is impossible, so sign in as
        // the account that exists and merge the anonymous tenant into it instead. The claim
        // route authorises that on the anonymous session cookie, which only this browser has.
        const code = (e as { code?: string }).code;
        const credential = GoogleAuthProvider.credentialFromError(e as never);
        if (code !== "auth/credential-already-in-use" || !credential) throw e;
        const result = await signInWithCredential(auth, credential);
        googleIdToken = credential.idToken ?? undefined;
        user = result.user;
      }

      const idToken = await user.getIdToken(true);
      const res = await fetch("/api/auth/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken, googleIdToken }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not claim this session.");
      }
      await establish(user, googleIdToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }, [establish]);

  const startAnonymously = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const { user } = await signInAnonymously(clientAuth());
      await establish(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }, [establish]);

  const signOut = useCallback(async () => {
    setError(null);
    await fetch("/api/auth/session", { method: "DELETE" });
    if (authConfigured) await fbSignOut(clientAuth());
    setSession(null);
  }, []);

  const value = useMemo<SessionState>(
    () => ({ session, loading, configured: authConfigured, error, signIn, startAnonymously, signOut }),
    [session, loading, error, signIn, startAnonymously, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>.");
  return ctx;
}
