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
  };
}
