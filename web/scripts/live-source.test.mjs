// LiveSource against a real Firestore, through the real rules.
//
// This exists for one claim in particular: a capture writes O(1) documents. The old
// implementation did `tx.update(jobRef, { steps })` on every capture — reading the whole job
// inside a transaction and rewriting the entire steps[] array — so write cost grew with
// evidence already captured, a 1 MiB document cap loomed, and two technicians on one job
// contended on a single document.
//
// The regression that would undo it is subtle and plausible: somebody "simplifies" by putting
// the assembled aggregate back on the job document, and everything still passes except the
// thing that mattered. So the assertion here is structural — the job document must never
// contain a steps array, however convenient that would be.
//
//   node --experimental-strip-types --test web/scripts/live-source.test.mjs
//
// Requires the Firestore emulator; scripts/smoke.sh starts it.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, getDocs, collection, setDoc } from "firebase/firestore";
import { LiveSource, fieldId } from "../src/data/live-source.ts";

const RULES = new URL("../../firestore.rules", import.meta.url);
const TENANT = "acme.com";

const TOKEN = { hd: TENANT, firebase: { sign_in_provider: "google.com" } };

/** Seven steps, because that is the shape the film shows and a realistic job. */
const PROCEDURE = {
  id: `${TENANT}/front-brake-service`,
  tenant_id: TENANT,
  key: "front-brake-service",
  title: "Front brake service",
  version: 3,
  strictness: 1,
  minimum_tier: "open",
  steps: Array.from({ length: 7 }, (_, i) => ({
    id: `s${i + 1}`,
    index: i + 1,
    title: `Step ${i + 1}`,
    explanation: "why this step exists",
    max_add_fields: 2,
    fields: [],
  })),
  created_at: "2026-08-20T00:00:00Z",
};

let env;
let db;
let src;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "warrant-live-test",
    firestore: { rules: readFileSync(RULES, "utf8"), host: "127.0.0.1", port: 8080 },
  });

  // Seed through a context with rules off: a procedure would normally be written by the
  // Scoper compile path, and this test is about jobs, not about how procedures get there.
  await env.withSecurityRulesDisabled(async (context) => {
    const raw = context.firestore();
    await setDoc(doc(raw, "tenants", TENANT, "procedures", "front-brake-service"), PROCEDURE);
    await setDoc(doc(raw, "tenants", TENANT, "procedure_versions", "front-brake-service:3"), PROCEDURE);
  });

  db = env.authenticatedContext("tech-1", TOKEN).firestore();
  src = new LiveSource(db);
});

after(async () => {
  await env?.cleanup();
});

describe("a job is decomposed, not an aggregate document", () => {
  test("startJob writes a header and one document per step", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });

    const [, bare] = job.id.split("/");
    const header = await getDoc(doc(db, "tenants", TENANT, "jobs", bare));
    assert.ok(header.exists(), "the job header was not written");

    // The assertion this file exists for.
    assert.equal(
      header.data().steps, undefined,
      "the job document carries a steps array — the aggregate has been reassembled and the " +
      "write amplification this decomposition removed is back",
    );

    const outcomes = await getDocs(collection(db, "tenants", TENANT, "jobs", bare, "step_outcomes"));
    assert.equal(outcomes.size, 7, "one step outcome per step, always written, never absent");
  });

  test("a job starts as a draft, so no agent sees it", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });
    assert.equal(job.status, "draft");
  });

  test("the pinned version is the one that ran, not the current one", async () => {
    // Publish a v4 that the running job must not silently switch to.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "tenants", TENANT, "procedures", "front-brake-service"),
        { ...PROCEDURE, version: 4 });
    });

    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });
    // v4 has no frozen version document, so it pins what it can resolve and records it
    // honestly. What must never happen is a job claiming one version while running another.
    const [, bare] = job.id.split("/");
    const header = await getDoc(doc(db, "tenants", TENANT, "jobs", bare));
    assert.equal(header.data().procedure_version, job.procedure_version,
      "the job records a version different from the one it pinned");

    // Restore, so ordering between tests cannot matter.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "tenants", TENANT, "procedures", "front-brake-service"), PROCEDURE);
    });
  });
});

