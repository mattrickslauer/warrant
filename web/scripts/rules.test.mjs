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
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection } from "firebase/firestore";
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

// ---------------------------------------------------------------------------------------
// What a client may not write. Added 2026-08-20 with specs/2026-08-20-firestore-design.md.
//
// Firestore rules are OR'd and there is no deny, so the recursive grant under /tenants/{t}
// previously made EVERY document writable by every member at every depth — including sealed
// records the schema calls immutable, member roles that decide who may waive a step, and
// readings whose tool_id is the only thing separating a measured number from a typed one.
//
// These are the tests that keep that closed.

const PROTECTED = ["members", "records", "decisions", "readings", "procedure_versions"];

describe("server-written collections are readable but not writable", () => {
  const sam = IDENTITIES[0];

  for (const name of PROTECTED) {
    test(`a member cannot write ${name}`, async () => {
      const db = asUser(sam);
      await assertFails(setDoc(doc(db, "tenants", sam.tenant, name, "x1"), { forged: true }));
    });

    test(`a member CAN still read ${name}`, async () => {
      // Read stays broad on purpose: you must be able to see your colleagues' names and your
      // own sealed records. It is only writing them that requires a server.
      const db = asUser(sam);
      await assertSucceeds(getDoc(doc(db, "tenants", sam.tenant, name, "x1")));
    });
  }

  test("protection reaches every depth beneath a protected collection", async () => {
    const db = asUser(sam);
    await assertFails(setDoc(doc(db, "tenants", sam.tenant, "readings", "r1", "sub", "s1"), { a: 1 }));
  });

  test("an unprotected collection stays writable, at depth", async () => {
    const db = asUser(sam);
    await assertSucceeds(
      setDoc(doc(db, "tenants", sam.tenant, "jobs", "j1", "captures", "c1"), { kind: "photo" }),
    );
  });

  test("readings nested under components would NOT be protected — this is why they are flat", async () => {
    // A {document=**} wildcard binds only the FIRST segment, so this path binds `collection`
    // to "components" and escapes the protected list entirely. The assertion is deliberately
    // that the write SUCCEEDS: it documents the trap that forced the flat layout, and it
    // fails loudly if anyone reintroduces the nested path believing it is covered.
    const db = asUser(sam);
    await assertSucceeds(
      setDoc(doc(db, "tenants", sam.tenant, "components", "caliper-88213", "readings", "r1"),
        { key: "pad_thickness", value: 4.2 }),
    );
  });
});

describe("an interview draft is the shop's own, and only the shop's", () => {
  // The draft exists because a 22-minute Scoper interview was lost when the turn timed out.
  // It is written by the BROWSER — a server-side write would share fate with the request that
  // fails — so these are the rules that have to hold for that to be safe.
  const sam = IDENTITIES[0];
  const colleague = IDENTITIES[1];   // same Workspace domain, so the same tenant
  const rival = IDENTITIES[2];       // a different domain, so a different enterprise
  const draft = {
    shop: { trade: "Residential electrical" },
    conversation: [{ who: "shop", said: "This is a replacement." }],
    status: "open",
    updated_at: "2026-08-26T04:00:00.000Z",
  };

  test("a member may write their own interview draft", async () => {
    const db = asUser(sam);
    await assertSucceeds(
      setDoc(doc(db, "tenants", sam.tenant, "interview_drafts", "d1"), draft));
  });

  test("and may update it as the interview goes on", async () => {
    const db = asUser(sam);
    await assertSucceeds(setDoc(
      doc(db, "tenants", sam.tenant, "interview_drafts", "d1"),
      { ...draft, conversation: [...draft.conversation, { who: "shop", said: "20 inch-pounds." }] },
    ));
  });

  test("a colleague in the same shop CAN pick it up", async () => {
    // Deliberate, and worth stating rather than leaving to be discovered. The boundary in
    // this product is the TENANT, not the person: a procedure belongs to the shop, so a
    // half-written one does too. If the technician who started the interview is off shift,
    // the next one can finish it rather than start again — which is the whole complaint the
    // draft exists to answer.
    const db = asUser(colleague);
    await assertSucceeds(getDoc(doc(db, "tenants", sam.tenant, "interview_drafts", "d1")));
  });

  test("a rival enterprise cannot read it", async () => {
    // A half-finished procedure is commercially sensitive in exactly the way a finished one
    // is: it is how this shop does the job.
    const db = asUser(rival);
    await assertFails(getDoc(doc(db, "tenants", sam.tenant, "interview_drafts", "d1")));
  });

  test("a rival enterprise cannot write one into somebody else's shop", async () => {
    const db = asUser(rival);
    await assertFails(
      setDoc(doc(db, "tenants", sam.tenant, "interview_drafts", "d2"), draft));
  });

  test("a signed-out browser cannot touch it", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "tenants", sam.tenant, "interview_drafts", "d1")));
    await assertFails(
      setDoc(doc(db, "tenants", sam.tenant, "interview_drafts", "d3"), draft));
  });

  test("a draft may not call itself sealed", async () => {
    // clientMayNotClaim(). `interview-draft.ts` writes 'open' | 'published' | 'abandoned' and
    // never this word — the test is here so that stays true.
    const db = asUser(sam);
    await assertFails(setDoc(
      doc(db, "tenants", sam.tenant, "interview_drafts", "d4"), { ...draft, status: "sealed" }));
  });

  test("it is not deletable, which is why it is marked instead", async () => {
    // The client has no delete grant outside an unsealed job, so `closeDraft()` updates a
    // status rather than removing the document. This is the rule that forces that design.
    const db = asUser(sam);
    await assertFails(deleteDoc(doc(db, "tenants", sam.tenant, "interview_drafts", "d1")));
  });
});

