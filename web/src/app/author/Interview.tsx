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

import { useRef, useState } from "react";
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { Wrap, Rule, ChatTurn, HoldBanner, AgentStamp } from "@/components";
import { useSession } from "@/auth/session-context";
import { authConfigured, firebaseWebConfig } from "@/auth/config";
import { clientStorage } from "@/auth/firebase-client";

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

/**
 * What the Scoper can read off a document, keyed by extension.
 *
 * The extension is load-bearing on the far side rather than decoration: `Agent.media()`
 * derives the MIME type from the suffix of the `gs://` name and refuses what it cannot decode,
 * so the stored object is named from a type on this list rather than from whatever the file
 * was called.
 *
 * `storage.rules` allows exactly `application/pdf|image/.*` here and that rule is the
 * enforcement — this list is how a person finds out early and in a sentence they can act on.
 */
const DOCUMENT_FORM: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Forms that are already text. Read in the browser, shown to the shop, uploaded nowhere. */
const TEXT_FORM = new Set(["txt", "md", "csv"]);

/** Matches `storage.rules`. Big enough for a scanned service sheet; a form is not a video. */
const MAX_FORM_BYTES = 10 * 1024 * 1024;

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

/**
 * A paper form the shop uploaded, by reference.
 *
 * The bytes left this browser for Cloud Storage and did not come back: what is held here is a
 * `gs://` name the fleet opens under its own credential, and the file name to show a person.
 * The interview stays as cheap to hold as a conversation, which is what it is.
 */
interface FormDoc { name: string; ref: string; }

type Stage = "shop" | "interview" | "published";

interface Published { procedure_id: string; version: number; minimum_tier: string; tenant: string; }

