"use client";

// The browser's Firebase app, initialised once.
//
// This client stays signed in for the life of the tab, and that is load-bearing rather than
// incidental: the authenticated client is what carries a real ID token into Firestore, which
// is what makes firestore.rules the thing actually enforcing tenancy. A server-only session
// would leave those rules as decoration.

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { firebaseWebConfig } from "./config";

export function clientApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseWebConfig());
}

export function clientAuth(): Auth {
  return getAuth(clientApp());
}

export function clientDb(): Firestore {
  return getFirestore(clientApp());
}