describe("a client cannot assert the conclusion the system exists to reach", () => {
  const sam = IDENTITIES[0];

  test("provenance_class: measured is refused", async () => {
    const db = asUser(sam);
    await assertFails(
      setDoc(doc(db, "tenants", sam.tenant, "jobs", "j2"), { provenance_class: "measured" }),
    );
  });

  test("provenance_class: inferred is allowed", async () => {
    const db = asUser(sam);
    await assertSucceeds(
      setDoc(doc(db, "tenants", sam.tenant, "jobs", "j3"), { provenance_class: "inferred" }),
    );
  });

  test("capture_surface: app_instrument is refused", async () => {
    // A browser can pass any string it likes. An instrumented capture is written by
    // POST /api/ingest/reading under Admin credentials, never by a client.
    const db = asUser(sam);
    await assertFails(
      setDoc(doc(db, "tenants", sam.tenant, "jobs", "j4", "captures", "c2"),
        { capture_surface: "app_instrument" }),
    );
  });

  test("capture_surface: browser is allowed", async () => {
    const db = asUser(sam);
    await assertSucceeds(
      setDoc(doc(db, "tenants", sam.tenant, "jobs", "j4", "captures", "c3"),
        { capture_surface: "browser" }),
    );
  });

  test("a field carrying any tool_id is refused", async () => {
    // Only reachable because a Field is now its own document. Inside the old
    // steps[].fields[] array no rule could see it — rules cannot inspect array contents.
    const db = asUser(sam);
    await assertFails(
      setDoc(doc(db, "tenants", sam.tenant, "jobs", "j5", "fields", "s1__pad_torque"),
        { key: "pad_torque", value_number: 28, tool_id: "esp32-fabricated" }),
    );
  });

  test("a field with no tool_id is allowed", async () => {
    const db = asUser(sam);
    await assertSucceeds(
      setDoc(doc(db, "tenants", sam.tenant, "jobs", "j5", "fields", "s1__pad_photo"),
        { key: "pad_photo", media_ref: "cap1" }),
    );
  });

  test("status: sealed is refused", async () => {
    // The Seal is a server act. A client flipping a job to sealed would be the tick in the
    // box this product exists to abolish.
    const db = asUser(sam);
    await assertFails(setDoc(doc(db, "tenants", sam.tenant, "jobs", "j6"), { status: "sealed" }));
  });

  test("status: draft is allowed — the draft gate is a client act", async () => {
    const db = asUser(sam);
    await assertSucceeds(setDoc(doc(db, "tenants", sam.tenant, "jobs", "j7"), { status: "draft" }));
  });
});

describe("a published record is a capability URL", () => {
  test("anyone reads it, including a caller who never signed in", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "records", "pub-1"), { sealed_at: "2026-08-20T00:00:00Z" });
    });
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "records", "pub-1")));
  });

  test("nobody writes it, however they signed in", async () => {
    for (const identity of IDENTITIES) {
      await assertFails(setDoc(doc(asUser(identity), "records", "pub-2"), { forged: true }));
    }
    await assertFails(
      setDoc(doc(env.unauthenticatedContext().firestore(), "records", "pub-3"), { forged: true }),
    );
  });
});

describe("a public procedure is published to be found", () => {
  const seed = async (id) => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "public_procedures", id), {
        key: "yard-clean", title: "Yard Cleaning", version: 1, owner_label: "acme.com",
      });
    });
  };

  test("anyone reads one, including a caller who never signed in", async () => {
    await seed("pp-1");
    await assertSucceeds(
      getDoc(doc(env.unauthenticatedContext().firestore(), "public_procedures", "pp-1")));
  });

  // The deliberate difference from /records, and the reason both tests are here rather than
  // one. A record's public id is a capability and listing the collection would hand over every
  // record anyone ever shared. A procedure is published in order to be browsed, and the search
  // surface IS a listing of this collection — so `list` must be granted here and must stay
  // refused there. Asserting only one of the two would let the wrong one drift into the other.
  test("anyone LISTS them, which is what publishing one is for", async () => {
    await seed("pp-2");
    await assertSucceeds(
      getDocs(collection(env.unauthenticatedContext().firestore(), "public_procedures")));
  });

  test("a shared RECORD is still not listable, which is the opposite bargain", async () => {
    await assertFails(
      getDocs(collection(env.unauthenticatedContext().firestore(), "records")));
  });

  test("nobody writes one, however they signed in", async () => {
    for (const identity of IDENTITIES) {
      await assertFails(
        setDoc(doc(asUser(identity), "public_procedures", "pp-3"), { forged: true }));
    }
    await assertFails(
      setDoc(doc(env.unauthenticatedContext().firestore(), "public_procedures", "pp-4"),
             { forged: true }));
  });
});

