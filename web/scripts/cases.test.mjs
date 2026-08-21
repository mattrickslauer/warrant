// The agents read specific keys.
//
// `inspector.py:parts` and `skeptic.py:parts` index into these dictionaries directly —
// case["field"]["key"], case["step"]["title"]. There is no adapter on the remote and no
// tolerance for a renamed key: it is a KeyError inside the engine, surfacing as a 500 that
// names nothing useful. So the builders are pure and pinned to the keys the Python reaches
// for, and the Python is the authority whenever the two disagree.
//
//   cd web && node --experimental-strip-types --test scripts/cases.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inspectorCase, skepticCase, mediaUri } from "../src/server/adjudicate/cases.ts";

const SOURCES = {
  step: { id: "s3", title: "Check pad wear", explanation: "Worn pads stop it less well.",
          max_add_fields: 2 },
  fieldDef: { key: "pad_photo", kind: "photo", prompt: "Photograph the pad edge",
              source: "camera", acceptance_rule: "must_show",
              acceptance_description: "friction material thickness visible" },
  capture: { id: "cap_1", kind: "photo", capture_mode: "live", capture_surface: "app",
             created_at: "2026-08-21T10:00:00Z" },
  job: { id: "acme.com/job_9", procedure: "front-brake-service", asset_id: "bike-04",
         started_at: "2026-08-21T09:00:00Z" },
  strictness: 2,
  addFieldsUsed: 1,
  reading: null,
  answer: null,
  mediaUris: ["gs://evidence/tenants/acme.com/captures/job_9/cap_1.jpg"],
  priorMediaUris: [],
  asset: { id: "bike-04", type: "motorcycle", model: "Himalayan 450" },
};

describe("inspectorCase", () => {
  test("carries the keys inspector.py reaches for", () => {
    const c = inspectorCase(SOURCES);
    assert.equal(c.step.title, "Check pad wear");
    assert.equal(c.step.max_add_fields, 2);
    assert.equal(c.field.key, "pad_photo");
    assert.equal(c.field.acceptance_rule, "must_show");
    assert.equal(c.strictness, 2);
    assert.equal(c.add_fields_used, 1);
    assert.equal(c.capture.capture_surface, "app");
    assert.deepEqual(c.media, ["gs://evidence/tenants/acme.com/captures/job_9/cap_1.jpg"]);
  });

  test("omits reading entirely when there is none", () => {
    // inspector.py checks `case.get("reading") is not None`. A null here would print an
    // instrument block about a reading that does not exist.
    const c = inspectorCase(SOURCES);
    assert.ok(!("reading" in c));
    assert.ok(!("answer" in c));
  });

  test("a typed number is presented as a claim, not a measurement", () => {
    // The whole product rests on this distinction. A typed value labelled `instrument`
    // would mint a false measurement.
    const c = inspectorCase({ ...SOURCES,
      reading: { value: 3.2, unit: "mm", source: "human" } });
    assert.equal(c.reading.source, "human");
    assert.equal(c.reading.value, 3.2);
  });

  test("an instrument reading says so", () => {
    const c = inspectorCase({ ...SOURCES,
      reading: { value: 3.2, unit: "mm", source: "instrument" } });
    assert.equal(c.reading.source, "instrument");
  });
});

describe("skepticCase", () => {
  test("carries the machine, the job and the capture", () => {
    const c = skepticCase(SOURCES);
    assert.equal(c.asset.id, "bike-04");
    assert.equal(c.job.id, "acme.com/job_9");
    assert.equal(c.capture.capture_mode, "live");
    assert.deepEqual(c.media, ["gs://evidence/tenants/acme.com/captures/job_9/cap_1.jpg"]);
  });

  test("prior media travels so reuse is detectable", () => {
    const c = skepticCase({ ...SOURCES, priorMediaUris: ["gs://evidence/old.jpg"] });
    assert.deepEqual(c.prior_media, ["gs://evidence/old.jpg"]);
  });

  test("never carries the Inspector's conclusion", () => {
    // "You have not seen the Inspector's conclusion and must not guess it." Leaking it here
    // would turn an independent second opinion into an echo.
    const c = JSON.stringify(skepticCase(SOURCES));
    assert.ok(!/verdict|PASS|ADD_FIELD|acceptance/.test(c), c);
  });
});

describe("mediaUri", () => {
  test("matches the path storage.rules allows", () => {
    // storage.rules: match /tenants/{t}/captures/{jobId}/{file}
    assert.equal(
      mediaUri("evidence", { id: "cap_1", kind: "photo" }, "acme.com", "job_9"),
      "gs://evidence/tenants/acme.com/captures/job_9/cap_1.jpg",
    );
  });

  test("keeps an extension, because the fleet reads the mime type off it", () => {
    // Agent.media() derives the MIME type from the suffix. An extensionless object raises
    // MediaMissing on the remote rather than being judged.
    assert.equal(
      mediaUri("evidence", { id: "cap_2", kind: "video" }, "acme.com", "job_9"),
      "gs://evidence/tenants/acme.com/captures/job_9/cap_2.mp4",
    );
  });
});
