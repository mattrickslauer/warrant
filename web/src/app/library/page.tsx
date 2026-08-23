import {
  Ground, Wrap, Rule, EvidenceChip, StatusPill, ReadingBadge, CeilingCard,
  AgentTrace, AgentStamp, JobRow, Timeline, HoldBanner, ChatTurn, StepCard,
  type AgentName,
} from "@/components";
import { AppShell } from "../shell/AppShell";

// Every primitive, on both grounds, at whatever width you are holding.
// This page is the reference build's contract with the agents fanning out on the surfaces:
// a screen needing something that is not on this page comes back here first.

const AGENTS: AgentName[] = ["scoper", "foreman", "inspector", "skeptic", "auditor", "instructor", "wright"];

const DECISIONS = [
  { id: "d1", job_id: "j", step_id: "s2", agent: "inspector" as const, agent_version: "inspector@1.4.0",
    model: "gemma-3-4b", verdict: "ESCALATE", cost_usd: 0.00002, at: "2026-08-18T14:32:01Z",
    rationale: "Slices partly out of frame; cannot confirm the cuts run through. Deferring to Flash." },
  { id: "d2", job_id: "j", step_id: "s2", agent: "skeptic" as const, agent_version: "skeptic@1.1.0",
    model: "multimodalembedding", verdict: "BELONGS", cost_usd: 0.00011, at: "2026-08-18T14:32:04Z",
    rationale: "Background and lighting match this job's earlier captures. Not a resubmission." },
];

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="gallery__block">
      <p className="gallery__label">{label}</p>
      {children}
    </section>
  );
}

function Specimens() {
  return (
    <div className="gallery">
      <Block label="EvidenceChip — four classes, and one out of reach">
        <div className="gallery__row">
          <EvidenceChip cls="measured" />
          <EvidenceChip cls="specified" />
          <EvidenceChip cls="inferred" />
          <EvidenceChip cls="asserted" />
          <EvidenceChip cls="measured" out />
        </div>
      </Block>

      <Block label="StatusPill">
        <div className="gallery__row">
          <StatusPill status="open" />
          <StatusPill status="waiting" />
          <StatusPill status="held" />
          <StatusPill status="sealed" />
        </div>
      </Block>

      <Block label="ReadingBadge — the thesis, and the only thing that gets this treatment">
        <div className="gallery__row">
          <ReadingBadge value={28.4} unit="Nm" at="2026-08-18T14:32:07Z" toolId="A19" />
        </div>
      </Block>

      <Block label="AgentStamp — an inspection stamp, not a mascot">
        <div className="gallery__row">
          {AGENTS.map((a) => (
            <span key={a} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <AgentStamp agent={a} />
              <span className="w-timeline__when">{a}</span>
            </span>
          ))}
        </div>
      </Block>

      <Block label="AgentTrace"><AgentTrace decisions={DECISIONS} /></Block>

      <Block label="CeilingCard — the signature">
        <CeilingCard
          ceiling={{
            ceiling_tier: "open",
            ceiling_reachable: ["inferred", "asserted"],
            ceiling_unreachable: [
              { class: "measured", reason: "requires a paired instrument" },
              { class: "specified", reason: "requires a catalogued machine with a published figure" },
            ],
          }}
          cta={<a className="w-btn" href="/about">What the app adds</a>}
        />
      </Block>

      <Block label="StepCard — three things shown, two exits offered">
        <StepCard
          step={{ index: 2, title: "Cut it", explanation: "This is the work. A model reads the photograph, so what it can conclude is inferred — it can see slices, it cannot measure them." }}
          total={3}
          guidance="Slices separated so the cuts are visible. Roughly even is enough — nobody is grading your knife work."
          exits={
            <>
              <button className="w-btn w-btn--block">Capture evidence</button>
              <button className="w-btn w-btn--ghost w-btn--block">I can&rsquo;t do this</button>
            </>
          }
        />
      </Block>

      <Block label="JobRow">
        <div>
          <JobRow title="BIKE-07 front brake" asset="site-3 / BIKE-07" status="held" when="2d ago" procedure="front-brake-service v3" />
          <JobRow title="BIKE-12 chain tension" asset="site-3 / BIKE-12" status="waiting" when="4h ago" procedure="chain-service v1" />
          <JobRow title="Cut a banana" status="sealed" when="just now" procedure="cut-a-banana v1" />
        </div>
      </Block>

      <Block label="Timeline">
        <Timeline entries={[
          { id: "1", when: "14:31:58", what: "Capture accepted — the step advanced immediately", done: true },
          { id: "2", when: "14:32:01", what: "Inspector escalated to Flash on low confidence", done: true },
          { id: "3", when: "14:32:04", what: "A field was added that the procedure did not contain" },
        ]} />
      </Block>

      <Block label="HoldBanner — two uses, one shape">
        <div className="stack">
          <HoldBanner title="Machine held">
            Step 4 has no instrument reading. The drawer does not open, and this is not a warning
            anyone can dismiss.
          </HoldBanner>
          <HoldBanner kind="fixture" title="Fixture data — live source unavailable">
            The surface is serving fabricated data. A demo must never show an error screen; it
            must also never pass fabricated data off as real.
          </HoldBanner>
        </div>
      </Block>

      <Block label="ChatTurn">
        <div>
          <ChatTurn who="Scoper">What has to be measured on this job, and what is the tolerance?</ChatTurn>
          <ChatTurn who="You" side="me">Caliper bolts, 26 to 30 newton metres.</ChatTurn>
        </div>
      </Block>
    </div>
  );
}

export default function LibraryPage() {
  return (
    <>
      <AppShell tone="work" footer={false}>
              <div className="stack stack--lg">
                <div className="stack">
                  <p className="eyebrow">The workshop ground</p>
                  <h1 className="hero">Component library</h1>
                  <p className="lede">
                    Fourteen primitives. Every screen is these arranged differently. Mono with
                    tabular numerals means a machine produced the value; sans means a person did.
                  </p>
                </div>
                <Rule />
                <Specimens />
              </div>
      </AppShell>

      <Ground tone="paper">
        <div className="page">
          <main className="page__body">
            <Wrap>
              <div className="stack stack--lg">
                <div className="stack">
                  <p className="eyebrow" style={{ color: "var(--measured)" }}>The paper ground</p>
                  <h1 className="hero">The same fourteen</h1>
                  <p className="lede">
                    Dark is the workshop, where work happens. Light is the record, which is what
                    survives it. A screen is one or the other and never both.
                  </p>
                </div>
                <Rule />
                <Specimens />
              </div>
            </Wrap>
          </main>
          <footer className="w-wrap footer">
            <span>Warrant</span>
            <span>Every screen is these arranged differently</span>
          </footer>
        </div>
      </Ground>
    </>
  );
}
