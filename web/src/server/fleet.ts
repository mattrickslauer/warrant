import "server-only";

// The one place that speaks to the deployed fleet.
//
// Warrant's agents run on Vertex AI Agent Engine, deployed by `infra/deploy-agents.py`. They
// are authored in Python, under `agents/warrant/`, and that is the single statement of every
// prompt in this system. This file CALLS them. It must never restate one — a prompt that
// existed in two languages would drift, and the eval corpus would then be evidence about a
// prompt no surface actually sends.
//
// THE REPLY IS DOUBLE-NESTED. `reasoningEngines:query` wraps the operation's return value in
// its own `output`, and the operation itself returns a dict with an `output` key holding the
// verdict. So the verdict is at `body.output.output`. Reading `body.output` instead yields an
// object with `model`, `usage` and `valid` on it — entirely plausible, and missing the only
// field that matters.

import { GoogleAuth, Impersonated, type AuthClient } from "google-auth-library";

const HOST = "https://us-central1-aiplatform.googleapis.com";

/**
 * What one attempt at the fleet is allowed to take, by default.
 *
 * `agents/warrant/model.py` gives a single Gemini call CALL_TIMEOUT seconds and then retries
 * it. THIS NUMBER MUST NEVER EQUAL THAT ONE. It used to, on purpose — the comment here said
 * so — and the equality is the whole defect: aborting at the same instant the inner call does
 * means the engine's retry can never run, because the caller has already walked away. What
 * looked like a stalled endpoint was this side hanging up on the recovery.
 *
 * 45s stays right for a person standing at a machine, so it stays the default and
 * `adjudicate/run.ts` is unchanged. Callers who can afford to wait for the retry ask for
 * longer — see INTERVIEW_TIMEOUT_MS.
 */
const DEFAULT_FLEET_TIMEOUT_MS = 45_000;

/**
 * What the Scoper interview is allowed to take.
 *
 * Long enough to contain one full stall-and-retry inside the engine — its call budget, its
 * transport backoff, then a second call — because nobody authoring a procedure at a desk is
 * served by failing fast. A 22-minute authoring session was lost to the old budget: the
 * turns get slower as the transcript grows, so the last question of a long interview is
 * exactly where the two equal timeouts collided.
 *
 * Cloud Run's own request timeout is 300s and `deploy-web.sh` does not lower it, so this
 * sits well inside the outermost bound rather than racing it.
 */
export const INTERVIEW_TIMEOUT_MS = 120_000;

/**
 * The budget for one attempt: what the caller asked for, else the environment, else the
 * default. Exported because "these two numbers may not be equal" is a rule worth a test.
 */
export function fleetTimeoutMs(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) return override;
  const fromEnv = Number(process.env.WARRANT_FLEET_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_FLEET_TIMEOUT_MS;
}

/** What a caller may vary about one call to the fleet. */
export interface FleetOptions {
  /** Milliseconds for one attempt. Omitted means the mechanic's default. */
  timeoutMs?: number;
}
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * The two statuses that are not about the request.
 *
 * 429 is Vertex's per-minute ceiling on `reasoningEngines:query`: the minute was full, and it
 * empties on its own whether or not anything here changes. 503 is Agent Engine's own, returned
 * while a replica is coming back up. Every other failure means what it says and will mean the
 * same thing a second later, so retrying one only makes the report slower.
 */
const RETRYABLE = new Set([429, 503]);

/**
 * Two retries, and short ones.
 *
 * `agents/warrant/model.py` waits a full minute out for the same refusal, and is right to:
 * nobody is watching an eval run. This is the opposite situation. A mechanic is standing at
 * the machine holding a phone, and failing here is already safe — `run.ts` records the reason
 * on the decision and leaves the capture held for the next sweep. So the budget is what a
 * person will stand still for, and past that, holding beats hanging.
 */
const BACKOFF_MS = [1_000, 4_000];

/**
 * The ladder, with a seam in it for the tests.
 *
 * Proving that a 429 is climbed and a 403 is not should not cost five real seconds on every
 * run, and a suite that sleeps to pass is a suite people start skipping. Comma-separated
 * milliseconds; empty disables retrying altogether, which is also a legitimate thing to want
 * from an operator who would rather hold than wait.
 */
function backoff(): number[] {
  const override = process.env.WARRANT_FLEET_BACKOFF_MS;
  if (override === undefined) return BACKOFF_MS;
  return override.split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
}

/** The ceiling on any single wait, including one the server asked for in `retry-after`. */
const MAX_WAIT_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * What the server said to wait, if it said anything.
 *
 * Optional at every step deliberately. `fetchImpl` is a test seam, and the fakes driving these
 * tests are object literals with no `headers` on them at all — reaching through that blindly
 * would throw a TypeError inside the handler for a 429, which is a failure invented by the
 * code that exists to survive one.
 */
export function retryAfterMs(
  response: { headers?: { get?: (name: string) => string | null } },
): number | null {
  const raw = response.headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1_000, MAX_WAIT_MS);
}

