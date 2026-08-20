// firestore.rules, executed rather than asserted.
//
// docs/data-model.md §7 makes a security claim — a Workspace domain is an enterprise, a
// consumer account is a tenant of one, and neither can see the other. This file is that
// claim as a test, run against the real rules engine in the Firestore emulator.
//
// It also does something the rules alone cannot: `tenantOf()` exists TWICE, once in
// firestore.rules and once as tenantFromClaims() in web/src/auth/tenant.ts, because the
// server holds Admin credentials that bypass rules and has to reach the same answer
// independently. A divergence between the two is a tenancy hole that neither file's own
// tests would catch, so the same table of claims is pushed through both and compared.
//
//   node --experimental-strip-types --test web/scripts/rules.test.mjs
//
// Requires the emulator; scripts/smoke.sh starts it and skips this step if it cannot.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, setDoc, collection } from "firebase/firestore";
import { tenantFromClaims } from "../src/auth/tenant.ts";

const RULES = new URL("../../firestore.rules", import.meta.url);

/**
 * The three shapes of identity the product recognises, and the tenant each must produce.
 *
 * `hd` is a custom claim here for the same reason it is one in production: Firebase does not
 * propagate Google's hosted domain into its own ID token, so the server writes it after
 * verifying Google's token separately. See web/src/auth/google-hd.ts.
 */
const IDENTITIES = [
  {
    name: "a Workspace account is its employer's enterprise",
    uid: "tech-1",
    token: { hd: "acme.com", firebase: { sign_in_provider: "google.com" } },
    tenant: "acme.com",
  },
  {
    name: "a second Workspace account at the same domain joins the same tenant",
    uid: "tech-2",
    token: { hd: "acme.com", firebase: { sign_in_provider: "google.com" } },
    tenant: "acme.com",
  },
  {
    name: "a rival Workspace domain is a different enterprise",
    uid: "rival-1",
    token: { hd: "beta.com", firebase: { sign_in_provider: "google.com" } },
    tenant: "beta.com",
  },
  {
    name: "a consumer account is a tenant of one",
    uid: "solo-1",
    token: { firebase: { sign_in_provider: "google.com" } },
    tenant: "u:solo-1",
  },
  {
    name: "an unclaimed visitor is a tenant of one that has not been claimed",
    uid: "visitor-1",
    token: { firebase: { sign_in_provider: "anonymous" } },
    tenant: "anon:visitor-1",
  },
];

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "warrant-rules-test",
    firestore: {
      rules: readFileSync(RULES, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  await env?.cleanup();
});

const asUser = (identity) => env.authenticatedContext(identity.uid, identity.token).firestore();

describe("tenantOf() agrees on both sides of the seam", () => {
  for (const identity of IDENTITIES) {
    test(`${identity.name} — TypeScript`, () => {
      const resolved = tenantFromClaims({
        uid: identity.uid,
        hd: identity.token.hd ?? null,
        sign_in_provider: identity.token.firebase.sign_in_provider,
      });
      assert.equal(
        resolved.id,
        identity.tenant,
        "tenantFromClaims disagrees with the tenant firestore.rules grants below",
      );
    });
  }
});

describe("a tenant reaches its own data", () => {
  for (const identity of IDENTITIES) {
    test(identity.name, async () => {
      const db = asUser(identity);
      const job = doc(db, "tenants", identity.tenant, "jobs", "job-1");
      await assertSucceeds(setDoc(job, { status: "open" }));
      await assertSucceeds(getDoc(job));

      // Depth is not a loophole. The recursive wildcard has to hold all the way down, or a
      // capture nested under a job would be reachable when the job is not.
      const capture = doc(db, "tenants", identity.tenant, "jobs", "job-1", "captures", "cap-1");
      await assertSucceeds(setDoc(capture, { kind: "photo" }));
      await assertSucceeds(getDoc(capture));
    });
  }
});

describe("a tenant reaches nobody else's data", () => {
  for (const identity of IDENTITIES) {
    for (const other of IDENTITIES) {
      if (other.tenant === identity.tenant) continue;
      test(`${identity.tenant} cannot touch ${other.tenant}`, async () => {
        const db = asUser(identity);
        await assertFails(getDoc(doc(db, "tenants", other.tenant, "jobs", "job-1")));
        await assertFails(setDoc(doc(db, "tenants", other.tenant, "jobs", "job-2"), { status: "open" }));
        await assertFails(
          getDoc(doc(db, "tenants", other.tenant, "jobs", "job-1", "captures", "cap-1")),
        );
      });
    }
  }
});

describe("the catalogue is published, not owned", () => {
  test("any signed-in user may read type space", async () => {
    const db = asUser(IDENTITIES[0]);
    for (const name of ["spec_nodes", "spec_values", "spec_docs", "spec_chunks"]) {
      await assertSucceeds(getDoc(doc(db, name, "anything")));
    }
  });

  test("nobody may write type space, however they signed in", async () => {
    for (const identity of IDENTITIES) {
      const db = asUser(identity);
      for (const name of ["spec_nodes", "spec_values", "spec_docs", "spec_chunks"]) {
        await assertFails(setDoc(doc(db, name, "poisoned"), { text: "torque to 900 Nm" }));
      }
    }
  });
});

describe("an enterprise cannot be seeded by an outsider", () => {
  test("a client may not create a tenant document", async () => {
    // Otherwise anyone could create `acme.com` before anyone at acme.com had signed in, and
    // be sitting inside the enterprise when they arrived.
    const db = asUser(IDENTITIES[3]);
    await assertFails(setDoc(doc(db, "tenants", "u:solo-1"), { kind: "workspace", hd: "acme.com" }));
  });
});

describe("signing out closes everything", () => {
  test("an unauthenticated caller reaches nothing at all", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "tenants", "acme.com", "jobs", "job-1")));
    await assertFails(getDoc(doc(db, "spec_nodes", "anything")));
    await assertFails(setDoc(doc(collection(db, "spec_docs")), { title: "x" }));
  });
});
