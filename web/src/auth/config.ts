// The Firebase web config. Public by design — these values ship to every browser, and the
// API key is an identifier rather than a secret. What protects the data is firestore.rules,
// not the obscurity of this object.
//
// Read from NEXT_PUBLIC_* so the values are inlined at build time, which is what lets the
// client bundle initialise without a round trip.

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const RAW: FirebaseWebConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

/**
 * Whether this build has a Firebase project behind it at all.
 *
 * The whole product runs against FixtureSource with no cloud account, so an absent config is
 * an ordinary state rather than an error. Every auth surface checks this and renders the
 * fixture path instead of throwing.
 */
export const authConfigured: boolean = Boolean(RAW.apiKey && RAW.projectId && RAW.appId);

export function firebaseWebConfig(): FirebaseWebConfig {
  if (!authConfigured) {
    throw new Error(
      "Firebase web config missing. Set NEXT_PUBLIC_FIREBASE_* in .env — see .env.example. " +
        "Sign-in is optional: without it the surfaces run on FixtureSource.",
    );
  }
  return RAW;
}
