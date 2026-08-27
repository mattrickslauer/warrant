import Link from "next/link";
import type { Metadata } from "next";
import { Rule, AgentStamp, type AgentName } from "@/components";
import { AppShell } from "../shell/AppShell";
import { AGENTS, grouped, notAskedSentence, run, totals } from "@/server/evals";
import { StatusChip } from "./parts";
import "./model-tests.css";

export const metadata: Metadata = {
  title: "Model tests — Warrant",
  description:
    "Every claim Warrant makes about its agents is a scenario in a suite anyone can re-run. This is the last run, with the prompt, the model, and what came back.",
};

/**
 * /model-tests — the suite, and the last run of it.
 *
 * A product whose argument is "a record should be evidence, not a claim" cannot ask to be
 * taken at its word about its own agents. So this is the bench: every scenario, what it was
 * for, exactly what was put in front of the model, and exactly what came back — including
 * the ones that failed, which are the only reason to believe the ones that passed.
 */
export default function ModelTests() {
  if (run.empty) {
    return (
      <AppShell tone="work">
        <div className="mt">
          <h1 className="mt-head__title">Model tests</h1>
          <p className="mt-empty">
            No run has been recorded yet. From <span className="mt-mono">agents/</span>, run{" "}
            <span className="mt-mono">python3 -m evals run --live</span>, then{" "}
            <span className="mt-mono">npm run gen</span> in <span className="mt-mono">web/</span>.
          </p>
        </div>
      </AppShell>
    );
  }

  const t = totals();
  const groups = grouped();

  return (
    <AppShell tone="work">
      <div className="mt">
        <div className="stack stack--lg">
          <header className="mt-head">
            <p className="eyebrow">How we know the agents work</p>
            <h1 className="mt-head__title">Model tests</h1>
            <p className="mt-head__lede">
              Warrant&apos;s argument is that a maintenance record should be evidence rather than a
              claim by an interested party. It would be incoherent to then ask you to take the
              agents on trust. So every claim this product makes about them is a scenario below —
              a genuinely different situation, not the same one sampled repeatedly — and each one
              shows the prompt that was sent, the model that answered, and the answer, whether or
              not it passed.
            </p>
          </header>

          <div className="mt-score">
            <div className="mt-score__cell mt-score__cell--pass">
              <span className="mt-score__n">{t.pass}</span>
              <span className="mt-score__k">passed</span>
            </div>
            <div className="mt-score__cell mt-score__cell--fail">
              <span className="mt-score__n">{t.fail}</span>
              <span className="mt-score__k">failed an assertion</span>
            </div>
            <div className="mt-score__cell mt-score__cell--invalid">
              <span className="mt-score__n">{t.invalid}</span>
              <span className="mt-score__k">off-contract</span>
            </div>
            <div className="mt-score__cell mt-score__cell--error">
              <span className="mt-score__n">{t.error}</span>
              <span className="mt-score__k">never asked</span>
            </div>
          </div>

          <p className="mt-head__lede">
            Those four are deliberately not three. <b>Off-contract</b> means the answer broke its
            own schema, so nothing about its content is judged — assertions about a field the
            model never returned would bury the one failure that matters. <b>Never asked</b> means
            the agent was not properly put to the question. It is scored as neither a pass nor a
            fail, because an Inspector asked to judge a photograph it was never shown will
            confidently return something.
          </p>

          {/* Read off the run, not remembered. This used to assert that a never-asked scenario
              was "almost always a photograph the corpus is still waiting on", which was wrong by
              two to one on the very run displayed underneath it. */}
          {t.error > 0 && (
            <p className="mt-head__lede">
              On this run, of the {t.error} never asked: {notAskedSentence()}.
            </p>
          )}

          <div className="mt-runmeta">
            <span>recorded <b>{run.at}</b></span>
            <span>model <b>{run.model}</b></span>
            <span>temperature <b>{run.temperature}</b></span>
            <span>mode <b>{run.mode}</b></span>
            <span><b>{t.tokens.toLocaleString()}</b> tokens</span>
            <span><b>{(t.ms / 1000).toFixed(1)}s</b> of model time</span>
          </div>

          <Rule />

          {groups.map((g) => (
            <section key={g.agent} className="mt-agent">
              <div className="mt-agent__head">
                <AgentStamp agent={g.agent as AgentName} />
                <span className="mt-agent__name">{AGENTS[g.agent]?.title ?? g.agent}</span>
                <span className="mt-agent__decides">{AGENTS[g.agent]?.decides}</span>
                <span className="mt-agent__tally">
                  {g.passed}/{g.scored} scored
                  {g.results.length !== g.scored && ` · ${g.results.length - g.scored} not asked`}
                </span>
              </div>
              <div className="mt-rows">
                {g.results.map((r) => (
                  <Link key={r.id} href={`/model-tests/${r.id}`} className="mt-row">
                    <StatusChip status={r.status} />
                    <span className="mt-row__title">{r.title || r.id}</span>
                    {r.kind === "interview" && (
                      <span className="mt-row__tag">full interview · {String((r.output?.turns as number) ?? "?")} turns</span>
                    )}
                    <span className="mt-row__why">{r.why}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}

          <Rule />

          <p className="mt-head__lede">
            Re-run it yourself: <span className="mt-mono">python3 -m evals run</span> replays every
            recorded answer offline and costs nothing, because each call is keyed by the model, the
            instruction, the schema and the bytes of every attachment. Editing one agent&apos;s
            wording changes only that agent&apos;s keys — so a prompt edit cannot silently reuse a
            stale answer, and the scenarios it affects are exactly the ones that need calling again.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
