import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AgentStamp, type AgentName } from "@/components";
import { AppShell } from "../../shell/AppShell";
import { AGENTS, STATUS_MEANING, byId, run, type Result, type Turn } from "@/server/evals";
import { Checks, Field, Json, PromptView, StatusChip } from "../parts";
import "../model-tests.css";

/** Pre-rendered: the run is a frozen artifact, so every scenario is a static page. */
export function generateStaticParams() {
  return run.results.map((r) => ({ id: r.id.split("/") }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string[] }> },
): Promise<Metadata> {
  const r = byId((await params).id.join("/"));
  return { title: r ? `${r.title} — model tests` : "Model tests" };
}

export default async function ScenarioPage({ params }: { params: Promise<{ id: string[] }> }) {
  const result = byId((await params).id.join("/"));
  if (!result) notFound();

  return (
    <AppShell tone="work">
      <div className="mt">
        <div className="stack stack--lg">
          <Link href="/model-tests" className="mt-back">← all model tests</Link>

          <header className="mt-head">
            <div className="mt-agent__head">
              <AgentStamp agent={result.agent as AgentName} />
              <span className="mt-agent__name">{AGENTS[result.agent]?.title ?? result.agent}</span>
              <StatusChip status={result.status} />
            </div>
            <h1 className="mt-head__title">{result.title || result.id}</h1>
            {/* `why` is required on every scenario. A test whose purpose nobody can
                reconstruct gets deleted the first time it fails inconveniently. */}
            <p className="mt-why">{result.why}</p>
            <p className="mt-panel__note">{STATUS_MEANING[result.status]}</p>
          </header>

          <div className="mt-panel">
            <div className="mt-facts">
              <Field label="model">{result.model ?? run.model}</Field>
              <Field label="temperature">{run.temperature}</Field>
              <Field label="scenario">{result.path}</Field>
              {result.cassette && <Field label="cassette">{result.cassette.slice(0, 16)}…</Field>}
              {result.latency_ms != null && <Field label="latency">{(result.latency_ms / 1000).toFixed(1)}s</Field>}
              {result.usage?.totalTokenCount != null && (
                <Field label="tokens">{result.usage.totalTokenCount.toLocaleString()}</Field>
              )}
            </div>
          </div>

          {result.status === "error" && (
            <div className="mt-panel">
              <span className="mt-panel__name">Why this was never asked</span>
              <p className="mt-panel__note">
                Nothing was scored for or against the agent here. The suite reports this as its own
                outcome rather than a failure, because an agent asked an incomplete question will
                still confidently answer it.
              </p>
              <pre className="mt-pre">{result.error}</pre>
            </div>
          )}

          {!!result.schema_errors?.length && (
            <div className="mt-panel">
              <span className="mt-panel__name">Off-contract</span>
              <p className="mt-panel__note">
                The answer did not obey the schema that was posted with the request, or broke a rule
                a schema cannot state — such as “this field is required when and only when the
                verdict is ADD FIELD”. That gap is where a plausible but useless answer lives, so
                each agent closes it in code, and every one of those rules is itself tested.
              </p>
              <ul className="mt-panel__note">
                {result.schema_errors.map((e, i) => <li key={i} className="mt-mono">{e}</li>)}
              </ul>
            </div>
          )}

          {result.kind === "interview"
            ? <Interview result={result} />
            : <SingleTurn result={result} />}

          {!!result.checks?.length && (
            <div className="mt-panel">
              <div className="mt-panel__head">
                <span className="mt-panel__name">What this scenario asserted</span>
              </div>
              <p className="mt-panel__note">
                Assertions pin the part of an answer that <i>decides</i> something, never the whole
                object — exact-matching a rationale would fail the first time it was reworded, and a
                suite that cries wolf is abandoned inside a day. Where the reasoning is checked at
                all, it is to catch an agent that reached the right verdict for no reason.
              </p>
              <Checks checks={result.checks} />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** One question, one answer — the shape that fits an Inspector or a Skeptic. */
function SingleTurn({ result }: { result: Result }) {
  return (
    <>
      <div className="mt-panel">
        <div className="mt-panel__head">
          <span className="mt-panel__name">What the model was given</span>
        </div>
        <PromptView prompt={result.prompt} />
      </div>
      {result.output && (
        <div className="mt-panel">
          <div className="mt-panel__head">
            <span className="mt-panel__name">What came back</span>
            <span className="mt-panel__note">
              Structured output, not prose that was parsed afterwards: the contract schema is posted
              as the response schema, so the model returns this shape or fails.
            </span>
          </div>
          <Json value={result.output} />
        </div>
      )}
    </>
  );
}

/**
 * A whole interview, and the arithmetic that decides whether it invented anything.
 *
 * The transcript is the readable part; the traceability panel underneath it is the part that
 * actually decides. Every bound in the compiled procedure is checked against the figures the
 * shop said out loud, so "it did not make up a tolerance" is a computation rather than an
 * impression formed by reading.
 */
function Interview({ result }: { result: Result }) {
  const out = (result.output ?? {}) as Record<string, unknown>;
  const bounds = (out.bounds ?? []) as Array<Record<string, unknown>>;
  const invented = (out.invented_bounds ?? []) as Array<Record<string, unknown>>;
  const disclosed = result.disclosed_numbers ?? [];
  const traceable = out.traceable === true;
  const compiled = out.compiled === true;
  const inventedValues = new Set(invented.map((b) => b.value as number));

  return (
    <>
      <div className="mt-panel">
        <div className="mt-panel__head">
          <span className="mt-panel__name">The interview</span>
          <span className="mt-panel__note">
            The shop is played by a second model, given a fixed sheet of figures. It talks freely
            about its own work and holds no figure that is not on the sheet — so when the Scoper
            asks for one it was never given, the refusal is something this run can observe rather
            than something we hoped for.
          </span>
        </div>
        <div className="mt-convo">
          {(result.transcript ?? []).map((t) => <TurnRow key={t.turn} turn={t} />)}
        </div>
      </div>

      <div className="mt-panel">
        <div className="mt-panel__head">
          <span className="mt-panel__name">Could every figure be traced back?</span>
        </div>
        <p className="mt-panel__note">
          Inventing a tolerance is the one thing the Scoper must never do. A fabricated bound
          enters every future record indistinguishable from a figure a person set, and nobody
          downstream can tell which is which. So each bound in the compiled procedure is compared
          against the numbers the shop actually said aloud.
        </p>
        <div className="mt-trace">
          <div>
            <p className="mt-said__who">figures the shop disclosed</p>
            <div className="mt-nums">
              {disclosed.length
                ? disclosed.map((n) => <span key={n} className="mt-num">{n}</span>)
                : <span className="mt-dim">none — the shop never stated a figure</span>}
            </div>
          </div>
          <div>
            <p className="mt-said__who">bounds in the compiled procedure</p>
            <div className="mt-nums">
              {bounds.length
                ? bounds.map((b, i) => (
                    <span
                      key={i}
                      className={`mt-num ${inventedValues.has(b.value as number) ? "mt-num--invented" : "mt-num--ok"}`}
                      title={`${b.field} · ${b.bound}`}
                    >
                      {String(b.value)}{b.unit ? ` ${b.unit}` : ""} · {String(b.field)}
                    </span>
                  ))
                : <span className="mt-dim">
                    {compiled ? "the procedure compiled with no numeric bounds" : "nothing compiled"}
                  </span>}
            </div>
          </div>
          <p className={`mt-verdict ${traceable ? "mt-verdict--ok" : "mt-verdict--bad"}`}>
            {traceable
              ? "Every bound traces to a figure the shop stated. Nothing was invented."
              : `${invented.length} bound${invented.length === 1 ? "" : "s"} appear in the procedure and nowhere in the transcript.`}
          </p>
        </div>
      </div>

      <div className="mt-panel">
        <div className="mt-panel__head">
          <span className="mt-panel__name">
            {compiled ? "The compiled procedure" : "Where the interview stood when it ended"}
          </span>
          <span className="mt-panel__note">
            {compiled
              ? "What the shop would be handed. Compiled only once nothing material was still unstated."
              : "It did not compile. `unresolved` is what it still did not know — and while that list is non-empty, compiling is not permitted."}
          </span>
        </div>
        <Json value={compiled ? out.draft : { unresolved: out.unresolved, understanding: out.understanding }} />
      </div>

      <div className="mt-panel">
        <details className="mt-fold">
          <summary>
            The prompt behind the last turn
            <span className="mt-fold__note">the whole conversation is re-laid in front of the model every turn</span>
          </summary>
          <PromptView prompt={result.prompt} />
        </details>
      </div>
    </>
  );
}

function TurnRow({ turn }: { turn: Turn }) {
  const s = turn.scoper as Record<string, unknown>;
  const unresolved = (s.unresolved ?? []) as string[];
  const shrugged = turn.shop && turn.shop.knew_it === false;

  return (
    <div className="mt-turn">
      <span className="mt-turn__n">{turn.turn}</span>
      <div className="mt-turn__body">
        <div className="mt-said mt-said--agent">
          <span className="mt-said__who">Scoper</span>
          <span className="mt-said__text">
            {s.mode === "compile"
              ? "Nothing material is unstated. Compiling the procedure."
              : String(s.question ?? "")}
          </span>
        </div>
        <div className="mt-tags">
          {s.asks_about ? <span className="mt-tag mt-tag--asks">{String(s.asks_about)}</span> : null}
          <span className="mt-tag">{unresolved.length} still unresolved</span>
          {turn.latency_ms ? <span className="mt-tag">{(turn.latency_ms / 1000).toFixed(1)}s</span> : null}
        </div>
        {turn.shop && (
          <div className="mt-said mt-said--shop">
            <span className="mt-said__who">Shop</span>
            <span className="mt-said__text">{turn.shop.said}</span>
          </div>
        )}
        {shrugged && (
          <div className="mt-tags">
            {/* The shop declining to supply a figure is the input the Scoper's one
                unbreakable rule is tested against, so it is marked rather than hidden. */}
            <span className="mt-tag mt-tag--shrug">no figure — the Scoper must not invent one</span>
          </div>
        )}
      </div>
    </div>
  );
}
