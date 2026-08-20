import "server-only";

// The Admin SDK app, initialised once per server process.
//
// Admin credentials BYPASS firestore.rules entirely. Every read and write made through this
// app therefore has to supply the tenant itself, and that tenant must come from a verified
// session — never from a request body, a query string, or a header. `requireTenant()` in
// session.ts is the only sanctioned source.

import { cert, getApp, getApps, initializeApp, applicationDefault, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const APP_NAME = "warrant-admin";

/** True when this process can reach Google — ADC on Cloud Run, or gcloud ADC locally. */
export function adminConfigured(): boolean {
  return Boolean(
    process.env.GCP_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  );
}

function projectId(): string {
  const id =
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!id) throw new Error("No project id — set GCP_PROJECT (or NEXT_PUBLIC_FIREBASE_PROJECT_ID).");
  return id;
}

export function adminApp(): App {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;

  // On Cloud Run the runtime service account is picked up with no configuration. Locally
  // this is whatever `gcloud auth application-default login` left behind. A key file is
  // supported but never required, and never committed.
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credential = keyJson ? cert(JSON.parse(keyJson)) : applicationDefault();

  return initializeApp({ credential, projectId: projectId() }, APP_NAME);
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}

export { getApp };