export interface FleetReply {
  output: Record<string, unknown>;
  valid: boolean;
  schemaErrors: string[];
  model: string | null;
  latencyMs: number;
  usage: { totalTokenCount?: number } | null;
  /**
   * Whether the remote judged this answer strong enough to act on. Only the `screen`
   * operation sets it; `query` leaves it undefined, because an agent's verdict is acted on
   * by `decideOutcome` and never by the agent itself.
   */
  actsOn?: boolean;
}

/**
 * The fleet could not be reached, or refused us.
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
 * This is impersonation, NOT `clientOptions.subject` — that field is domain-wide delegation
 * for Workspace users and silently does nothing for a service account.
 *
 * Unset, the caller is plain ADC, which is what a developer has locally.
 */
async function authClient(): Promise<{ client: AuthClient; principal: string | null }> {
  if (cached) return cached;
  const source = await new GoogleAuth({ scopes: [SCOPE] }).getClient();
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

/** Test seam only. The credential is cached per process; a test that changes the principal
 *  has to be able to say so. */
export function resetFleetAuth(): void {
  cached = null;
}

export async function askFleet(
  agent: string,
  kase: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  options: FleetOptions = {},
): Promise<FleetReply> {
  return callFleet("query", { agent, case: kase }, fetchImpl, options);
}

/**
 * The screen, on one capture, before the judge is asked.
 *
 * A separate operation rather than another agent name through `askFleet`, because the screen
 * is not one of the seven — `roster()` says seven and `REGISTRY` does not contain it. See
 * `agents/warrant/screen.py` for why the cheap model is deliberately on the side of the
 * decision where being wrong costs a retake rather than a released machine.
 *
 * `actsOn` comes back from the remote, which applies the same floor `screen.ts` states here.
 * Both are read: the remote's answer is treated as advice and re-checked locally, because a
 * capture must not be short-circuited on the strength of a field the caller never validated.
 */
export async function askScreen(
  kase: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<FleetReply> {
  return callFleet("screen", { case: kase }, fetchImpl);
}

/**
 * One query, bounded in time and retried only where retrying can help.
 *
 * A TIMEOUT, which this call did not have.
 *
 * `armor.ts` and the calendar callback both bound their fetches and this one did not, which
 * made the fleet the only unbounded wait in the system — and it is the slowest thing in it.
 * A Vertex call that stalls held the whole Cloud Run request open until the platform killed
 * it, and the sweep makes that compound: it adjudicates up to fifty captures in one request,
 * so one hung call could consume the entire sweep's budget and every capture behind it went
 * unjudged.
 *
 * `agents/warrant/model.py` already made this argument and chose 45 seconds for the same
 * endpoint — "a healthy structured-output call answers in about five seconds; this endpoint
 * instead stalls outright now and then". This is the TypeScript half of that decision, and it
 * is deliberately the same number rather than a new opinion about the same API.
 *
 * Each attempt gets its own fresh signal, because a budget shared across retries would mean
 * the second attempt inherited whatever the first one had already spent and was aborted for
 * being slow when it had barely started.
 *
 * A non-ok response is RETURNED, not thrown, once there is no point trying again — the caller
 * owns the wording of that failure and reads the body for it, and reading the body here would
 * consume it out from under them.
 */
async function attempt(
  url: string,
  init: RequestInit,
  principal: string | null,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  const ladder = backoff();
  for (let n = 0; ; n++) {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // An abort and a network failure are the same thing to the caller: the fleet did not
      // answer. Both are FleetUnreachable so `/api/scoper/turn` returns its 503 and the sweep
      // leaves the capture undecided to be retried, rather than either dying with a 500.
      throw new FleetUnreachable(`the fleet did not answer: ${String(error)}`, principal);
    }
    if (response.ok || !RETRYABLE.has(response.status) || n >= ladder.length) return response;
    await sleep(retryAfterMs(response) ?? ladder[n]);
  }
}

async function callFleet(
  classMethod: "query" | "screen",
  input: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  options: FleetOptions = {},
): Promise<FleetReply> {
  const engine = process.env.WARRANT_FLEET_ENGINE;
  if (!engine) {
    throw new FleetUnreachable(
      "WARRANT_FLEET_ENGINE is not set — deploy with infra/deploy-agents.py and put the " +
        "resource name it prints into the environment.",
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

  const response = await attempt(
    `${HOST}/v1/${engine}:query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ classMethod, input }),
    },
    principal,
    fetchImpl,
    fleetTimeoutMs(options.timeoutMs),
  );

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
    throw new FleetUnreachable(
      "fleet reply had no output envelope — the operation may have raised on the remote",
      principal,
    );
  }

  return {
    output: (envelope.output ?? {}) as Record<string, unknown>,
    valid: Boolean(envelope.valid),
    schemaErrors: Array.isArray(envelope.schema_errors) ? envelope.schema_errors : [],
    model: typeof envelope.model === "string" ? envelope.model : null,
    latencyMs: typeof envelope.latency_ms === "number" ? envelope.latency_ms : 0,
    usage: (envelope.usage ?? null) as FleetReply["usage"],
    ...(typeof envelope.acts_on === "boolean" ? { actsOn: envelope.acts_on } : {}),
  };
}
