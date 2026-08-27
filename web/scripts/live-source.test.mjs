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
/** Every storage path `capture()` put bytes at, in order. */
const uploaded = [];

/** A stand-in for a frame off the camera. Bytes, with a type, which is all the code reads. */
const frame = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });

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
  // The second argument is the signature. In the product it is the signed-in Firebase
  // user; firestore.rules refuses `reason_by`/`finalized_by` unless they equal it.
  //
  // The third is the object store, recorded rather than performed. There is no Storage
  // emulator in scripts/smoke.sh and this file is about Firestore, but the upload cannot
  // simply be skipped either: `capture()` now refuses to write a document describing bytes
  // that did not land, and that refusal is the fix these tests have to keep honest. So the
  // paths are collected, and `uploaded` is asserted on directly further down.
  src = new LiveSource(db, () => "tech-1", async (path) => { uploaded.push(path); });
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
        blob: frame(),
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
        mediaRef: ref, blob: frame(), surface: "browser", mode: "live",
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
      mediaRef: "blob:x", blob: frame(), surface: "app_instrument", mode: "live",
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

describe("the bytes reach the bucket, or nothing is written", () => {
  // THE FAILURE THIS PINS.
  //
  // The browser wrote a capture document whose `media_ref` was an object URL — a handle only
  // the tab that minted it can resolve — and never uploaded anything. The adjudication spine
  // does not look the object up: `server/adjudicate/cases.ts` DERIVES the path by convention,
  // `gs://{bucket}/tenants/{t}/captures/{job}/{capture}.jpg`. So Vertex was handed a URI for
  // an object nobody had ever put there and answered 404 NOT_FOUND, every single time, on
  // every browser capture this product took. The technician was told the fleet could not be
  // reached, about a photograph that had failed to leave the laptop.
  //
  // The two halves must therefore agree on the path, and the write must not happen without
  // the upload. Both are asserted here.
  test("a capture stores its bytes at the path the fleet will derive", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });
    const [, bare] = job.id.split("/");

    const before = uploaded.length;
    const cap = await src.capture({
      jobId: job.id, stepId: "s1", fieldKey: "pad_photo", kind: "photo",
      mediaRef: "blob:local-only", blob: frame(), surface: "browser", mode: "live",
    });

    assert.deepEqual(
      uploaded.slice(before),
      [`tenants/${TENANT}/captures/${bare}/${cap.id}.jpg`],
      "the bytes did not go to the one path storage.rules allows and cases.ts derives",
    );
    assert.equal(
      cap.media_ref, `tenants/${TENANT}/captures/${bare}/${cap.id}.jpg`,
      "media_ref still carries the object URL, which resolves in exactly one browser tab",
    );
  });

  test("no bytes, no capture document", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });
    const [, bare] = job.id.split("/");

    await assert.rejects(
      () => src.capture({
        jobId: job.id, stepId: "s1", fieldKey: "pad_photo", kind: "photo",
        mediaRef: "blob:nothing", surface: "browser", mode: "live",
      }),
      /nothing was recorded/,
      "a capture with no bytes behind it was accepted",
    );

    const captures = await getDocs(collection(db, "tenants", TENANT, "jobs", bare, "captures"));
    assert.equal(captures.size, 0,
      "a capture document was written for evidence that does not exist — the fleet will be " +
      "asked to read an object nobody uploaded");
  });

  test("a failed upload is not written either, and says so in words a person can act on", async () => {
    const refusing = new LiveSource(db, () => "tech-1", async () => {
      throw new Error("network");
    });
    const job = await refusing.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });
    const [, bare] = job.id.split("/");

    await assert.rejects(
      () => refusing.capture({
        jobId: job.id, stepId: "s1", fieldKey: "pad_photo", kind: "photo",
        mediaRef: "blob:doomed", blob: frame(), surface: "browser", mode: "live",
      }),
      /could not be uploaded/,
    );

    const captures = await getDocs(collection(db, "tenants", TENANT, "jobs", bare, "captures"));
    assert.equal(captures.size, 0, "a failed upload still produced a capture document");
  });

  // `text` is the one kind with no object behind it — contract/entities/capture.schema.json
  // says `media_ref` carries the answer itself. It must not acquire a path, and it must not
  // be refused for having no bytes.
  test("a typed answer stores nothing and keeps the answer in media_ref", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });

    const before = uploaded.length;
    const cap = await src.capture({
      jobId: job.id, stepId: "s3", fieldKey: "knife_stored", kind: "text",
      mediaRef: "Ada Lovelace", blob: null, surface: "browser", mode: "upload",
    });

    assert.equal(uploaded.length, before, "an answer with no object put something in the bucket");
    assert.equal(cap.media_ref, "Ada Lovelace");
    assert.equal(cap.kind, "text",
      "an answer written as a photograph makes the fleet derive a .jpg path for a name");
  });
});

describe("the assembled aggregate is what the seam returns", () => {
  test("getJob puts the steps and their fields back together", async () => {
    const job = await src.startJob({ procedureId: "front-brake-service", tenantId: TENANT, tier: "open" });

    await src.capture({
      jobId: job.id, stepId: "s2", fieldKey: "pad_photo", kind: "photo",
      mediaRef: "blob:y", blob: frame(), surface: "browser", mode: "live",
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

    await src.finalize(job.id);

    const after = await src.getJob(job.id);
    assert.equal(after.status, "open", "finalize did not open the job");
    assert.ok(after.finalized_at, "finalize left no record of when");
    assert.equal(after.finalized_by, "tech-1", "finalize left no record of who");
  });
});
