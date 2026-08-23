"use client";

// The authoring interface. It is a conversation, and that is the whole design.
//
// There is no form builder in Warrant and there is not going to be one, for the reason the
// Scoper's own contract gives: a conversation can ask "what happens if it's seized?" and a
// drag-and-drop editor cannot. What this screen does is run that conversation, show the shop
// what the agent currently believes so they can correct it EARLY rather than at the end, and
// then hand the compiled draft to `/api/procedures/compile`.
//
// Three things on this screen are load-bearing and look like decoration:
//
//   * **The understanding, above the question.** Written every turn by contract. A shop that
//     can see the agent has misunderstood on turn three does not discover it on turn fourteen.
//   * **The coverage chips.** What the interview has not asked about yet. An interview is
//     finite — fourteen turns — and this is how a shop can see it spending them.
//   * **The unresolved list.** Empty is the only condition under which the Scoper may compile,
//     so this list IS the progress bar. Nothing else here is one.

import { useState } from "react";
import { Wrap, Rule, ChatTurn, HoldBanner, AgentStamp } from "@/components";
import { useSession } from "@/auth/session-context";

/**
 * Mirrors CLASSES in `/api/scoper/turn`. Duplicated deliberately rather than shared: the route
 * computes coverage from the agent's own declared `asks_about` and that is the authority. This
 * copy only decides what to draw, so a drift here shows a stale chip, never a wrong interview.
 */
const CLASSES = [
  ["scope", "what the job covers"],
  ["sequence", "what order it happens in"],
  ["tolerance", "the figures that decide it"],
  ["evidence", "what has to be captured"],
  ["failure", "what going wrong looks like"],
  ["authority", "who may sign it off"],
  ["parts", "what gets fitted"],
  ["safety", "what could hurt someone"],
] as const;

interface Turn { who: string; said: string; }

interface ScoperTurn {
  mode: "ask" | "compile";
  question?: string | null;
  asks_about?: string | null;
  unresolved: string[];
  understanding: string;
  draft?: Record<string, unknown> | null;
}

interface Shop {
  trade: string; machines: string; technicians: number; stakes: string;
}

type Stage = "shop" | "interview" | "published";

interface Published { procedure_id: string; version: number; minimum_tier: string; tenant: string; }

