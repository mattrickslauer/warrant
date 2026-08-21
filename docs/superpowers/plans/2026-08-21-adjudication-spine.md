# Adjudication Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a capture written by a client get judged by the deployed agent fleet, and land as a real `decisions` document that both surfaces already know how to render.

**Architecture:** A route on the existing Next.js Cloud Run service (`POST /api/adjudicate`) re-reads the capture from Firestore under Admin credentials, calls the deployed Vertex Agent Engine over REST for the Inspector and the Skeptic, then applies the outcome deterministically. The route takes a capture *reference* and does not care who woke it, so an Eventarc trigger can become a second caller later without a rewrite. The Python fleet stays the single authored statement of every prompt; TypeScript only calls it.

**Tech Stack:** TypeScript / Next.js 15 App Router, `firebase-admin`, `google-auth-library`, Node 22 built-in test runner (`node --experimental-strip-types --test`), Python 3 for the fleet, Vertex AI Agent Engine.

**Spec:** `specs/2026-08-21-making-it-real-design.md`

## Global Constraints

- **The deployed engine** is `projects/1020487917587/locations/us-central1/reasoningEngines/5032906174249304064`, display name `warrant-fleet`. Read it from `WARRANT_FLEET_ENGINE`; never hardcode it in a source file.
- **The query REST shape is verified and double-nested.** `POST {host}/v1/{engine}:query` with body `{"classMethod":"query","input":{"agent":<name>,"case":<case>}}`. The reply is `{"output":{"output":<the verdict>,"usage":…,"model":…,"latency_ms":…,"agent":…,"valid":…,"schema_errors":[…]}}`. The verdict is at `body.output.output`. Getting this wrong is the single most likely way this task silently returns undefined.
- **Host is regional:** `https://us-central1-aiplatform.googleapis.com`. The *model* is served from `global` (`GEMINI_LOCATION`), which is a different thing and already handled inside the fleet.
- **Never widen `warrant-web`.** Vertex access comes from impersonating `warrant-adjudicator`, or from ADC locally. See Task 2.
- **The model's verdict is an input, never the decision.** All step transitions come from the pure function in Task 3.
- **The Seal is untouched.** No code in this plan may write `provenance_class`, `tier`, or any release decision.
- **Admitted gaps beat fabricated passes.** Never write `armor_verdict: "NO_MATCH_FOUND"` in this plan — Model Armor is a later plan. Leave it `null`.
- **Tenant comes from a verified session only** (`requireTenant()` in `web/src/auth/session.ts`), never from a request body.
- **Test idiom:** `node --experimental-strip-types --test web/scripts/<name>.test.mjs`, importing TypeScript from `../src/...` with a `.ts` extension. Tests needing Firestore run under `firebase emulators:exec` and are wired into `scripts/smoke.sh` step 5. Pure tests need no emulator.
- **Python venv:** `./.venv-deploy/bin/python`. Do NOT source `.env` when calling Vertex — its `GOOGLE_APPLICATION_CREDENTIALS` is the least-privilege `warrant-web` key and yields a 403 that reads like a missing model.

---

### Task 1: `gs://` media transport in the fleet

The fleet's `Agent.media()` reads from a local directory, so a deployed engine cannot judge a photograph that lives in Cloud Storage. Give `Part` a URI form.

**Files:**
- Modify: `agents/warrant/model.py` (the `Part` dataclass and its `to_sdk`/`digest`)
- Modify: `agents/warrant/base.py:104-113` (`Agent.media`)
- Test: `agents/tests/test_media_uri.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Part(uri: str | None, mime_type: str, label: str)` accepted anywhere a media `Part` is accepted; `Agent.media("gs://bucket/object.jpg")` returns a URI part. Task 4 relies on being able to put `gs://` strings in a case's `media` list.

- [ ] **Step 1: Write the failing test**

```python
# agents/tests/test_media_uri.py
"""A gs:// reference becomes a URI part, and a local file still becomes bytes.

The fleet judges photographs that live in Cloud Storage. Inflating megabytes into base64
through the query payload would be the obvious way to do that and the wrong one, so a
media reference may name an object instead of carrying it.
"""
import pytest

from warrant.base import Agent, MediaMissing
from warrant.model import Part


def test_gs_reference_becomes_a_uri_part():
    part = Agent.media("gs://warrent-505918-evidence/captures/cap_1.jpg")
    assert part.uri == "gs://warrent-505918-evidence/captures/cap_1.jpg"
    assert part.mime_type == "image/jpeg"
    assert part.data is None


def test_uri_part_digests_its_uri_not_its_bytes():
    """The cassette key is built from attachment bytes, which a URI part does not have."""
    a = Agent.media("gs://b/one.jpg")
    b = Agent.media("gs://b/one.jpg")
    c = Agent.media("gs://b/two.jpg")
    assert a.digest() == b.digest()
    assert a.digest() != c.digest()


def test_unsupported_extension_on_a_uri_is_refused():
    """An Inspector asked to judge something it cannot decode would answer anyway."""
    with pytest.raises(MediaMissing):
        Agent.media("gs://b/notes.txt")


def test_local_files_are_unchanged():
    """The eval corpus keeps using local media, and its cassettes must not move."""
    part = Agent.media("banana/whole-unpeeled.jpg")
    assert part.uri is None
    assert part.data is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agents && ../.venv-deploy/bin/python -m pytest tests/test_media_uri.py -v`
Expected: FAIL — `TypeError` or `AttributeError` on `Part.uri`, which does not exist yet.

- [ ] **Step 3: Add the URI form to `Part` in `agents/warrant/model.py`**

Add a `uri` field to the dataclass, beside `data`:

```python
@dataclass
class Part:
    """One piece of the user turn. Text, media bytes, or media BY REFERENCE.

    A URI part names an object the model reads for itself. It exists because the deployed
    fleet judges photographs that live in Cloud Storage, and base64 through the query
    payload would mean every megabyte crossed the wire twice for no gain.
    """
    text: str | None = None
    mime_type: str | None = None
    data: bytes | None = None
    #: A `gs://` object. Mutually exclusive with `data`.
    uri: str | None = None
    label: str = ""
```

In `to_sdk`, return a URI part when `uri` is set:

```python
    def to_sdk(self) -> Any:
        from google.genai import types
        if self.uri is not None:
            return types.Part.from_uri(file_uri=self.uri, mime_type=self.mime_type)
        # ... existing text and bytes branches unchanged
```

In `digest()`, key a URI part on the URI string. Find the existing digest implementation and add the branch **before** the bytes branch:

```python
        if self.uri is not None:
            return hashlib.sha256(self.uri.encode()).hexdigest()[:16]
```

- [ ] **Step 4: Add the `gs://` branch to `Agent.media` in `agents/warrant/base.py`**

Replace the body of `media` (currently at `base.py:104-113`):

