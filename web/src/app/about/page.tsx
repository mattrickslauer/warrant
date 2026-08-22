import Link from "next/link";
import { Ground, Wrap, Rule, EvidenceChip, AgentStamp, type AgentName } from "@/components";

// The B2B explainer. `/` is the product; this is what the product is for.
// Deliberately not a marketing page — it answers, for someone who just cut a banana on a
// website, what this does for a business with machines and liability.

const FLEET: Array<{ agent: AgentName; name: string; job: string }> = [
  { agent: "scoper", name: "Scoper", job: "Interviews you until a procedure is unambiguous, then compiles and versions it." },
  { agent: "foreman", name: "Foreman", job: "Owns one job for its whole life. Delegates, chases, re-opens, escalates — and disposes of a step nobody could do." },
  { agent: "inspector", name: "Inspector", job: "Passes a step, asks for more evidence, or escalates to a person. Never fails silently." },
  { agent: "skeptic", name: "Skeptic", job: "Does this evidence belong to this job, this machine, this moment? It never sees the Inspector's conclusion." },
  { agent: "auditor", name: "Auditor", job: "Sweeps sealed records across weeks and finds the procedure defects hiding in them." },
  { agent: "instructor", name: "Instructor", job: "Answers on a held button while hands are busy — and can amend the job." },
  { agent: "wright", name: "Wright", job: "Meets an unfamiliar instrument, works out how it speaks, and writes the driver itself." },
];

export default function About() {
  return (
    <Ground tone="work">
      <div className="app">
        <header className="topbar">
          <Link className="topbar__logo" href="/"><i aria-hidden />Warrant</Link>
          <nav className="topbar__nav"><Link href="/">Try a task</Link></nav>
        </header>

        <main className="page__body">
          <Wrap>
            <div className="stack stack--lg">
              <div className="stack">
                <p className="eyebrow">What this is for</p>
                <h1 className="hero">Maintenance records that are evidence, not paperwork.</h1>
                <p className="lede">
                  Somewhere right now a technician is ticking a box that says the brakes were
                  checked. The record says so either way, because the record is a tick in a box —
                  a claim by an interested party, stored in a system designed to accept it.
                </p>
              </div>

              <Rule />

              <div className="stack">
                <p className="eyebrow">The two frames</p>
                <p className="lede">
                  Aviation solved this with a legally binding logbook and licensed sign-offs. It
                  works, and it is affordable only because the airframe underneath is worth tens of
                  millions. Meanwhile a courier proves an unsupervised delivery in four seconds for
                  pennies — because the worker never decides what evidence to capture, the proof is
                  a gate rather than a form field, and the flow branches when reality disagrees.
                </p>
                <p className="lede">
                  <strong>Aviation set the standard. Delivery worked out the price.</strong>
                </p>
              </div>

              <Rule />

              <div className="stack">
                <p className="eyebrow">What a class means</p>
                <div className="gallery__row">
                  <EvidenceChip cls="measured" />
                  <span className="lede" style={{ fontSize: "var(--t-sm)" }}>a reading from a paired instrument — no human hands</span>
                </div>
                <div className="gallery__row">
                  <EvidenceChip cls="specified" />
                  <span className="lede" style={{ fontSize: "var(--t-sm)" }}>a figure cited from the manufacturer, with document and page</span>
                </div>
                <div className="gallery__row">
                  <EvidenceChip cls="inferred" />
                  <span className="lede" style={{ fontSize: "var(--t-sm)" }}>what a model concluded from a photograph</span>
                </div>
                <div className="gallery__row">
                  <EvidenceChip cls="asserted" />
                  <span className="lede" style={{ fontSize: "var(--t-sm)" }}>a person said so, by name</span>
                </div>
                <p className="lede">
                  They never blur. An inferred value may never overwrite a measured one, and that
                  rule lives in the acceptance logic rather than in a prompt.
                </p>
              </div>

              <Rule />

              <div className="stack">
                <p className="eyebrow">Seven agents over a deterministic core</p>
                <div className="w-trace">
                  {FLEET.map((a) => (
                    <div className="w-trace__row" key={a.agent}>
                      <AgentStamp agent={a.agent} />
                      <div>
                        <div className="w-trace__head"><span className="w-trace__agent">{a.name}</span></div>
                        <p className="w-trace__why">{a.job}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="lede">
                  Sealing a record, refusing to release a machine and refusing to overspend are
                  ordinary code. A gate you can argue with is not a gate.
                </p>
              </div>

              <Rule />

              <div className="stack">
                <p className="eyebrow">Tenancy</p>
                <p className="lede">
                  Sign in with Google and the account decides the tenant. A Workspace domain is the
                  enterprise — everyone at your company shares procedures, jobs, parts and records.
                  A personal account is a tenant of one. No org wizard, no invites, no seat
                  management, and offboarding already works: disable the account, access ends.
                </p>
                <div className="w-step__exits">
                  <Link className="w-btn" href="/">Try a task</Link>
                  <Link className="w-btn w-btn--ghost" href="/library">See the component library</Link>
                </div>
              </div>
            </div>
          </Wrap>
        </main>

        {/* The instrument manual is reachable from here and nowhere else. It is the receipt for
            the claim this page makes about the driver abstraction, for the reader who wants to
            check it — not a navigation destination. */}
        <footer className="w-wrap footer">
          <span>Warrant</span>
          <span>Fixture data — no backend connected yet</span>
          <Link href="/firmware">Instrument manual — build your own, MIT</Link>
        </footer>
      </div>
    </Ground>
  );
}