describe("an OAuth refresh token is reachable by nobody", () => {
  test("not even by the user whose token it is", async () => {
    // The browser never needs it: calendar events are written server-side by the sweep.
    // This lives OUTSIDE /tenants/** because under the tenant, the recursive read would hand
    // it to every colleague.
    const sam = IDENTITIES[0];
    await assertFails(getDoc(doc(asUser(sam), "user_secrets", sam.uid)));
    await assertFails(setDoc(doc(asUser(sam), "user_secrets", sam.uid), { refresh_token: "x" }));
  });

  test("nor by an unauthenticated caller", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "user_secrets", "tech-1")));
  });
});

// ---------------------------------------------------------------------------------------
// The one destructive act a client gets, and where it stops.
//
// Until this rule existed no client could delete anything — not by decision but by accident:
// the recursive grant said `allow write`, `write` covers delete, and on a delete
// `request.resource` is null, so `clientMayNotClaim()` dereferenced null and errored. These
// tests exist because the replacement is a deliberate grant, and a deliberate grant is only
// as good as the line it draws.

describe("an unsealed job may be abandoned, a sealed one may not", () => {
  const sam = IDENTITIES[0];
  const path = (...rest) => ["tenants", sam.tenant, "jobs", ...rest];

  test("a member deletes their own job that never sealed", async () => {
    const db = asUser(sam);
    await assertSucceeds(setDoc(doc(db, ...path("abandon-1")), { status: "open" }));
    await assertSucceeds(deleteDoc(doc(db, ...path("abandon-1"))));
  });

  test("a HELD job is still an attempt, so it goes too", async () => {
    // Held is the status most likely to be sitting in the list forever. If this were refused
    // the feature would fail on the exact rows people want gone.
    const db = asUser(sam);
    await assertSucceeds(setDoc(doc(db, ...path("abandon-2")), { status: "held" }));
    await assertSucceeds(deleteDoc(doc(db, ...path("abandon-2"))));
  });

  test("A SEALED JOB CANNOT BE DELETED", async () => {
    // The whole line. Everything above is only defensible because this holds.
    const db = asUser(sam);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), ...path("finished")), { status: "sealed" });
    });
    await assertFails(deleteDoc(doc(db, ...path("finished"))));
  });

  test("nor may its evidence be deleted out from under it", async () => {
    // A step outcome carries its OWN status and has no idea the job above it sealed, so the
    // rule reads the parent. Without that read this delete succeeds and a sealed job keeps a
    // header nobody can touch over evidence anybody can empty.
    const db = asUser(sam);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const f = ctx.firestore();
      await setDoc(doc(f, ...path("finished")), { status: "sealed" });
      await setDoc(doc(f, ...path("finished", "step_outcomes", "s1")), { status: "performed" });
      await setDoc(doc(f, ...path("finished", "captures", "c1")), { kind: "photo" });
    });
    await assertFails(deleteDoc(doc(db, ...path("finished", "step_outcomes", "s1"))));
    await assertFails(deleteDoc(doc(db, ...path("finished", "captures", "c1"))));
  });

  test("an unsealed job's evidence goes with it", async () => {
    const db = asUser(sam);
    await assertSucceeds(setDoc(doc(db, ...path("abandon-3")), { status: "open" }));
    await assertSucceeds(
      setDoc(doc(db, ...path("abandon-3", "step_outcomes", "s1")), { status: "pending" }));
    await assertSucceeds(
      setDoc(doc(db, ...path("abandon-3", "captures", "c1")), { kind: "photo" }));
    await assertSucceeds(deleteDoc(doc(db, ...path("abandon-3", "step_outcomes", "s1"))));
    await assertSucceeds(deleteDoc(doc(db, ...path("abandon-3", "captures", "c1"))));
    await assertSucceeds(deleteDoc(doc(db, ...path("abandon-3"))));
  });

  test("a rival tenant cannot abandon somebody else's job", async () => {
    const rival = IDENTITIES[2];
    await assertSucceeds(setDoc(doc(asUser(sam), ...path("mine")), { status: "open" }));
    await assertFails(deleteDoc(doc(asUser(rival), ...path("mine"))));
  });

  test("the grant does not leak to the server-written collections", async () => {
    // A sealed RECORD is the artifact a stranger was sent a link to. It is not under /jobs,
    // and the recursive grant no longer carries a delete at all, so there is nothing to
    // narrow — this is the test that says so out loud.
    const db = asUser(sam);
    for (const name of PROTECTED) {
      await assertFails(deleteDoc(doc(db, "tenants", sam.tenant, name, "x1")));
    }
  });

  test("nor to anything else under the tenant", async () => {
    const db = asUser(sam);
    await assertSucceeds(
      setDoc(doc(db, "tenants", sam.tenant, "components", "comp-1"), { name: "hub" }));
    await assertFails(deleteDoc(doc(db, "tenants", sam.tenant, "components", "comp-1")));
  });
});
