import Link from "next/link";
import { Ground, Wrap, Rule, AgentStamp, type AgentName } from "@/components";
import { fleetSummary } from "@/server/operator";

// The operator view: what the fleet has decided, across every tenant.
//
// Every row here is a real decision a real agent made about real evidence. Nothing on this
// page is generated to make it look busy — which is the whole reason it is worth showing.
// An operator view padded with plausible rows would be the same tick in the box the product
// exists to abolish, and it would be that on the one screen that claims scale.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENTS: AgentName[] = [
  "scoper", "foreman", "inspector", "skeptic", "auditor", "instructor", "wright",
];

function money(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(2)}`;
}

function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86_400)}d ago`;
}

export default async function Fleet() {
  const summary = await fleetSummary();

  return (
    <Ground tone="work">
      <div className="app">
        <header className="topbar">
          <Link className="topbar__logo" href="/"><i aria-hidden />Warrant</Link>
          <nav className="topbar__nav">
            <Link href="/about">What this is for</Link>
          </nav>
        </header>

        <main className="page__body">
          <Wrap>
            <div className="stack stack--lg">
              <div className="stack">
                <p className="eyebrow">Operate</p>
                <h1 className="hero">What the fleet decided</h1>
                <p className="lede">
                  Every row is a decision an agent made about evidence somebody captured.
                  Nothing here is generated to fill the page — when the fleet has decided
                  nothing, this screen says so.
                </p>
              </div>

              <Rule />

              {summary.failed ? (
                <div className="stack">
                  <h2>The decision log could not be read</h2>
                  <p className="lede">
                    This is not an idle fleet — it is a query that failed, and the two look
                    identical from the outside, which is why it is said out loud.
                  </p>
                  <pre className="fleet__fail">{summary.failure}</pre>
                </div>
              ) : summary.totalDecisions === 0 ? (
                <div className="stack">
                  <h2>Nothing decided yet</h2>
                  <p className="lede">
                    The fleet is deployed and reachable. No evidence has been put in front of
                    it. Run a task and this fills up on its own.
                  </p>
                  <p><Link href="/">Run a task</Link></p>
                </div>
              ) : (
                <>
                  <section className="stack">
                    <div className="fleet__stats">
                      <Stat label="decisions" value={String(summary.totalDecisions)} />
                      <Stat label="spent on models" value={money(summary.totalCostUsd)} />
                      <Stat label="tenants" value={String(summary.tenants)} />
                      <Stat label="agents that ruled" value={String(summary.byAgent.length)} />
                    </div>
                    {summary.unreachable > 0 && (
                      <p className="fleet__note">
                        {summary.unreachable} of these record the fleet being unreachable. They
                        are counted, not hidden — a capture nobody could rule on is a fact
                        about the record.
                      </p>
                    )}
                  </section>

                  <Rule />

                  <section className="stack">
                    <h2>Who ruled</h2>
                    <div className="fleet__chips">
                      {AGENTS.filter((a) => summary.byAgent.some((x) => x.agent === a)).map(
                        (agent) => {
                          const row = summary.byAgent.find((x) => x.agent === agent)!;
                          return (
                            <span key={agent} className="fleet__chip">
                              <AgentStamp agent={agent} />
                              {agent} · {row.count} · {money(row.costUsd)}
                            </span>
                          );
                        },
                      )}
                    </div>
                  </section>

                  <section className="stack">
                    <h2>What they said</h2>
                    <div className="fleet__chips">
                      {summary.byVerdict.map((v) => (
                        <span key={v.verdict} className="fleet__chip">
                          {v.verdict} · {v.count}
                        </span>
                      ))}
                    </div>
                  </section>

                  <section className="stack">
                    <h2>Which models, and what they cost</h2>
                    <div className="fleet__chips">
                      {summary.byModel.map((m) => (
                        <span key={m.model} className="fleet__chip">
                          {m.model} · {m.count} · {money(m.costUsd)}
                        </span>
                      ))}
                    </div>
                  </section>

                  <Rule />

                  <section className="stack">
                    <h2>The log</h2>
                    <div className="fleet__log">
                      {summary.rows.map((r) => (
                        <div key={r.id} className="fleet__entry">
                          <div className="fleet__head">
                            {AGENTS.includes(r.agent as AgentName) && (
                              <AgentStamp agent={r.agent as AgentName} />
                            )}
                            <span>
                              {r.agent} · {r.verdict} · {r.model ?? "deterministic"} ·{" "}
                              {money(r.costUsd ?? 0)} · {ago(r.at)}
                            </span>
                          </div>
                          <p className="fleet__why">{r.rationale}</p>
                          <p className="fleet__where">
                            {r.tenantId} · {r.jobId}
                            {r.stepId ? ` · ${r.stepId}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          </Wrap>
        </main>
      </div>
    </Ground>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="fleet__stat">
      <span className="fleet__statv">{value}</span>
      <span className="fleet__statl">{label}</span>
    </div>
  );
}
