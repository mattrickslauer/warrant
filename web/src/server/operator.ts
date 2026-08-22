import "server-only";

// What the fleet has actually decided, across every tenant.
//
// This reads REAL decisions and nothing else. The temptation on an operator view is to pad it
// with plausible rows so the screen looks busy, and that would be the same fabrication this
// product exists to abolish — worse here, because this is the screen that claims scale.
//
// If it is empty, it says so. An honest empty operator view is a truthful statement about a
// system nobody has used yet.

import { adminDb } from "@/auth/admin";

export interface DecisionRow {
  id: string;
  tenantId: string;
  jobId: string;
  stepId: string | null;
  agent: string;
  agentVersion: string;
  model: string | null;
  verdict: string;
  rationale: string;
  costUsd: number | null;
  at: string;
}

export interface FleetSummary {
  rows: DecisionRow[];
  totalDecisions: number;
  totalCostUsd: number;
  byAgent: Array<{ agent: string; count: number; costUsd: number }>;
  byVerdict: Array<{ verdict: string; count: number }>;
  byModel: Array<{ model: string; count: number; costUsd: number }>;
  tenants: number;
  /** Decisions that record the fleet being unreachable. Shown, never hidden. */
  unreachable: number;
  /** True when the query itself could not run — distinct from a fleet that has decided nothing. */
  failed: boolean;
  failure: string | null;
}

const EMPTY: FleetSummary = {
  rows: [], totalDecisions: 0, totalCostUsd: 0, byAgent: [], byVerdict: [], byModel: [],
  tenants: 0, unreachable: 0, failed: false, failure: null,
};

/**
 * Every decision, newest first.
 *
 * A COLLECTION_GROUP query, because the operator watches the whole estate rather than one
 * tenant — this is the one read in the system that is deliberately cross-tenant, and it is
 * server-side and unauthenticated to no one: the page above it decides who may look.
 */
export async function fleetSummary(limit = 200): Promise<FleetSummary> {
  let snap;
  try {
    snap = await adminDb()
      .collectionGroup("decisions")
      .orderBy("at", "desc")
      .limit(limit)
      .get();
  } catch (error) {
    // Distinguished from "nothing has been decided". A missing index reads exactly like an
    // idle fleet, and an operator view that cannot tell the difference is worse than none.
    return { ...EMPTY, failed: true, failure: String(error) };
  }

  const rows: DecisionRow[] = snap.docs.map((doc) => {
    const d = doc.data();
    // tenants/{t}/decisions/{id}
    const tenantId = doc.ref.parent.parent?.id ?? "unknown";
    return {
      id: doc.id,
      tenantId,
      jobId: String(d.job_id ?? ""),
      stepId: d.step_id ?? null,
      agent: String(d.agent ?? "unknown"),
      agentVersion: String(d.agent_version ?? "unknown"),
      model: d.model ?? null,
      verdict: String(d.verdict ?? ""),
      rationale: String(d.rationale ?? ""),
      costUsd: typeof d.cost_usd === "number" ? d.cost_usd : null,
      at: String(d.at ?? ""),
    };
  });

  const tally = <K extends string>(
    key: (r: DecisionRow) => K,
    withCost: boolean,
  ) => {
    const m = new Map<string, { count: number; costUsd: number }>();
    for (const r of rows) {
      const k = key(r);
      const cur = m.get(k) ?? { count: 0, costUsd: 0 };
      cur.count += 1;
      if (withCost) cur.costUsd += r.costUsd ?? 0;
      m.set(k, cur);
    }
    return [...m.entries()]
      .map(([k, v]) => ({ k, ...v }))
      .sort((a, b) => b.count - a.count);
  };

  return {
    rows,
    totalDecisions: rows.length,
    totalCostUsd: rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
    byAgent: tally((r) => r.agent, true).map(({ k, count, costUsd }) => ({ agent: k, count, costUsd })),
    byVerdict: tally((r) => r.verdict, false).map(({ k, count }) => ({ verdict: k, count })),
    byModel: tally((r) => r.model ?? "deterministic", true)
      .map(({ k, count, costUsd }) => ({ model: k, count, costUsd })),
    tenants: new Set(rows.map((r) => r.tenantId)).size,
    unreachable: rows.filter((r) => r.verdict === "engine_unreachable").length,
    failed: false,
    failure: null,
  };
}