export function Interview() {
  const { session, loading } = useSession();
  const [stage, setStage] = useState<Stage>("shop");
  const [shop, setShop] = useState<Shop>({ trade: "", machines: "", technicians: 1, stakes: "" });
  const [existingForm, setExistingForm] = useState("");
  const [formDocs, setFormDocs] = useState<FormDoc[]>([]);
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
          // Sent EVERY turn, not just the first. Nothing is kept on the server between turns —
          // the interview lives in this component — so a form dropped after the opening
          // question would be a form the Scoper stopped being able to see mid-interview.
          ...(formDocs.length ? { existing_form_media: formDocs.map((d) => d.ref) } : {}),
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "The interview could not continue.");
        // A malformed turn is a finding about the agent, not a crash — the route returns the
        // schema errors rather than throwing, and hiding them here would waste that.
        //
        // `detail` is here because leaving it out cost an afternoon. The route already sends
        // the reason the fleet refused, and the reason is nearly always the identity trap
        // `server/fleet.ts` warns about — but it arrives as a 403 body with `principal` null,
        // because when nobody is being impersonated there is no principal to name. So the
        // screen said "The Scoper could not be reached" and, underneath, that nothing was
        // written: true, reassuring, and silent about the one fact that fixes it.
        setDetail([
          ...(body.schema_errors ?? []),
          ...(body.principal ? [`Principal: ${body.principal}`] : []),
          ...(body.detail ? [String(body.detail).slice(0, 300)] : []),
        ]);
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
            tenant={session.tenant.id} docs={formDocs} setDocs={setFormDocs}
            // A text file IS its own transcription, so it lands in the box where the shop can
            // read and correct every word before the Scoper is shown it. Appended rather than
            // replacing, because a shop with two sheets has two sheets.
            onFormText={(text) => setExistingForm((prev) => prev.trim() ? `${prev.trim()}\n\n${text}` : text)}
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
  shop, setShop, existingForm, setExistingForm, tenant, docs, setDocs, onFormText, busy, onStart,
}: {
  shop: Shop; setShop: (s: Shop) => void;
  existingForm: string; setExistingForm: (s: string) => void;
  tenant: string;
  docs: FormDoc[]; setDocs: React.Dispatch<React.SetStateAction<FormDoc[]>>;
  onFormText: (text: string) => void;
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
             hint="Hand over the sheet itself and the Scoper reads it — the columns, the units printed above them, the box somebody has been ticking for a year. A typed-up version has already decided what those meant, which is the decision this interview exists to make out loud. It will be compiled where it is unambiguous and asked about everywhere it is not.">
        <PaperForm tenant={tenant} docs={docs} setDocs={setDocs} onText={onFormText} busy={busy} />
        <textarea className="w-reason__text" value={existingForm} disabled={busy}
                  placeholder="…or type it out here."
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
 * The paper form, handed over rather than typed out.
 *
 * This is the one file input in Warrant and it is worth saying why it is allowed to exist,
 * because the job surface refuses uploads on purpose — `CaptureTile` will not fall back to one
 * even when there is no camera, since a file says nothing about when it was made, where, or by
 * whom. That test is the right test for EVIDENCE. A checklist the shop has been filling in
 * since before Warrant existed is not evidence: it is never sealed, no record points at it,
 * and it is under no obligation to prove when it was made. It is the input to a conversation.
 *
 * The bytes go straight from this browser to Cloud Storage under `storage.rules`, exactly the
 * way a capture does, and never through the app server. That is not a shortcut: routing them
 * through would mean granting `warrant-web` object-create on the evidence bucket, and that is
 * the principal which mints session cookies. It holds read and nothing more, deliberately.
 *
 * Uploads on selection rather than at submit. A shop that discovers its scan is too large
 * after answering fourteen questions has been wasted; the failure belongs here, beside the
 * file, while nothing else has been spent.
 */
function PaperForm({ tenant, docs, setDocs, onText, busy }: {
  tenant: string;
  docs: FormDoc[];
  setDocs: React.Dispatch<React.SetStateAction<FormDoc[]>>;
  onText: (text: string) => void;
  busy: boolean;
}) {
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  async function take(files: FileList | null) {
    if (!files || files.length === 0) return;
    setProblem(null);
    setUploading(true);
    try {
      // One at a time, and a refusal does not abandon the rest. A shop dropping four pages of
      // a service sheet should not lose three of them because the second was a .docx.
      for (const file of Array.from(files)) {
        const ext = (file.name.split(".").pop() ?? "").toLowerCase();

        // A text file IS its own transcription. It goes into the box below rather than into
        // storage, where the shop reads what the Scoper is about to be shown before it is
        // shown it — and can correct it, which is the whole difference.
        if (TEXT_FORM.has(ext)) {
          const text = (await file.text()).trim();
          if (text) onText(text);
          else setProblem(`${file.name} is empty.`);
          continue;
        }

        const mime = DOCUMENT_FORM[ext];
        if (!mime) {
          setProblem(`Warrant cannot read ${file.name} here. A PDF, a photograph of the ` +
                     `sheet, or a plain text file.`);
          continue;
        }
        if (file.size > MAX_FORM_BYTES) {
          setProblem(`${file.name} is ${Math.round(file.size / 1024 / 1024)}MB and the limit ` +
                     `is ${MAX_FORM_BYTES / 1024 / 1024}MB. Photograph the pages rather than ` +
                     `scanning them at print resolution.`);
          continue;
        }
        if (!authConfigured) {
          // Said plainly rather than thrown. Without a project behind this build the paste box
          // still works, and a shop told that carries on instead of concluding it is broken.
          setProblem("This build has no document store behind it. Type the form out below.");
          continue;
        }

        try {
          // `tenants/{t}/forms/{id}.{ext}`, deliberately NOT under `captures/`. That prefix is
          // append-only because a technician must not be able to replace a photograph which
          // failed inspection; this is a different kind of object and gets its own rule rather
          // than borrowing one that would say something untrue about what it is.
          const object = `tenants/${tenant}/forms/${crypto.randomUUID()}.${ext}`;
          await uploadBytes(storageRef(clientStorage(), object), file, { contentType: mime });
          const doc = { name: file.name, ref: `gs://${firebaseWebConfig().storageBucket}/${object}` };
          setDocs((prev) => prev.some((d) => d.ref === doc.ref) ? prev : [...prev, doc]);
        } catch (e) {
          setProblem(`${file.name} could not be stored. ` +
                     (e instanceof Error ? e.message : String(e)));
        }
      }
    } finally {
      setUploading(false);
      // Cleared so choosing the same file twice fires a change event the second time.
      if (picker.current) picker.current.value = "";
    }
  }

  const disabled = busy || uploading;

  return (
    <div className="stack">
      <input ref={picker} type="file" multiple hidden
             accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.md,.csv,application/pdf,image/*,text/plain"
             onChange={(e) => void take(e.target.files)} />

      <button type="button"
              className={`w-paper${over ? " w-paper--over" : ""}`}
              disabled={disabled}
              onClick={() => picker.current?.click()}
              onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                if (!disabled) void take(e.dataTransfer.files);
              }}>
        <span className="w-paper__call">
          {uploading ? "Reading it…" : "Upload the form, or drop it here"}
        </span>
        <span className="w-paper__kinds">
          A PDF, a photograph of the sheet, or a plain text file. Up to 10MB.
        </span>
      </button>

      {docs.map((d) => (
        <div className="w-paper__row" key={d.ref}>
          <span className="w-chip">form</span>
          <span className="w-paper__name">{d.name}</span>
          {/* Drops the reference, and the Scoper stops being shown it from the next turn on.
              The object itself stays where it was put — `storage.rules` grants no delete on
              this prefix, and an unreferenced private form is a smaller thing than a browser
              that can erase what it uploaded. */}
          <button type="button" className="w-btn w-btn--text" disabled={busy}
                  onClick={() => setDocs((prev) => prev.filter((x) => x.ref !== d.ref))}>
            Remove
          </button>
        </div>
      ))}

      {problem && (
        <HoldBanner kind="fixture" title={problem}>
          Nothing else was lost. Try another file, or type the form out below.
        </HoldBanner>
      )}
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
      acceptance_description?: string | null; guidance?: string | null;
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
              <div className="w-def" key={j}>
                <div className="w-def__head">
                  <span className="w-def__term w-mono">{f.key}</span>
                  <span className="w-def__meta">{f.kind} · {f.source}</span>
                </div>
                <p className="w-def__note">{f.prompt}</p>
                {fieldRule(f) && <p className="w-step__guide">{fieldRule(f)}</p>}
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