export function Interview() {
  const { session, loading } = useSession();
  const [stage, setStage] = useState<Stage>("shop");
  const [shop, setShop] = useState<Shop>({ trade: "", machines: "", technicians: 1, stakes: "" });
  const [existingForm, setExistingForm] = useState("");
  const [conversation, setConversation] = useState<Turn[]>([]);
  const [turn, setTurn] = useState<ScoperTurn | null>(null);
  const [answer, setAnswer] = useState("");
  const [turnsLeft, setTurnsLeft] = useState<number | null>(null);
  const [askedAbout, setAskedAbout] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string[]>([]);
  const [published, setPublished] = useState<Published | null>(null);

  const draft = (turn?.mode === "compile" ? turn.draft : null) as DraftView | null;

  /**
   * One turn.
   *
   * The whole transcript goes up every time and nothing is kept on the server between turns —
   * the interview lives in this component and in nothing else until it compiles. That is not
   * laziness: a half-finished interview is not a procedure, and a half-finished procedure
   * sitting in Firestore is something a job could eventually be started against.
   */
  async function ask(said: string | null, base?: Turn[]) {
    setBusy(true);
    setError(null);
    setDetail([]);

    const from = base ?? conversation;
    const next = said === null ? from : [...from, { who: "shop", said }];

    try {
      const res = await fetch("/api/scoper/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shop, conversation: next,
          ...(existingForm.trim() ? { existing_form: existingForm.trim() } : {}),
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "The interview could not continue.");
        // A malformed turn is a finding about the agent, not a crash — the route returns the
        // schema errors rather than throwing, and hiding them here would waste that.
        setDetail(body.schema_errors ?? (body.principal ? [`Principal: ${body.principal}`] : []));
        setConversation(next);
        return;
      }

      const t: ScoperTurn = body.turn;
      // The class marker travels IN the turn text. `/api/scoper/turn` reads coverage back off
      // these markers, so an interview that dropped them would tell the agent it had asked
      // about nothing and it would start again from scope on every turn.
      const marked = t.mode === "ask" && t.asks_about
        ? `[${t.asks_about}] ${t.question ?? ""}`
        : (t.question ?? "Compiled.");

      setConversation([...next, { who: "scoper", said: marked }]);
      setTurn(t);
      setTurnsLeft(body.turns_left ?? null);
      setAskedAbout(body.asked_about ?? []);
      setAnswer("");
      setStage("interview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConversation(next);
    } finally {
      setBusy(false);
    }
  }

  async function compile() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setDetail([]);
    try {
      const res = await fetch("/api/procedures/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const body = await res.json();

      // A refused draft is not a dead end, and this is the difference between a system that
      // holds a line and a system that just says no. The compiler refuses drafts that would
      // decide nothing — a single-answer choice that cannot record the job going wrong is the
      // one the Scoper actually produces — and the shop cannot fix that by rephrasing anything.
      // The agent can. So the refusal goes back into the conversation as a turn and the
      // interview continues from there.
      if (res.status === 422 && Array.isArray(body.faults) && body.faults.length) {
        const next: Turn[] = [...conversation, {
          who: "compiler",
          said: `Refused. ${body.faults.join(" ")} Ask the shop whatever you need to close these, ` +
                `then compile again. Do not invent anything to satisfy me.`,
        }];
        setConversation(next);
        await ask(null, next);
        return;
      }

      if (!res.ok) {
        setError(body.error ?? "This procedure could not be published.");
        setDetail(body.faults ?? []);
        return;
      }
      setPublished(body);
      setStage("published");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Wrap><p className="lede">…</p></Wrap>;

  // Authoring is gated and has to be. Running a public task needs no account; a procedure
  // governs every job ever run against it, so it belongs to a tenant and to a named person.
  if (!session) {
    return (
      <Wrap>
        <div className="stack stack--lg">
          <HoldBanner title="Sign in to author a procedure">
            A procedure governs every job ever run against it and every record those jobs seal,
            so it belongs to a shop rather than to a browser. Signing in with a Workspace
            account puts it in that organisation&rsquo;s tenant; the first person from a domain
            to arrive owns it.
          </HoldBanner>
        </div>
      </Wrap>
    );
  }

  return (
    <Wrap>
      <div className="stack stack--lg">
        {stage === "published" && published ? (
          <Published published={published} title={draft?.title ?? ""} />
        ) : null}

        {stage !== "published" && (
          <>
            <div className="stack">
              <p className="eyebrow">Authoring</p>
              <h1 className="w-step__title">Describe the job you already do</h1>
              <p className="lede">
                There is no form to fill in. The Scoper asks about one thing at a time until two
                technicians working alone would produce the same record, and then compiles what
                you said. It will not invent a figure you did not give it.
              </p>
            </div>

            {session.anonymous && (
              <HoldBanner kind="fixture" title="This is a throwaway tenant">
                You arrived without an account, so this procedure will land in an anonymous
                tenant that belongs to this browser. Sign in above to keep it.
              </HoldBanner>
            )}

            <Rule />
          </>
        )}

        {stage === "shop" && (
          <ShopIntake
            shop={shop} setShop={setShop}
            existingForm={existingForm} setExistingForm={setExistingForm}
            busy={busy} onStart={() => void ask(null)}
          />
        )}

        {stage === "interview" && (
          <div className="stack stack--lg">
            <div className="stack">
              <div className="w-trace__head">
                <span className="w-trace__agent"><AgentStamp agent="scoper" /> What the Scoper believes</span>
                {turnsLeft !== null && (
                  <span className="w-trace__meta">{turnsLeft} turn{turnsLeft === 1 ? "" : "s"} left</span>
                )}
              </div>
              <p className="w-trace__why">{turn?.understanding}</p>
            </div>

            <Coverage asked={askedAbout} />

            <Rule />

            <div className="stack">
              {conversation.map((t, i) => (
                <ChatTurn key={i} who={SPEAKER[t.who] ?? t.who}
                          side={t.who === "shop" ? "me" : "them"}>
                  {t.who === "shop" ? t.said : stripMarker(t.said)}
                </ChatTurn>
              ))}
            </div>

            {turn?.mode === "ask" && (
              <div className="stack">
                <textarea
                  className="w-reason__text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Answer in your own words. &ldquo;I don&rsquo;t know&rdquo; is a real answer and it will be recorded as one."
                  disabled={busy}
                />
                <button className="w-btn" disabled={busy || !answer.trim()}
                        onClick={() => void ask(answer.trim())}>
                  {busy ? "Thinking…" : "Answer"}
                </button>
              </div>
            )}

            <Unresolved items={turn?.unresolved ?? []} compiled={turn?.mode === "compile"} />

            {draft && (
              <>
                <Rule />
                <DraftReview draft={draft} />
                <button className="w-btn" disabled={busy} onClick={() => void compile()}>
                  {busy ? "Publishing…" : `Publish ${draft.title}`}
                </button>
              </>
            )}
          </div>
        )}

        {error && (
          <HoldBanner title={error}>
            {detail.length > 0
              ? detail.join(" ")
              : "Nothing was written. The interview above is intact — answer again, or change what you said."}
          </HoldBanner>
        )}
      </div>
    </Wrap>
  );
}

/** The marker is for the route's coverage arithmetic, not for the shop to read. */
const stripMarker = (said: string) => said.replace(/^\[[a-z_]+\]\s*/, "");

/**
 * Who is speaking, shown by name.
 *
 * The compiler appears in the transcript as itself when it refuses a draft. Attributing that
 * refusal to the shop, or quietly folding it into the Scoper's own words, would put sentences
 * in someone's mouth that they did not say — in a transcript that becomes a procedure.
 */
const SPEAKER: Record<string, string> = { shop: "You", scoper: "Scoper", compiler: "Compiler" };

function ShopIntake({
  shop, setShop, existingForm, setExistingForm, busy, onStart,
}: {
  shop: Shop; setShop: (s: Shop) => void;
  existingForm: string; setExistingForm: (s: string) => void;
  busy: boolean; onStart: () => void;
}) {
  const ready = shop.trade.trim() && shop.machines.trim() && shop.stakes.trim();
  return (
    <div className="stack stack--lg">
      <Field label="What trade is this?" hint="A motorcycle rental workshop. A foil mill. Whatever you would say to another mechanic.">
        <input className="w-sign__field" value={shop.trade} disabled={busy}
               onChange={(e) => setShop({ ...shop, trade: e.target.value })} />
      </Field>
      <Field label="What do you work on?" hint="The machines, materials or product that pass through.">
        <input className="w-sign__field" value={shop.machines} disabled={busy}
               onChange={(e) => setShop({ ...shop, machines: e.target.value })} />
      </Field>
      <Field label="How many people do this job?" hint="It decides how much can be left unsaid. One person can carry it in their head; six cannot.">
        <input className="w-sign__field" type="number" min={1} value={shop.technicians} disabled={busy}
               onChange={(e) => setShop({ ...shop, technicians: Number(e.target.value) || 1 })} />
      </Field>
      <Field label="What is at stake if this job is done badly?"
             hint="Answer this one properly. It is what the Scoper sets strictness from, and it is the difference between a log and a record somebody can rely on.">
        <textarea className="w-reason__text" value={shop.stakes} disabled={busy}
                  onChange={(e) => setShop({ ...shop, stakes: e.target.value })} />
      </Field>
      <Field label="A paper form you use today (optional)"
             hint="Paste it. It will be compiled where it is unambiguous and asked about everywhere it is not — a tick box on paper almost never states its own acceptance rule.">
        <textarea className="w-reason__text" value={existingForm} disabled={busy}
                  onChange={(e) => setExistingForm(e.target.value)} />
      </Field>
      <button className="w-btn" disabled={busy || !ready} onClick={onStart}>
        {busy ? "Starting…" : "Start the interview"}
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="w-sign">
      <label className="w-sign__label">{label}</label>
      {children}
      <p className="w-sign__note">{hint}</p>
    </div>
  );
}

/**
 * What the interview has and has not asked about.
 *
 * Drawn from the route's own arithmetic over the agent's declared `asks_about`, so this is a
 * report rather than a guess. A dimmed chip is a subject the procedure will be compiled without.
 */
function Coverage({ asked }: { asked: string[] }) {
  return (
    <div className="stack">
      <p className="w-step__num">What it has asked about</p>
      <div className="gallery__row">
        {CLASSES.map(([cls, what]) => (
          <span key={cls} className={`w-chip${asked.includes(cls) ? "" : " w-chip--out"}`}
                title={what}>
            {cls}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The only progress bar on this screen, and it runs backwards.
 *
 * Empty is the one condition under which the Scoper may compile. Showing it as a list rather
 * than a percentage is deliberate: each line is a thing somebody can go and find out.
 */
function Unresolved({ items, compiled }: { items: string[]; compiled: boolean }) {
  if (compiled && items.length === 0) {
    return (
      <div className="stack">
        <p className="w-step__num">Nothing left unresolved</p>
        <p className="w-trace__why">
          Every step has a reason, every field has a rule that can be applied to what comes back,
          and every bound came from you.
        </p>
      </div>
    );
  }
  if (items.length === 0) return null;
  return (
    <div className="stack">
      <p className="w-step__num">Still unresolved — {items.length}</p>
      <ul className="w-ceiling__rows">
        {items.map((u, i) => (
          <li key={i} className="w-ceiling__row">
            <span className="w-ceiling__reason">{u}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface DraftView {
  key?: string;
  title?: string;
  strictness?: number;
  minimum_tier?: string;
  disqualifiers?: string[];
  releases?: string[];
  steps?: Array<{
    title?: string;
    explanation?: string;
    fields?: Array<{
      key?: string; kind?: string; source?: string; prompt?: string;
      acceptance_rule?: string; acceptance_min?: number | null; acceptance_max?: number | null;
      acceptance_unit?: string | null; acceptance_target?: string | null;
      acceptance_description?: string | null;
    }>;
  }>;
}

const STRICTNESS = ["log", "standard", "assured", "regulated"];

/**
 * The compiled procedure, shown before it is published.
 *
 * Every acceptance rule is spelled out in full here, including its figure and its unit, because
 * this is the last moment at which the shop can say "that is not our number". After publishing
 * it is a frozen version that records will name.
 */
function DraftReview({ draft }: { draft: DraftView }) {
  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="eyebrow">Compiled</p>
        <h2 className="w-step__title">{draft.title}</h2>
        <div className="gallery__row">
          <span className="w-chip">{STRICTNESS[draft.strictness ?? 1] ?? draft.strictness}</span>
          <span className="w-chip">{draft.minimum_tier}</span>
          <span className="w-chip w-mono">{draft.key}</span>
        </div>
      </div>

      {(draft.steps ?? []).map((s, i) => (
        <div className="w-step" key={i}>
          <p className="w-step__num">Step {i + 1}</p>
          <p className="w-step__title">{s.title}</p>
          <p className="w-step__why">{s.explanation}</p>
          <div className="stack">
            {(s.fields ?? []).map((f, j) => (
              <div className="w-trace__row" key={j}>
                <div className="w-trace__head">
                  <span className="w-trace__agent w-mono">{f.key}</span>
                  <span className="w-trace__meta">{f.kind} · {f.source}</span>
                </div>
                <p className="w-trace__why">{f.prompt}</p>
                <p className="w-step__guide">{describeRule(f)}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      {(draft.disqualifiers ?? []).length > 0 && (
        <div className="stack">
          <p className="w-step__num">Stops the job whatever else passed</p>
          {(draft.disqualifiers ?? []).map((d, i) => <p className="w-trace__why" key={i}>{d}</p>)}
        </div>
      )}
    </div>
  );
}

/** The acceptance rule in a sentence, with its figure. A rule you cannot read is a rule you cannot dispute. */
function describeRule(f: NonNullable<NonNullable<DraftView["steps"]>[number]["fields"]>[number]): string {
  const unit = f.acceptance_unit ? ` ${f.acceptance_unit}` : "";
  switch (f.acceptance_rule) {
    case "within":
      if (typeof f.acceptance_min === "number" && typeof f.acceptance_max === "number")
        return `Passes between ${f.acceptance_min} and ${f.acceptance_max}${unit}.`;
      if (typeof f.acceptance_min === "number") return `Passes at or above ${f.acceptance_min}${unit}.`;
      return `Passes at or below ${f.acceptance_max}${unit}.`;
    case "matches":
      return `Must match ${f.acceptance_target}.`;
    case "per_spec":
      return `Judged against the figure printed on ${f.acceptance_target} — this procedure carries no number of its own.`;
    case "must_show":
      return `The capture must show ${f.acceptance_description}.`;
    case "consistent_with":
      return `Must be consistent with ${f.acceptance_target}.`;
    case "signed_by":
      return `Must be signed by ${f.acceptance_target}.`;
    default:
      return "";
  }
}

function Published({ published, title }: { published: Published; title: string }) {
  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="eyebrow">Published</p>
        <h1 className="w-step__title">{title} — v{published.version}</h1>
        <p className="lede">
          Frozen. Jobs started from here pin version {published.version}, so re-interviewing this
          job later publishes v{published.version + 1} without changing what any record already
          made under this one says it ran.
        </p>
      </div>
      <div className="stack">
        <div className="w-trace__row">
          <div className="w-trace__head">
            <span className="w-trace__agent">Tenant</span>
            <span className="w-trace__meta w-mono">{published.tenant}</span>
          </div>
          <p className="w-trace__why">
            It lives under this tenant and nowhere else. No visibility flag is doing that work —
            firestore.rules makes the subtree unreachable to anyone outside the organisation.
          </p>
        </div>
        <div className="w-trace__row">
          <div className="w-trace__head">
            <span className="w-trace__agent">Needs a surface that can reach</span>
            <span className="w-trace__meta w-mono">{published.minimum_tier}</span>
          </div>
          <p className="w-trace__why">
            Derived from the fields, never chosen. A surface below this is refused before the job
            starts rather than downgraded to let it through.
          </p>
        </div>
      </div>
      <a className="w-btn" href="/">Run it</a>
    </div>
  );
}