```python
    @staticmethod
    def media(ref: str, label: str = "") -> Part:
        """Evidence, by value from disk or by reference in Cloud Storage.

        The eval corpus names files under MEDIA_DIR. Production names `gs://` objects, which
        the model reads for itself. Both refuse an extension they cannot decode, because an
        Inspector handed something undecodable will confidently return a verdict anyway and
        that answer would be recorded as though it had seen the evidence.
        """
        if ref.startswith("gs://"):
            mime = _MIME.get(Path(ref).suffix.lower())
            if mime is None:
                raise MediaMissing(f"{ref}: unsupported media type {Path(ref).suffix}")
            return Part(mime_type=mime, uri=ref, label=label or ref)

        path = (MEDIA_DIR / ref) if not Path(ref).is_absolute() else Path(ref)
        if not path.exists():
            raise MediaMissing(f"{ref} is not in {MEDIA_DIR}; run evals/gen_media.py")
        mime = _MIME.get(path.suffix.lower())
        if mime is None:
            raise MediaMissing(f"{ref}: unsupported media type {path.suffix}")
        return Part(mime_type=mime, data=path.read_bytes(), label=label or ref)
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `cd agents && ../.venv-deploy/bin/python -m pytest tests/test_media_uri.py -v`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify the eval corpus did not move**

Run: `cd agents && ../.venv-deploy/bin/python -m pytest tests/ -q && ../.venv-deploy/bin/python -m evals check`
Expected: the existing suite passes and `evals check` reports no schema problems. If any cassette key changed, the digest branch was placed wrong — a local file part must digest exactly as before.

- [ ] **Step 7: Redeploy the fleet so the engine has the new media code**

Run: `./.venv-deploy/bin/python ./infra/deploy-agents.py`
Expected: `deployed projects/.../reasoningEngines/5032906174249304064` and `exposes  query, roster`. Takes several minutes.

- [ ] **Step 8: Commit**

```bash
git add agents/warrant/model.py agents/warrant/base.py agents/tests/test_media_uri.py
git commit -m "feat(agents): judge evidence by gs:// reference, not only from disk"
```

---

### Task 2: The fleet client

One place that speaks to the deployed engine, so the double-nested reply is unwrapped exactly once in the codebase.

**Files:**
- Create: `web/src/server/fleet.ts`
- Test: `web/scripts/fleet.test.mjs`

**Interfaces:**
- Consumes: Task 1's `gs://` media support (runtime only, no import).
- Produces:
  - `type FleetReply = { output: Record<string, unknown>; valid: boolean; schemaErrors: string[]; model: string | null; latencyMs: number; usage: { totalTokenCount?: number } | null }`
  - `askFleet(agent: string, kase: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<FleetReply>`
  - `class FleetUnreachable extends Error { readonly principal: string | null }`

- [ ] **Step 1: Write the failing test**

```javascript
// web/scripts/fleet.test.mjs
//
// The reply from reasoningEngines:query is DOUBLE-NESTED — body.output.output holds the
// verdict. Reading body.output by mistake yields an object that looks plausible and has no
// verdict in it, so this is asserted rather than trusted.
//
//   node --experimental-strip-types --test web/scripts/fleet.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { askFleet, FleetUnreachable } from "../src/server/fleet.ts";

process.env.WARRANT_FLEET_ENGINE =
  "projects/1/locations/us-central1/reasoningEngines/9";

const REPLY = {
  output: {
    output: { verdict: "ADD_FIELD", confidence: 1, rationale: "No photo was captured." },
    usage: { totalTokenCount: 1887 },
    model: "gemini-3.5-flash",
    latency_ms: 6518,
    agent: "inspector",
    valid: true,
    schema_errors: [],
  },
};

function fakeFetch(status, body) {
  return async () => ({
    ok: status === 200,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe("askFleet", () => {
  test("unwraps the double nesting to the verdict", async () => {
    const reply = await askFleet("inspector", { step: {} }, fakeFetch(200, REPLY));
    assert.equal(reply.output.verdict, "ADD_FIELD");
    assert.equal(reply.model, "gemini-3.5-flash");
    assert.equal(reply.latencyMs, 6518);
    assert.equal(reply.valid, true);
    assert.deepEqual(reply.schemaErrors, []);
  });

  test("a schema-invalid answer is returned, not thrown", async () => {
    // runtime.py returns validation failures rather than raising, precisely so the caller
    // can refuse the answer and say why. Throwing here would lose the text.
    const invalid = {
      output: { ...REPLY.output, valid: false, schema_errors: ["verdict: required"] },
    };
    const reply = await askFleet("inspector", {}, fakeFetch(200, invalid));
    assert.equal(reply.valid, false);
    assert.deepEqual(reply.schemaErrors, ["verdict: required"]);
  });

  test("a 403 becomes FleetUnreachable naming the principal", async () => {
    // The identity trap: .env's service account is least-privilege and cannot call Vertex.
    // A 403 that reads as "model does not exist" has cost hours before.
    await assert.rejects(
      () => askFleet("inspector", {}, fakeFetch(403, { error: { message: "denied" } })),
      (e) => e instanceof FleetUnreachable,
    );
  });

  test("refuses to run with no engine configured", async () => {
    delete process.env.WARRANT_FLEET_ENGINE;
    await assert.rejects(() => askFleet("inspector", {}, fakeFetch(200, REPLY)),
      /WARRANT_FLEET_ENGINE/);
    process.env.WARRANT_FLEET_ENGINE =
      "projects/1/locations/us-central1/reasoningEngines/9";
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test web/scripts/fleet.test.mjs`
Expected: FAIL — cannot resolve `../src/server/fleet.ts`.

- [ ] **Step 3: Write `web/src/server/fleet.ts`**

```typescript
import "server-only";

// The one place that speaks to the deployed fleet.
//
// Warrant's agents run on Vertex AI Agent Engine, deployed from `infra/deploy-agents.py`.
// They are authored in Python, under `agents/warrant/`, and that is the single statement of
// every prompt in this system. This file calls them. It must never restate one.
//
// THE REPLY IS DOUBLE-NESTED. `reasoningEngines:query` wraps the operation's return value in
// its own `output`, and the operation itself returns a dict with an `output` key holding the
// verdict. So the verdict is at `body.output.output`, and `body.output` is an object that
// looks plausible, has no verdict in it, and produces `undefined` rather than an error.

import { GoogleAuth, Impersonated, type AuthClient } from "google-auth-library";

const HOST = "https://us-central1-aiplatform.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export interface FleetReply {
  output: Record<string, unknown>;
  valid: boolean;
  schemaErrors: string[];
  model: string | null;
  latencyMs: number;
  usage: { totalTokenCount?: number } | null;
}

/**
 * The fleet could not be reached or refused us.
 *
 * Carries the principal because the overwhelmingly likely cause is the identity trap: the
 * `warrant-web` service account is deliberately least-privilege and cannot call Vertex, and
 * the 403 it produces reads exactly like the model not existing.
 */
export class FleetUnreachable extends Error {
  readonly principal: string | null;
  constructor(message: string, principal: string | null = null) {
    super(message);
    this.name = "FleetUnreachable";
    this.principal = principal;
  }
}

let cached: { client: AuthClient; principal: string | null } | null = null;

/**
 * Vertex access, without widening `warrant-web`.
 *
 * On Cloud Run the service runs as `warrant-web`, which may not call Vertex — deliberately,
 * because a principal that can both mint session cookies and run models is a worse failure
 * when it leaks. `WARRANT_ADJUDICATOR_SA` names a service account to IMPERSONATE, which
 * requires the running identity to hold roles/iam.serviceAccountTokenCreator on it.
 *
 * Note this is impersonation, NOT `clientOptions.subject` — that field is domain-wide
 * delegation for Workspace users and silently does nothing for a service account.
 *
 * Unset, the caller is plain ADC, which is what a developer has locally.
 */
async function authClient(): Promise<{ client: AuthClient; principal: string | null }> {
  if (cached) return cached;
  const auth = new GoogleAuth({ scopes: [SCOPE] });
  const source = await auth.getClient();
  const target = process.env.WARRANT_ADJUDICATOR_SA;
  if (!target) {
    cached = { client: source as AuthClient, principal: null };
    return cached;
  }
  const impersonated = new Impersonated({
    sourceClient: source,
    targetPrincipal: target,
    targetScopes: [SCOPE],
    lifetime: 3600,
  });
  cached = { client: impersonated as unknown as AuthClient, principal: target };
  return cached;
}

export async function askFleet(
  agent: string,
  kase: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<FleetReply> {
  const engine = process.env.WARRANT_FLEET_ENGINE;
  if (!engine) {
    throw new FleetUnreachable(
      "WARRANT_FLEET_ENGINE is not set — deploy with infra/deploy-agents.py and put the " +
        "resource name in the environment.",
    );
  }

  let token: string | null = null;
  let principal: string | null = process.env.WARRANT_ADJUDICATOR_SA ?? null;
  try {
    const resolved = await authClient();
    principal = resolved.principal;
    const t = await resolved.client.getAccessToken();
    token = typeof t === "string" ? t : (t?.token ?? null);
  } catch (error) {
    throw new FleetUnreachable(`no credential for the fleet: ${String(error)}`, principal);
  }

  const response = await fetchImpl(`${HOST}/v1/${engine}:query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ classMethod: "query", input: { agent, case: kase } }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new FleetUnreachable(
      `fleet returned ${response.status}: ${detail.slice(0, 400)}`,
      principal,
    );
  }

  const body = (await response.json()) as { output?: Record<string, any> };
  const envelope = body.output;
  if (!envelope || typeof envelope !== "object") {
    throw new FleetUnreachable("fleet reply had no output envelope", principal);
  }

  return {
    output: (envelope.output ?? {}) as Record<string, unknown>,
    valid: Boolean(envelope.valid),
    schemaErrors: Array.isArray(envelope.schema_errors) ? envelope.schema_errors : [],
    model: typeof envelope.model === "string" ? envelope.model : null,
    latencyMs: typeof envelope.latency_ms === "number" ? envelope.latency_ms : 0,
    usage: (envelope.usage ?? null) as FleetReply["usage"],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test web/scripts/fleet.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Create the `warrant-adjudicator` service account**

Spec §6. `warrant-web` is deliberately least-privilege and is not widened — a principal that
can both mint session cookies and run models is a worse failure when it leaks.

Append to `infra/bootstrap.sh`, after the API enablement block:

```bash
# The adjudicator. Separate from warrant-web on purpose: warrant-web mints session cookies
# and reads Firestore, and nothing that can do that should also be able to run models.
ADJ="warrant-adjudicator@${PROJECT}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$ADJ" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create warrant-adjudicator --project "$PROJECT" \
    --display-name "Warrant adjudicator" \
    --description "Calls the agent fleet and writes decisions. Cannot mint sessions."
fi

for ROLE in roles/aiplatform.user roles/datastore.user roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:$ADJ" --role "$ROLE" --condition=None >/dev/null
done

# The Cloud Run runtime identity must be allowed to BECOME the adjudicator. Without this the
# impersonation in web/src/server/fleet.ts fails with a 403 on generateAccessToken, which
# reads nothing like "the wrong service account".
gcloud iam service-accounts add-iam-policy-binding "$ADJ" --project "$PROJECT" \
  --member "serviceAccount:warrant-web@${PROJECT}.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountTokenCreator >/dev/null

echo "adjudicator ready: $ADJ"
```

Run it:

```bash
./infra/bootstrap.sh
```

Expected: `adjudicator ready: warrant-adjudicator@warrent-505918.iam.gserviceaccount.com`.

- [ ] **Step 6: Record the new environment in `.env.example`**

Add both, with the comment that explains the trap:

```bash
# The deployed fleet. `infra/deploy-agents.py` prints this on every deploy.
WARRANT_FLEET_ENGINE=projects/…/locations/us-central1/reasoningEngines/…
# The principal that may call Vertex. Left unset locally, where ADC is enough. Set in Cloud
# Run, where the runtime identity is warrant-web and deliberately cannot call Vertex itself.
WARRANT_ADJUDICATOR_SA=warrant-adjudicator@…​.iam.gserviceaccount.com
```

Leave `WARRANT_ADJUDICATOR_SA` UNSET in `web/.env.local`. Locally you are ADC, which already
has Vertex access; setting it would make every local run depend on an impersonation grant you
do not need.

- [ ] **Step 7: Prove it against the real engine**

Add the engine to `web/.env.local` and `.env`:

```bash
echo 'WARRANT_FLEET_ENGINE=projects/1020487917587/locations/us-central1/reasoningEngines/5032906174249304064' >> web/.env.local
```

Then run a one-off, with `GOOGLE_APPLICATION_CREDENTIALS` explicitly unset:

```bash
cd web && env -u GOOGLE_APPLICATION_CREDENTIALS \
  WARRANT_FLEET_ENGINE=projects/1020487917587/locations/us-central1/reasoningEngines/5032906174249304064 \
  node --experimental-strip-types -e '
    import("./src/server/fleet.ts").then(async ({ askFleet }) => {
      const r = await askFleet("inspector", {
        step: { title: "Check pad wear", max_add_fields: 2 },
        field: { key: "pad_photo", kind: "photo", prompt: "Photograph the pad edge",
                 source: "camera", acceptance_rule: "must_show" },
        strictness: 2, add_fields_used: 0, media: [],
      });
      console.log(r.output.verdict, r.model, r.valid);
    })'
```

Expected: `ADD_FIELD gemini-3.5-flash true`. A 403 here means `GOOGLE_APPLICATION_CREDENTIALS` leaked in from `.env`.

- [ ] **Step 8: Commit**

```bash
git add web/src/server/fleet.ts web/scripts/fleet.test.mjs
git commit -m "feat(web): one client for the deployed agent fleet"
```

---

### Task 3: The deterministic outcome

The whole point of the spine. The model's verdict is an input to a decision this function makes; it is never the decision itself. Pure, so every row of the table is cheap to test.

**Files:**
- Create: `web/src/server/adjudicate/outcome.ts`
- Test: `web/scripts/outcome.test.mjs`

**Interfaces:**
- Consumes: `FleetReply` from Task 2.
- Produces:
```typescript
type Effect =
  | { kind: "accept_field" }
  | { kind: "add_field"; key: string; fieldKind: string; prompt: string }
  | { kind: "escalate"; question: string }
  | { kind: "hold"; why: string };
function decideOutcome(input: OutcomeInput): Effect
interface OutcomeInput {
  inspector: { output: Record<string, any>; valid: boolean; schemaErrors: string[] };
  skeptic: { output: Record<string, any>; valid: boolean } | null;
  addFieldsUsed: number;
  maxAddFields: number;
}
```

- [ ] **Step 1: Write the failing test**

```javascript
// web/scripts/outcome.test.mjs
//
// §5 of specs/2026-08-21-making-it-real-design.md, one test per row.
//
// The claim under test is the one the product rests on: a model's verdict is an input to a
// decision this code makes. Every way a model can be wrong — malformed, over budget,
// contradicted by the Skeptic — has a defined, conservative outcome.
//
//   node --experimental-strip-types --test web/scripts/outcome.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideOutcome } from "../src/server/adjudicate/outcome.ts";

const pass = { output: { verdict: "PASS", confidence: 0.9, rationale: "Pads visible." },
               valid: true, schemaErrors: [] };
const belongs = { output: { belongs: true, mismatch_kind: "none" }, valid: true };
const dissent = { output: { belongs: false, mismatch_kind: "different_machine" }, valid: true };

describe("decideOutcome", () => {
  test("PASS with the Skeptic agreeing accepts the field", () => {
    const e = decideOutcome({ inspector: pass, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "accept_field");
  });

  test("PASS with a Skeptic dissent does NOT accept", () => {
    const e = decideOutcome({ inspector: pass, skeptic: dissent,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
    assert.match(e.why, /different_machine/);
  });

  test("ADD_FIELD within budget asks for the named field", () => {
    const inspector = { output: { verdict: "ADD_FIELD", add_field_key: "pad_edge_retry",
                                  add_field_kind: "photo",
                                  add_field_prompt: "Photograph the pad edge again" },
                        valid: true, schemaErrors: [] };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 1, maxAddFields: 2 });
    assert.equal(e.kind, "add_field");
    assert.equal(e.key, "pad_edge_retry");
    assert.equal(e.prompt, "Photograph the pad edge again");
  });

  test("ADD_FIELD with the budget exhausted becomes an escalation", () => {
    // The contract already requires the Inspector to escalate here. The server enforces it
    // rather than trusting it — an agent that ignores its own budget must not be able to
    // loop a technician forever.
    const inspector = { output: { verdict: "ADD_FIELD", add_field_key: "again",
                                  add_field_kind: "photo", add_field_prompt: "once more" },
                        valid: true, schemaErrors: [] };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 2, maxAddFields: 2 });
    assert.equal(e.kind, "escalate");
  });

  test("ESCALATE carries the exact question", () => {
    const inspector = { output: { verdict: "ESCALATE",
                                  escalation_question: "Is this disc within service limit?" },
                        valid: true, schemaErrors: [] };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "escalate");
    assert.equal(e.question, "Is this disc within service limit?");
  });

  test("a schema-invalid verdict transitions nothing", () => {
    const inspector = { output: { verdict: "PASS" }, valid: false,
                        schemaErrors: ["confidence: required by the contract and absent"] };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
    assert.match(e.why, /confidence/);
  });

  test("an unknown verdict string holds rather than guessing", () => {
    const inspector = { output: { verdict: "PROBABLY_FINE" }, valid: true, schemaErrors: [] };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
  });

  test("ADD_FIELD missing its required key holds", () => {
    const inspector = { output: { verdict: "ADD_FIELD" }, valid: true, schemaErrors: [] };
    const e = decideOutcome({ inspector, skeptic: belongs,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
  });

  test("no Skeptic answer is not treated as agreement", () => {
    const e = decideOutcome({ inspector: pass, skeptic: null,
                              addFieldsUsed: 0, maxAddFields: 2 });
    assert.equal(e.kind, "hold");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test web/scripts/outcome.test.mjs`
Expected: FAIL — cannot resolve `../src/server/adjudicate/outcome.ts`.

- [ ] **Step 3: Write `web/src/server/adjudicate/outcome.ts`**

```typescript
// What the system does about what an agent said.
//
// The verdict is an INPUT. This function is the decision. That distinction is the same one
// the Seal already embodies, and it is the reason a model being wrong here is survivable:
// every way a verdict can be malformed, over budget or contradicted resolves to a
// conservative outcome, and the conservative outcome is always "the step does not advance".
//
// Pure on purpose. It is the one piece of this spine worth exhaustive tests, and a function
// that reached Firestore could not have them.

export interface OutcomeInput {
  inspector: { output: Record<string, any>; valid: boolean; schemaErrors: string[] };
  /** Null when the Skeptic could not be asked. Absence is never agreement. */
  skeptic: { output: Record<string, any>; valid: boolean } | null;
  addFieldsUsed: number;
  maxAddFields: number;
}

export type Effect =
  | { kind: "accept_field" }
  | { kind: "add_field"; key: string; fieldKind: string; prompt: string }
  | { kind: "escalate"; question: string }
  | { kind: "hold"; why: string };

export function decideOutcome(input: OutcomeInput): Effect {
  const { inspector, skeptic, addFieldsUsed, maxAddFields } = input;

  // A malformed answer is a finding, not an exception — and it advances nothing. runtime.py
  // hands validation failures back for exactly this reason.
  if (!inspector.valid) {
    return { kind: "hold", why: `the Inspector's answer did not satisfy its contract: ${
      inspector.schemaErrors.join("; ") || "unspecified"}` };
  }

  const verdict = inspector.output.verdict;

  if (verdict === "ESCALATE") {
    const question = inspector.output.escalation_question;
    if (typeof question !== "string" || !question) {
      return { kind: "hold", why: "the Inspector escalated without naming the question" };
    }
    return { kind: "escalate", question };
  }

  if (verdict === "ADD_FIELD") {
    // The budget is enforced here rather than trusted to the agent. The contract already
    // tells the Inspector to escalate when it is spent; an agent that ignored that could
    // otherwise ask a technician for one more photograph indefinitely.
    if (addFieldsUsed >= maxAddFields) {
      return {
        kind: "escalate",
        question: inspector.output.add_field_prompt
          ? `The evidence is still insufficient after ${maxAddFields} further requests. ` +
            `The last ask was: ${inspector.output.add_field_prompt}`
          : `The evidence is still insufficient after ${maxAddFields} further requests.`,
      };
    }
    const key = inspector.output.add_field_key;
    const fieldKind = inspector.output.add_field_kind;
    const prompt = inspector.output.add_field_prompt;
    if (!key || !fieldKind || !prompt) {
      return { kind: "hold", why: "ADD_FIELD arrived without the field it wants" };
    }
    return { kind: "add_field", key, fieldKind, prompt };
  }

  if (verdict !== "PASS") {
    return { kind: "hold", why: `unrecognised verdict ${JSON.stringify(verdict)}` };
  }

  // A PASS is the only verdict the Skeptic can overturn, and the only one where its silence
  // matters. The Inspector judged whether the evidence is good enough; the Skeptic judged
  // whether it is evidence of THIS machine. A step advanced on an unanswered second question
  // is exactly the tick in the box this product exists to abolish.
  if (skeptic === null) {
    return { kind: "hold", why: "the Skeptic could not be asked, so belonging is unestablished" };
  }
  if (!skeptic.valid) {
    return { kind: "hold", why: "the Skeptic's answer did not satisfy its contract" };
  }
  if (skeptic.output.belongs !== true) {
    const why = skeptic.output.mismatch_kind || "unstated";
    return { kind: "hold", why: `the Skeptic dissented: ${why}` };
  }

  return { kind: "accept_field" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test web/scripts/outcome.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/server/adjudicate/outcome.ts web/scripts/outcome.test.mjs
git commit -m "feat(web): the verdict is an input, the outcome is a decision"
```

---

### Task 4: Case builders

Turn Firestore documents into exactly the shapes `inspector.py:parts` and `skeptic.py:parts` read. Pure, so they can be tested without the emulator.

**Files:**
- Create: `web/src/server/adjudicate/cases.ts`
- Test: `web/scripts/cases.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `inspectorCase(a: CaseSources): Record<string, unknown>`
  - `skepticCase(a: CaseSources): Record<string, unknown>`
  - `mediaUri(bucket: string, capture: { id: string; kind: string }, tenantId: string, jobId: string): string`
```typescript
interface CaseSources {
  step: { id: string; title: string; explanation?: string; max_add_fields?: number };
  fieldDef: Record<string, any>;
  capture: Record<string, any>;
  job: Record<string, any>;
  strictness: number;
  addFieldsUsed: number;
  reading: { value: number; unit: string; source: string } | null;
  answer: string | null;
  mediaUris: string[];
  priorMediaUris: string[];
  asset: Record<string, any> | null;
}
```

- [ ] **Step 1: Write the failing test**

```javascript
// web/scripts/cases.test.mjs
//
// The agents read specific keys. `inspector.py:parts` reaches for case["field"]["key"] and
// case["step"]["title"] directly, so a renamed key here is a KeyError on the remote and a
// 500 that says nothing about which field was wrong.
//
//   node --experimental-strip-types --test web/scripts/cases.test.mjs

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
  mediaUris: ["gs://evidence/acme.com/job_9/cap_1.jpg"],
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
    assert.deepEqual(c.media, ["gs://evidence/acme.com/job_9/cap_1.jpg"]);
  });

  test("a typed number is presented as a claim, not a measurement", () => {
    // inspector.py branches on reading.source, and the whole product rests on the
    // distinction. A typed value labelled `instrument` would mint a false measurement.
    const c = inspectorCase({ ...SOURCES,
      reading: { value: 3.2, unit: "mm", source: "human" } });
    assert.equal(c.reading.source, "human");
  });
});

describe("skepticCase", () => {
  test("carries the machine, the job and the capture", () => {
    const c = skepticCase(SOURCES);
    assert.equal(c.asset.id, "bike-04");
    assert.equal(c.job.id, "acme.com/job_9");
    assert.equal(c.capture.capture_mode, "live");
    assert.deepEqual(c.media, ["gs://evidence/acme.com/job_9/cap_1.jpg"]);
  });

  test("prior media travels so reuse is detectable", () => {
    const c = skepticCase({ ...SOURCES, priorMediaUris: ["gs://evidence/old.jpg"] });
    assert.deepEqual(c.prior_media, ["gs://evidence/old.jpg"]);
  });
});

describe("mediaUri", () => {
  test("matches the prefix the clients upload to", () => {
    assert.equal(
      mediaUri("evidence", { id: "cap_1", kind: "photo" }, "acme.com", "job_9"),
      "gs://evidence/tenants/acme.com/jobs/job_9/captures/cap_1.jpg",
    );
  });

  test("a video keeps its own extension", () => {
    assert.equal(
      mediaUri("evidence", { id: "cap_2", kind: "video" }, "acme.com", "job_9"),
      "gs://evidence/tenants/acme.com/jobs/job_9/captures/cap_2.mp4",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test web/scripts/cases.test.mjs`
Expected: FAIL — cannot resolve `../src/server/adjudicate/cases.ts`.

- [ ] **Step 3: Write `web/src/server/adjudicate/cases.ts`**

```typescript
// Firestore documents, in the shape the agents actually read.
//
// `inspector.py:parts` and `skeptic.py:parts` index into these dictionaries directly —
// case["field"]["key"], case["step"]["title"]. There is no adapter on the remote and no
// tolerance for a renamed key: it is a KeyError inside the engine, surfacing as a 500 that
// names nothing useful. So these builders are pure and tested against the keys the Python
// reaches for, and the Python is the authority whenever the two disagree.

export interface CaseSources {
  step: { id: string; title: string; explanation?: string; max_add_fields?: number };
  fieldDef: Record<string, any>;
  capture: Record<string, any>;
  job: Record<string, any>;
  strictness: number;
  addFieldsUsed: number;
  reading: { value: number; unit: string; source: string } | null;
  answer: string | null;
  mediaUris: string[];
  priorMediaUris: string[];
  asset: Record<string, any> | null;
}

const EXTENSION: Record<string, string> = {
  photo: "jpg",
  video: "mp4",
  scan: "jpg",
  audio: "m4a",
};

/** Where a capture's bytes live. Must agree with what the clients upload. */
export function mediaUri(
  bucket: string,
  capture: { id: string; kind: string },
  tenantId: string,
  jobId: string,
): string {
  const ext = EXTENSION[capture.kind] ?? "bin";
  return `gs://${bucket}/tenants/${tenantId}/jobs/${jobId}/captures/${capture.id}.${ext}`;
}

export function inspectorCase(a: CaseSources): Record<string, unknown> {
  return {
    step: {
      title: a.step.title,
      explanation: a.step.explanation ?? "",
      max_add_fields: a.step.max_add_fields ?? 2,
    },
    field: a.fieldDef,
    strictness: a.strictness,
    add_fields_used: a.addFieldsUsed,
    capture: {
      capture_surface: a.capture.capture_surface ?? "unknown",
      capture_mode: a.capture.capture_mode ?? "unknown",
    },
    // Present only when there is one. inspector.py checks `is not None`, and a null here
    // would print an instrument block about a reading that does not exist.
    ...(a.reading ? { reading: a.reading } : {}),
    ...(a.answer !== null ? { answer: a.answer } : {}),
    media: a.mediaUris,
  };
}

export function skepticCase(a: CaseSources): Record<string, unknown> {
  return {
    asset: a.asset ?? { id: a.job.asset_id ?? null },
    job: {
      id: a.job.id,
      procedure: a.job.procedure ?? a.job.procedure_id ?? null,
      opened_at: a.job.started_at ?? null,
      location: a.job.location ?? null,
    },
    capture: {
      kind: a.capture.kind,
      created_at: a.capture.created_at,
      capture_mode: a.capture.capture_mode,
      capture_surface: a.capture.capture_surface,
    },
    media: a.mediaUris,
    prior_media: a.priorMediaUris,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test web/scripts/cases.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/server/adjudicate/cases.ts web/scripts/cases.test.mjs
git commit -m "feat(web): build agent cases in the shape the fleet reads"
```

---

### Task 5: The route

Ties Tasks 2–4 to Firestore. This is the task that finally writes a `decisions` document.

**Files:**
- Create: `web/src/server/adjudicate/run.ts` — the work, callable from anywhere
- Create: `web/src/app/api/adjudicate/route.ts` — the HTTP skin
- Test: `web/scripts/adjudicate.test.mjs` (needs the Firestore emulator)
- Modify: `scripts/smoke.sh` — add the new test to the emulator batch in step 5

**Interfaces:**
- Consumes: `askFleet` (Task 2), `decideOutcome` (Task 3), `inspectorCase`/`skepticCase`/`mediaUri` (Task 4).
- Produces: `adjudicate(ref: AdjudicateRef, deps?: Deps): Promise<{ decisionIds: string[]; effect: Effect }>` where
```typescript
interface AdjudicateRef {
  tenantId: string; jobId: string; stepId: string; fieldKey: string; captureId: string;
}
interface Deps { ask?: typeof askFleet; db?: FirebaseFirestore.Firestore }
```

- [ ] **Step 1: Write the failing test**

```javascript
// web/scripts/adjudicate.test.mjs
//
// The spine, against a real Firestore. The fleet is faked — what is under test is that a
// verdict becomes a `decisions` document and the right step transition, not that Gemini
// can see a brake pad. A live fleet call is proven separately in Task 2 Step 7.
//
//   node --experimental-strip-types --test web/scripts/adjudicate.test.mjs
//
// Requires the Firestore emulator; scripts/smoke.sh starts it.

import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { adjudicate } from "../src/server/adjudicate/run.ts";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.GCP_PROJECT = "warrant-rules-test";

const TENANT = "acme.com";
const JOB = "job_9";

function fakeAsk(inspectorOut, skepticOut) {
  return async (agent) => ({
    output: agent === "inspector" ? inspectorOut : skepticOut,
    valid: true,
    schemaErrors: [],
    model: "gemini-3.5-flash",
    latencyMs: 1234,
    usage: { totalTokenCount: 900 },
  });
}

let db;
before(async () => {
  const { adminDb } = await import("../src/auth/admin.ts");
  db = adminDb();
  const job = db.doc(`tenants/${TENANT}/jobs/${JOB}`);
  await job.set({
    id: `${TENANT}/${JOB}`, tenant_id: TENANT, procedure_id: "front-brake-service",
    asset_id: "bike-04", strictness: 2, status: "open",
    started_at: "2026-08-21T09:00:00Z",
  });
  await job.collection("captures").doc("cap_1").set({
    id: "cap_1", field_id: "s3__pad_photo", kind: "photo", capture_mode: "live",
    capture_surface: "app", created_at: "2026-08-21T10:00:00Z", armor_verdict: null,
  });
  await job.collection("step_outcomes").doc("s3").set({
    id: "out_s3", job_id: `${TENANT}/${JOB}`, step_id: "s3", status: "pending",
    add_fields_used: 0,
  });
  await db.doc(`tenants/${TENANT}/procedure_versions/front-brake-service`).set({
    steps: [{ id: "s3", title: "Check pad wear", explanation: "Worn pads stop it less well.",
              max_add_fields: 2,
              fields: [{ key: "pad_photo", kind: "photo", prompt: "Photograph the pad edge",
                         source: "camera", acceptance_rule: "must_show" }] }],
  });
});

const REF = { tenantId: TENANT, jobId: JOB, stepId: "s3", fieldKey: "pad_photo",
              captureId: "cap_1" };

describe("adjudicate", () => {
  test("writes one decision per agent that answered", async () => {
    const result = await adjudicate(REF, {
      ask: fakeAsk({ verdict: "PASS", confidence: 0.9, rationale: "Pads clearly visible." },
                   { belongs: true, mismatch_kind: "none" }),
      db,
    });
    assert.equal(result.decisionIds.length, 2);

    const snap = await db.collection(`tenants/${TENANT}/decisions`)
      .where("job_id", "==", `${TENANT}/${JOB}`).get();
    const agents = snap.docs.map((d) => d.data().agent).sort();
    assert.deepEqual(agents, ["inspector", "skeptic"]);
  });

  test("a decision stamps the model and its cost", async () => {
    const snap = await db.collection(`tenants/${TENANT}/decisions`)
      .where("agent", "==", "inspector").limit(1).get();
    const d = snap.docs[0].data();
    assert.equal(d.model, "gemini-3.5-flash");
    assert.ok(typeof d.cost_usd === "number");
    assert.ok(d.rationale.length > 0);
  });

  test("a schema-invalid verdict writes the decision and moves no step", async () => {
    const before = (await db.doc(`tenants/${TENANT}/jobs/${JOB}/step_outcomes/s3`).get())
      .data().status;
    const result = await adjudicate(REF, {
      ask: async () => ({ output: { verdict: "PASS" }, valid: false,
                          schemaErrors: ["confidence: required by the contract and absent"],
                          model: "gemini-3.5-flash", latencyMs: 10, usage: null }),
      db,
    });
    assert.equal(result.effect.kind, "hold");
    const after = (await db.doc(`tenants/${TENANT}/jobs/${JOB}/step_outcomes/s3`).get())
      .data().status;
    assert.equal(after, before, "a malformed verdict must not advance a step");
  });

  test("the fleet being unreachable is recorded, not swallowed", async () => {
    const { FleetUnreachable } = await import("../src/server/fleet.ts");
    const result = await adjudicate(REF, {
      ask: async () => { throw new FleetUnreachable("fleet returned 403: denied",
                                                    "warrant-web@x.iam"); },
      db,
    });
    assert.equal(result.effect.kind, "hold");
    const snap = await db.collection(`tenants/${TENANT}/decisions`)
      .where("verdict", "==", "engine_unreachable").get();
    assert.ok(snap.size >= 1, "an unreachable fleet must leave a trace");
    assert.match(snap.docs[0].data().rationale, /warrant-web/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /home/mattricks/Code/google-hackathon && \
web/node_modules/.bin/firebase emulators:exec --project warrant-rules-test \
  --only firestore --config firebase.json \
  'cd web && node --experimental-strip-types --conditions=react-server \
     --import ./scripts/ts-resolve.mjs --test scripts/adjudicate.test.mjs'
```
Expected: FAIL — cannot resolve `../src/server/adjudicate/run.ts`.

- [ ] **Step 3: Write `web/src/server/adjudicate/run.ts`**

```typescript
import "server-only";

// Evidence in, decision out.
//
// Called by POST /api/adjudicate today, and by an Eventarc Firestore trigger later. It takes
// a capture REFERENCE and re-reads everything itself: a caller that could hand the Inspector
// its own copy of the acceptance rule could pass anything it liked.
//
// Runs under Admin credentials, which BYPASS firestore.rules — so the tenant must arrive
// from a verified session (the route's job), never from a request body.

import { randomUUID } from "node:crypto";
import { adminDb } from "@/auth/admin";
import { askFleet, FleetUnreachable, type FleetReply } from "@/server/fleet";
import { decideOutcome, type Effect } from "./outcome";
import { inspectorCase, skepticCase, mediaUri, type CaseSources } from "./cases";

export interface AdjudicateRef {
  tenantId: string;
  jobId: string;
  stepId: string;
  fieldKey: string;
  captureId: string;
}

export interface Deps {
  ask?: typeof askFleet;
  db?: FirebaseFirestore.Firestore;
}

/**
 * Rough, and labelled rough. Gemini 3.5 Flash list pricing, blended across input and output
 * because a decision that cost a tenth of a cent does not need a two-decimal breakdown — it
 * needs to be visible at all, so the operator view can total it.
 */
const USD_PER_1K_TOKENS = 0.0003;

function costOf(reply: FleetReply): number {
  const total = reply.usage?.totalTokenCount ?? 0;
  return Number(((total / 1000) * USD_PER_1K_TOKENS).toFixed(6));
}

const nowIso = () => new Date().toISOString();

export async function adjudicate(
  ref: AdjudicateRef,
  deps: Deps = {},
): Promise<{ decisionIds: string[]; effect: Effect }> {
  const db = deps.db ?? adminDb();
  const ask = deps.ask ?? askFleet;
  const scopedJobId = `${ref.tenantId}/${ref.jobId}`;

  const jobRef = db.doc(`tenants/${ref.tenantId}/jobs/${ref.jobId}`);
  const [jobSnap, capSnap, outSnap] = await Promise.all([
    jobRef.get(),
    jobRef.collection("captures").doc(ref.captureId).get(),
    jobRef.collection("step_outcomes").doc(ref.stepId).get(),
  ]);
  if (!jobSnap.exists) throw new Error(`no such job: ${scopedJobId}`);
  if (!capSnap.exists) throw new Error(`no such capture: ${ref.captureId}`);

  const job = jobSnap.data()!;
  const capture = { id: capSnap.id, ...capSnap.data()! };
  const outcome = outSnap.exists ? outSnap.data()! : { add_fields_used: 0 };

  // The pinned version, never the live procedure. A job is judged against the rules it
  // started under, and this is where that promise is either kept or quietly broken.
  const versionSnap = await db
    .doc(`tenants/${ref.tenantId}/procedure_versions/${job.procedure_id}`)
    .get();
  const version = versionSnap.exists ? versionSnap.data()! : { steps: [] };
  const step = (version.steps ?? []).find((s: any) => s.id === ref.stepId);
  if (!step) throw new Error(`step ${ref.stepId} is not in the pinned procedure version`);
  const fieldDef = (step.fields ?? []).find((f: any) => f.key === ref.fieldKey);
  if (!fieldDef) throw new Error(`field ${ref.fieldKey} is not declared on step ${ref.stepId}`);

  // A reading, if a paired instrument produced one. Server-written and server-read; the
  // client never gets to claim a number was measured.
  const readingSnap = await db
    .collection(`tenants/${ref.tenantId}/readings`)
    .where("field_id", "==", `${ref.stepId}__${ref.fieldKey}`)
    .limit(1)
    .get();
  const readingDoc = readingSnap.empty ? null : readingSnap.docs[0].data();

  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";
  const sources: CaseSources = {
    step,
    fieldDef,
    capture,
    job: { ...job, id: scopedJobId, procedure: job.procedure_id },
    strictness: job.strictness ?? 1,
    addFieldsUsed: outcome.add_fields_used ?? 0,
    reading: readingDoc
      ? { value: readingDoc.value, unit: readingDoc.unit,
          source: readingDoc.tool_id ? "instrument" : "human" }
      : null,
    answer: null,
    mediaUris: bucket ? [mediaUri(bucket, capture as any, ref.tenantId, ref.jobId)] : [],
    priorMediaUris: [],
    asset: job.asset_id ? { id: job.asset_id } : null,
  };

  const decisionIds: string[] = [];
  const write = async (agent: string, verdict: string, rationale: string,
                       reply: FleetReply | null) => {
    const id = randomUUID();
    await db.doc(`tenants/${ref.tenantId}/decisions/${id}`).set({
      id,
      job_id: scopedJobId,
      step_id: ref.stepId,
      agent,
      agent_version: process.env.WARRANT_FLEET_ENGINE?.split("/").pop() ?? "unknown",
      model: reply?.model ?? null,
      verdict,
      rationale,
      cost_usd: reply ? costOf(reply) : null,
      at: nowIso(),
    });
    decisionIds.push(id);
    return id;
  };

  let inspector: FleetReply;
  let skeptic: FleetReply | null = null;
  try {
    // Both questions at once. They are independent — one asks whether the evidence is good
    // enough, the other whether it is evidence of this machine.
    [inspector, skeptic] = await Promise.all([
      ask("inspector", inspectorCase(sources)),
      ask("skeptic", skepticCase(sources)),
    ]);
  } catch (error) {
    // Never silent. An unreachable fleet is a fact about this capture, and the §1.1 identity
    // trap makes a 403 look exactly like a model that does not exist.
    const principal = error instanceof FleetUnreachable ? error.principal : null;
    await write("inspector", "engine_unreachable",
      `The fleet could not be reached${principal ? ` as ${principal}` : ""}: ${
        error instanceof Error ? error.message : String(error)}`, null);
    return { decisionIds, effect: { kind: "hold", why: "the fleet could not be reached" } };
  }

  await write("inspector", String(inspector.output.verdict ?? "invalid"),
    String(inspector.output.rationale ?? inspector.schemaErrors.join("; ") ||
           "no rationale returned"), inspector);
  if (skeptic) {
    await write("skeptic", skeptic.output.belongs === true ? "BELONGS" : "DISSENT",
      String(skeptic.output.rationale ?? "no rationale returned"), skeptic);
  }

  const effect = decideOutcome({
    inspector: { output: inspector.output, valid: inspector.valid,
                 schemaErrors: inspector.schemaErrors },
    skeptic: skeptic ? { output: skeptic.output, valid: skeptic.valid } : null,
    addFieldsUsed: sources.addFieldsUsed,
    maxAddFields: step.max_add_fields ?? 2,
  });

  await applyEffect(db, ref, step, effect);
  return { decisionIds, effect };
}

/**
 * The only place a step moves.
 *
 * Provenance is untouched here and must stay that way: the Seal decides `measured` /
 * `specified` / `inferred` / `asserted`, recomputed from the server-written `readings`
 * collection. An Inspector PASS on a typed number still seals `asserted`.
 */
async function applyEffect(
  db: FirebaseFirestore.Firestore,
  ref: AdjudicateRef,
  step: any,
  effect: Effect,
): Promise<void> {
  const outRef = db.doc(
    `tenants/${ref.tenantId}/jobs/${ref.jobId}/step_outcomes/${ref.stepId}`);

  if (effect.kind === "accept_field") {
    const required = (step.fields ?? []).filter((f: any) => f.required_at_strictness !== null);
    await outRef.set({ status: required.length <= 1 ? "performed" : "pending",
                       adjudicated_at: nowIso() }, { merge: true });
    return;
  }

  if (effect.kind === "add_field") {
    await outRef.set({
      status: "pending",
      add_fields_used: (await outRef.get()).data()?.add_fields_used ?? 0,
      adjudicated_at: nowIso(),
    }, { merge: true });
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(outRef);
      tx.set(outRef, {
        add_fields_used: (snap.data()?.add_fields_used ?? 0) + 1,
        added_fields: [
          ...(snap.data()?.added_fields ?? []),
          { key: effect.key, kind: effect.fieldKind, prompt: effect.prompt,
            source: "camera", added_at: nowIso() },
        ],
      }, { merge: true });
    });
    return;
  }

  if (effect.kind === "escalate") {
    await outRef.set({ status: "escalated", escalation_question: effect.question,
                       adjudicated_at: nowIso() }, { merge: true });
    return;
  }

  // hold — the step does not move, and the reason is on the record.
  await outRef.set({ hold_reason: effect.why, adjudicated_at: nowIso() }, { merge: true });
}
```

- [ ] **Step 4: Write `web/src/app/api/adjudicate/route.ts`**

```typescript
// Wake the fleet for one capture.
//
// Deliberately reference-only: { tenant_id, job_id, step_id, field_key, capture_id }. The
// handler re-reads every fact from Firestore, so nothing a caller asserts can change what
// the Inspector is shown.
//
// It does not care WHO woke it. A client calls it fire-and-forget after writing a capture;
// the sweep calls it for anything a dead client left behind; an Eventarc Firestore trigger
// can call it later without this file changing shape.

import { NextResponse } from "next/server";
import { requireTenant } from "@/auth/session";
import { adjudicate } from "@/server/adjudicate/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  job_id?: string;
  step_id?: string;
  field_key?: string;
  capture_id?: string;
}

/** The cron has no session. Same lock the sweep already uses. */
function fromSweep(request: Request): boolean {
  const expected = process.env.WARRANT_SWEEP_SECRET;
  if (!expected) return false;
  return request.headers.get("x-warrant-sweep") === expected;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { job_id, step_id, field_key, capture_id } = body;
  if (!job_id || !step_id || !field_key || !capture_id) {
    return NextResponse.json(
      { error: "job_id, step_id, field_key and capture_id are all required." },
      { status: 400 },
    );
  }

  // `acme.com/job_9` — the tenant is IN the job id, and it must match the session's tenant
  // or this is a cross-tenant read dressed up as an adjudication request.
  const slash = job_id.indexOf("/");
  if (slash <= 0) {
    return NextResponse.json({ error: "job_id must be tenant-scoped." }, { status: 400 });
  }
  const tenantId = job_id.slice(0, slash);
  const bareJobId = job_id.slice(slash + 1);

  if (!fromSweep(request)) {
    let session;
    try {
      session = await requireTenant();
    } catch {
      return NextResponse.json({ error: "Not authorised." }, { status: 401 });
    }
    if (session.tenantId !== tenantId) {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }
  }

  try {
    const result = await adjudicate({
      tenantId, jobId: bareJobId, stepId: step_id,
      fieldKey: field_key, captureId: capture_id,
    });
    // 202: the verdict is already written, but the technician learns through their snapshot
    // listener, not through this response. No screen waits on this call.
    return NextResponse.json(
      { decisions: result.decisionIds, effect: result.effect.kind },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Adjudication failed.", detail: String(error) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
cd /home/mattricks/Code/google-hackathon && \
web/node_modules/.bin/firebase emulators:exec --project warrant-rules-test \
  --only firestore --config firebase.json \
  'cd web && node --experimental-strip-types --conditions=react-server \
     --import ./scripts/ts-resolve.mjs --test scripts/adjudicate.test.mjs'
```
Expected: PASS, 4 tests.

- [ ] **Step 6: Add the test to `scripts/smoke.sh`**

In step 5's `emulators:exec` command string, append the new test to the existing `cd web && node ...` line so it reads:

```bash
      'node --experimental-strip-types --test web/scripts/rules.test.mjs
       cd web && node --experimental-strip-types --conditions=react-server \
         --import ./scripts/ts-resolve.mjs --test scripts/live-source.test.mjs scripts/adjudicate.test.mjs'
```

Also add the pure tests to step 3, after `npx tsc --noEmit`:

```bash
node --experimental-strip-types --test scripts/outcome.test.mjs scripts/cases.test.mjs scripts/fleet.test.mjs
echo "ok — the outcome table, the case builders and the fleet client hold"
```

- [ ] **Step 7: Typecheck**

Run: `cd web && npm run check`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/server/adjudicate/run.ts web/src/app/api/adjudicate/route.ts \
        web/scripts/adjudicate.test.mjs scripts/smoke.sh
git commit -m "feat(web): adjudicate a capture and write what the fleet decided"
```

---

### Task 6: Wire the surfaces and the safety net

Nothing calls the route yet. Give it its two callers.

**Files:**
- Modify: `web/src/data/live-source.ts` — after `capture()` commits
- Modify: `web/src/server/tasks.ts` — add `undecidedCaptures()`
- Modify: `web/src/app/api/tasks/sweep/route.ts` — drive them
- Test: `web/scripts/adjudicate.test.mjs` — add the sweep query test

**Interfaces:**
- Consumes: `adjudicate` (Task 5).
- Produces: `undecidedCaptures(olderThanMs: number): Promise<AdjudicateRef[]>`

- [ ] **Step 1: Write the failing test**

Append to `web/scripts/adjudicate.test.mjs`:

```javascript
describe("undecidedCaptures", () => {
  test("finds a capture older than the window with no decision", async () => {
    const { undecidedCaptures } = await import("../src/server/tasks.ts");
    const job = db.doc(`tenants/${TENANT}/jobs/${JOB}`);
    await job.collection("captures").doc("cap_orphan").set({
      id: "cap_orphan", field_id: "s3__pad_photo", kind: "photo", capture_mode: "live",
      capture_surface: "app", adjudicated: false,
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    const found = await undecidedCaptures(2 * 60 * 1000);
    assert.ok(found.some((r) => r.captureId === "cap_orphan"),
      "a capture whose client died must be found by the sweep");
  });

  test("does not re-drive a capture already adjudicated", async () => {
    const { undecidedCaptures } = await import("../src/server/tasks.ts");
    const found = await undecidedCaptures(2 * 60 * 1000);
    assert.ok(!found.some((r) => r.captureId === "cap_1"),
      "cap_1 was adjudicated in an earlier test and must not be picked up again");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run the emulator command from Task 5 Step 5.
Expected: FAIL — `undecidedCaptures` is not exported from `tasks.ts`.

- [ ] **Step 3: Mark captures adjudicated in `run.ts`**

In `web/src/server/adjudicate/run.ts`, at the end of `adjudicate()` just before the return, add:

```typescript
  // The sweep's flag. Set after the decisions are written, so a crash mid-adjudication
  // leaves the capture eligible to be picked up again rather than silently undecided.
  await jobRef.collection("captures").doc(ref.captureId)
    .set({ adjudicated: true, adjudicated_at: nowIso() }, { merge: true });
```

And in the `catch` branch for `FleetUnreachable`, do **not** set the flag — an unreachable fleet must stay eligible for the sweep to retry.

- [ ] **Step 4: Add `undecidedCaptures` to `web/src/server/tasks.ts`**

```typescript
/**
 * Captures nobody adjudicated.
 *
 * The cost of letting a client trigger adjudication is that a client which dies between
 * writing the capture and making the call leaves evidence in limbo. This is the net. It is
 * a COLLECTION_GROUP query on `captures`, which needs the matching index deployed —
 * `dueTasks()` above has the same requirement and the same failure mode.
 */
export async function undecidedCaptures(olderThanMs: number): Promise<{
  tenantId: string; jobId: string; stepId: string; fieldKey: string; captureId: string;
}[]> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const snap = await adminDb()
    .collectionGroup("captures")
    .where("adjudicated", "==", false)
    .where("created_at", "<", cutoff)
    .limit(50)
    .get();

  return snap.docs.flatMap((doc) => {
    // tenants/{t}/jobs/{j}/captures/{c}
    const parts = doc.ref.path.split("/");
    const tenantId = parts[1];
    const jobId = parts[3];
    const fieldId = String(doc.data().field_id ?? "");
    const split = fieldId.indexOf("__");
    if (split <= 0) return [];
    return [{
      tenantId, jobId,
      stepId: fieldId.slice(0, split),
      fieldKey: fieldId.slice(split + 2),
      captureId: doc.id,
    }];
  });
}
```

- [ ] **Step 5: Set `adjudicated: false` when a capture is written**

In `web/src/data/live-source.ts`, in the `capture` object literal (around line 259-274), add the field beside `armor_verdict`:

```typescript
      armor_verdict: null,
      // The sweep's flag. False, not absent — Firestore cannot query for a missing field,
      // so a capture written without this is invisible to the safety net.
      adjudicated: false,
      created_at: now(),
```

- [ ] **Step 6: Call the route after a capture commits**

In `web/src/data/live-source.ts`, immediately after `await batch.commit();` in `capture()`:

```typescript
    // Fire and forget. The technician's screen advances now and learns the verdict through
    // its snapshot listener; making them wait on a model would defeat the entire seam. A
    // failure here is not fatal — the sweep finds anything this call did not.
    void fetch("/api/adjudicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: input.jobId, step_id: input.stepId,
        field_key: input.fieldKey, capture_id: capRef.id,
      }),
    }).catch(() => {});
```

- [ ] **Step 7: Drive undecided captures from the sweep**

In `web/src/app/api/tasks/sweep/route.ts`, import at the top:

```typescript
import { dueTasks, markNotified, attachCalendarEvent, undecidedCaptures } from "@/server/tasks";
import { adjudicate } from "@/server/adjudicate/run";
```

And after the `for (const task of tasks)` loop, before the response:

```typescript
  // Evidence whose client died before it could ask for a verdict. Two minutes is long enough
  // that a live client has certainly had its chance, and short enough that a technician who
  // is still standing at the machine gets an answer while it matters.
  let adjudicated = 0;
  for (const ref of await undecidedCaptures(2 * 60 * 1000)) {
    try {
      await adjudicate(ref);
      adjudicated += 1;
    } catch {
      // Left undecided on purpose — the next sweep tries again. A capture that can never be
      // adjudicated must keep showing up rather than being marked done to tidy the query.
    }
  }
```

Add `adjudicated` to the JSON response body alongside `pushed`, `scheduled` and `deferred`.

- [ ] **Step 8: Add the collection-group index**

In `firestore.indexes.json`, add to `indexes`:

```json
    {
      "collectionGroup": "captures",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "adjudicated", "order": "ASCENDING" },
        { "fieldPath": "created_at", "order": "ASCENDING" }
      ]
    }
```

- [ ] **Step 9: Run the tests to verify they pass**

Run the emulator command from Task 5 Step 5.
Expected: PASS, 6 tests.

- [ ] **Step 10: Full smoke**

Run: `./scripts/smoke.sh`
Expected: every step passes or reports a documented skip. Step 3 now also runs the three pure test files; step 5 also runs `adjudicate.test.mjs`.

- [ ] **Step 11: Commit**

```bash
git add web/src/data/live-source.ts web/src/server/tasks.ts \
        web/src/app/api/tasks/sweep/route.ts web/src/server/adjudicate/run.ts \
        web/scripts/adjudicate.test.mjs firestore.indexes.json
git commit -m "feat(web): every capture reaches the fleet, and the sweep catches the ones that don't"
```

- [ ] **Step 12: Deploy the index**

Run: `./infra/deploy-rules.sh`
Expected: rules and indexes deploy. The collection-group index takes a few minutes to build; until it does, `undecidedCaptures` fails with a link to create it — which is why `dueTasks()` already reports that failure explicitly rather than returning nothing.

---

## What this plan does NOT do

Stated so the next plan starts from the truth rather than an assumption:

- **Model Armor** is not called. `armor_verdict` stays `null` on the web — honest — and stays hardcoded to `"NO_MATCH_FOUND"` on Android, which is not. Android is Plan 2; Model Armor is Plan 3.
- **Android reaches none of this.** It is still `FixtureSource` and has no network code. Plan 2.
- **Attestation** is untouched. Plan 3.
- **The Skeptic gets no prior media**, so reuse detection cannot fire yet — `priorMediaUris` is always empty. It needs a query over earlier captures for the same asset, which is worth its own task once assets are real.
- **The blocked flow** — Instructor → Foreman — is not wired. `declareBlocked` still writes an outcome nobody adjudicates.
- **`accept_field` advances a step on a simplification**: it marks the step performed when one required field exists. A multi-field step needs every required field checked, which needs the fields subcollection read back. Flagged here rather than left to be discovered.