/**
 * The acceptance rule in a sentence, with its figure. A rule you cannot read is a rule you
 * cannot dispute.
 *
 * `acceptance_target` and `acceptance_description` are nullable in the contract and are
 * legitimately null — a `signed_by` with nobody named is a shop where the technician signs for
 * their own work, which is most of them. Interpolating the field regardless printed "Must be
 * signed by undefined." on the last screen before publishing, which reads as a broken page
 * rather than as the true statement it was standing in for.
 *
 * Where the figure is absent the sentence is shortened rather than filled in. This screen is
 * the one place a shop can say "that is not our number", so a plausible number it never gave
 * is the single worst thing that could appear here — the same reason the Scoper is forbidden
 * to invent one. `fieldRule` below falls back to the Scoper's own `guidance`, which is a
 * sentence somebody actually wrote, not one this function guessed.
 */
function describeRule(f: NonNullable<NonNullable<DraftView["steps"]>[number]["fields"]>[number]): string {
  const unit = f.acceptance_unit ? ` ${f.acceptance_unit}` : "";
  switch (f.acceptance_rule) {
    case "within":
      if (typeof f.acceptance_min === "number" && typeof f.acceptance_max === "number")
        return `Passes between ${f.acceptance_min} and ${f.acceptance_max}${unit}.`;
      if (typeof f.acceptance_min === "number") return `Passes at or above ${f.acceptance_min}${unit}.`;
      if (typeof f.acceptance_max === "number") return `Passes at or below ${f.acceptance_max}${unit}.`;
      return "";
    case "matches":
      return f.acceptance_target ? `Must match ${f.acceptance_target}.` : "";
    case "per_spec":
      return f.acceptance_target
        ? `Judged against the figure printed on ${f.acceptance_target} — this procedure carries no number of its own.`
        : "";
    case "must_show":
      return f.acceptance_description ? `The capture must show ${f.acceptance_description}.` : "";
    case "consistent_with":
      return f.acceptance_target ? `Must be consistent with ${f.acceptance_target}.` : "";
    case "signed_by":
      return f.acceptance_target ? `Must be signed by ${f.acceptance_target}.` : "Must be signed.";
    default:
      return "";
  }
}

/** The rule as stated, or the Scoper's own words for it. Never a figure nobody gave. */
function fieldRule(f: NonNullable<NonNullable<DraftView["steps"]>[number]["fields"]>[number]): string {
  return describeRule(f) || (f.guidance ?? "").trim();
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
        <div className="w-def">
          <div className="w-def__head">
            <span className="w-def__term">Tenant</span>
            <span className="w-def__meta">{published.tenant}</span>
          </div>
          <p className="w-def__note">
            It lives under this tenant and nowhere else. No visibility flag is doing that work —
            firestore.rules makes the subtree unreachable to anyone outside the organisation.
          </p>
        </div>
        <div className="w-def">
          <div className="w-def__head">
            <span className="w-def__term">Needs a surface that can reach</span>
            <span className="w-def__meta">{published.minimum_tier}</span>
          </div>
          <p className="w-def__note">
            Derived from the fields, never chosen. A surface below this is refused before the job
            starts rather than downgraded to let it through.
          </p>
        </div>
      </div>
      <a className="w-btn" href="/">Run it</a>
    </div>
  );
}
