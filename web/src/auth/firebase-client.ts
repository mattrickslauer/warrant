"use client";

// The browser's Firebase app, initialised once.
//
// This client stays signed in for the life of the tab, and that is load-bearing rather than
// incidental: the authenticated client is what carries a real ID token into Firestore, which
// is what makes firestore.rules the thing actually enforcing tenancy. A server-only session
// would leave those rules as decoration.

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { firebaseWebConfig } from "./config";

export function clientApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseWebConfig());
}

export function clientAuth(): Auth {
  return getAuth(clientApp());
}

let db: Firestore | null = null;

/**
 * The browser's Firestore, with the local cache switched on.
 *
 * A workshop is a basement with no signal. Persistent local caching means a draft job is
 * performed against the cache and syncs opportunistically, rather than a technician with
 * dirty hands watching a spinner. `persistentMultipleTabManager` is what makes that safe with
 * the job screen open in two tabs — the default single-tab manager throws in the second one.
 *
 * What this deliberately does NOT mean is that the evidence is held back. The cache is a
 * cache, not a vault: bytes reach Firestore as soon as there is signal. The gate that matters
 * is `status: "draft"`, which no agent runs on until a human finalises the job. "Nothing was
 * sent until I said so" would be untrue; "no agent ran and nothing was sealed until I said
 * so" is the claim, and it is the one that carries weight.
 *
 * `initializeFirestore` must run before any `getFirestore`, so every caller comes through here.
 */
export function clientDb(): Firestore {
  if (db) return db;
  const app = clientApp();
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Already initialised by an earlier call, or IndexedDB is unavailable — a private window,
    // an embedded webview, a browser with storage disabled. Falling back to the memory cache
    // costs offline drafts and nothing else, which beats refusing to load.
    db = getFirestore(app);
  }
  return db;
}