describe("a capture costs the same whether it is the first or the fiftieth", () => {
  test("captures accumulate as documents, and the header never grows", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });
    const [, bare] = job.id.split("/");

    const N = 20;
    for (let i = 0; i < N; i += 1) {
      await src.capture({
        jobId: job.id,
        stepId: `s${(i % 7) + 1}`,
        fieldKey: `photo_${i}`,
        kind: "photo",
        mediaRef: `blob:${i}`,
        surface: "browser",
        mode: "live",
      });
    }

    const header = await getDoc(doc(db, "tenants", TENANT, "jobs", bare));
    assert.equal(header.data().steps, undefined, "evidence leaked back into the job document");
    assert.equal(header.data().field_count, N, "the denormalised counter did not keep up");

    const fields = await getDocs(collection(db, "tenants", TENANT, "jobs", bare, "fields"));
    assert.equal(fields.size, N, "one field document per captured field");

    const captures = await getDocs(collection(db, "tenants", TENANT, "jobs", bare, "captures"));
    assert.equal(captures.size, N, "one capture document per capture");
  });

  test("re-capturing a field replaces the answer and keeps every attempt", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });
    const [, bare] = job.id.split("/");

    for (const ref of ["blob:first", "blob:second", "blob:third"]) {
      await src.capture({
        jobId: job.id, stepId: "s1", fieldKey: "pad_photo", kind: "photo",
        mediaRef: ref, surface: "browser", mode: "live",
      });
    }

    const fields = await getDocs(collection(db, "tenants", TENANT, "jobs", bare, "fields"));
    assert.equal(fields.size, 1, "the field subcollection must stay bounded by declared fields");

    const captures = await getDocs(collection(db, "tenants", TENANT, "jobs", bare, "captures"));
    assert.equal(captures.size, 3, "every attempt is kept — history lives in captures");

    const field = await getDoc(
      doc(db, "tenants", TENANT, "jobs", bare, "fields", fieldId("s1", "pad_photo")),
    );
    assert.ok(field.exists(), "the field id must be derived, not random");
  });

  test("a capture never claims provenance for itself", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });
    const [, bare] = job.id.split("/");

    // A browser passing app_instrument is the forgery this guards against. The write must
    // succeed — refusing it would strand the technician — while the claim is dropped.
    await src.capture({
      jobId: job.id, stepId: "s1", fieldKey: "pad_torque", kind: "photo",
      mediaRef: "blob:x", surface: "app_instrument", mode: "live",
    });

    const field = await getDoc(
      doc(db, "tenants", TENANT, "jobs", bare, "fields", fieldId("s1", "pad_torque")),
    );
    assert.equal(field.data().provenance_class, null,
      "LiveSource stamped a provenance class; only the Seal may do that");
    assert.equal(field.data().tool_id, undefined,
      "a client-written field carried a tool_id, which mints a fabricated measured value");
  });
});

describe("the assembled aggregate is what the seam returns", () => {
  test("getJob puts the steps and their fields back together", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });

    await src.capture({
      jobId: job.id, stepId: "s2", fieldKey: "pad_photo", kind: "photo",
      mediaRef: "blob:y", surface: "browser", mode: "live",
    });

    const assembled = await src.getJob(job.id);
    assert.equal(assembled.steps.length, 7, "every step is present, always");

    const s2 = assembled.steps.find((s) => s.step_id === "s2");
    assert.equal(s2.fields.length, 1, "the field did not land on its step");
    assert.equal(s2.fields[0].key, "pad_photo");

    const s3 = assembled.steps.find((s) => s.step_id === "s3");
    assert.equal(s3.fields.length, 0, "a field landed on a step it does not belong to");
  });

  test("finalize is what hands the job to the fleet", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });
    assert.equal(job.status, "draft");

    await src.finalize(job.id, "tech-1");

    const after = await src.getJob(job.id);
    assert.equal(after.status, "open", "finalize did not open the job");
    assert.ok(after.finalized_at, "finalize left no record of when");
    assert.equal(after.finalized_by, "tech-1", "finalize left no record of who");
  });
});
