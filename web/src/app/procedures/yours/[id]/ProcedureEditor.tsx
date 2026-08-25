"use client";

// Changing what a procedure says, by hand.
//
// The Scoper interview is how you get a procedure when you do not yet know what it should
// say. This is how you change one when you do — and before it existed there was no way to fix
// a wrong torque figure short of sitting through fourteen turns of conversation again.
//
// ## Nothing here can affect a job that is running
//
// Every control writes to the live DRAFT and nothing else. The frozen versions a job pinned
// are unreachable from this page by construction, and the server refuses to touch them too —
// web/src/server/procedure-edit.ts says why at length. Publish is the separate act that
// freezes the next version, and it is the only button on this page that changes what anybody
// is judged against.
//
// ## Saving
//
// There is no Save button, and that is the point: a form with one is a form you can lose work
// in. Every control commits by itself — selects when they change, text when it loses focus —
// and the server answers with the whole procedure, which replaces local state wholesale.
// That is also why nothing is re-read afterwards: the server has just said what it wrote, and
// a re-read would race Firestore's own propagation and flick the field back to its old value
// for a moment, which reads as the save having failed. YourProcedures.tsx makes the same
// choice for the same reason.
//
// The text inputs keep a local draft while you type, because a controlled input that made a
// network round trip per keystroke would drop characters. The draft is reconciled from the
// server's answer whenever it is not being edited.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HoldBanner, Rule } from "@/components";
import { getDataSource, scoped } from "@/data";
import { useSession } from "@/auth/session-context";
import { currentTenantId } from "@/auth/current-tenant";
import type { FieldDef, Procedure, Step } from "@/generated/types";

const STRICTNESS = ["log", "standard", "assured", "regulated"];

/** The level that means never. Strictness tops out at 3, so nothing reaches it. */
const NEVER = 4;

const REQUIRED_LEVELS = [
  { value: 0, label: "Always" },
  { value: 1, label: "Standard and above" },
  { value: 2, label: "Assured and above" },
  { value: 3, label: "Regulated only" },
  { value: NEVER, label: "Never — optional" },
];

const KINDS: FieldDef["kind"][] =
  ["measurement", "photo", "video", "scan", "choice", "text", "signature", "location"];
const SOURCES: FieldDef["source"][] = ["instrument", "camera", "human"];
const RULES: FieldDef["acceptance_rule"][] =
  ["within", "matches", "must_show", "consistent_with", "per_spec", "signed_by"];

/** What each acceptance rule needs stated before `faults()` will let it through. */
const RULE_HINT: Record<FieldDef["acceptance_rule"], string> = {
  within: "Needs a bound and a unit. A number with no unit is not a measurement.",
  matches: "Needs a target — what the answer is checked against.",
  must_show: "What the photograph has to contain. Say it in the guidance too.",
  consistent_with: "Needs a target — what it has to agree with.",
  per_spec: "Needs a target naming where the figure is printed, so the procedure carries no number of its own.",
  signed_by: "Resolves against the authenticated member who signed it.",
};

export function ProcedureEditor({ procedureId }: { procedureId: string }) {
  const router = useRouter();
  const { session } = useSession();
  const tenantId = currentTenantId(session);
  const src = useMemo(() => getDataSource(), []);

  const [procedure, setProcedure] = useState<Procedure | null>(null);
  const [loading, setLoading] = useState(true);
  const [refused, setRefused] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [faults, setFaults] = useState<string[]>([]);
  /**
   * What the publish REMOVED, on a publish that succeeded.
   *
   * Separate from [faults] because it is the opposite kind of news. A fault is a refusal —
   * nothing was published and the author has to go and fix it. This is a list of things that
   * could never have been performed and so are not in the version that just froze: the
   * procedure is live, and it is live without them. Merging the two would either hide a
   * removal behind "Published" or make a successful publish read as a failure.
   */
  const [dropped, setDropped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setRefused(null);
      try {
        // LiveSource addresses a procedure `{tenant}/{procedure}`; the URL carries the bare id
        // because that is what the list page has. FixtureSource accepts either.
        const p = await src.getProcedure(scoped(tenantId, procedureId));
        if (alive) {
          setProcedure(p);
          if (!p) setRefused("No procedure with that id is readable from this tenant.");
        }
      } catch (e) {
        if (alive) setRefused(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [src, tenantId, procedureId]);

  /**
   * One op, one round trip, one whole procedure back.
   *
   * Returning the entire document rather than a patch is what keeps this component from having
   * to reimplement the server's invariants — re-indexing steps, re-deriving `minimum_tier`. A
   * client that computed those would be a second implementation free to disagree with the
   * first.
   */
  const op = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setFaults([]);
    try {
      const res = await fetch("/api/procedures/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ procedure_id: procedureId, ...body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "That did not go through.");
        return null;
      }
      if (json.procedure) setProcedure(json.procedure as Procedure);
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [procedureId]);

  const publish = useCallback(async () => {
    setBusy(true);
    setError(null);
    setFaults([]);
    setDropped([]);
    setNote(null);
    try {
      const res = await fetch("/api/procedures/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ procedure_id: procedureId }),
      });
      const json = await res.json();
      if (!res.ok) {
        // 422 carries every reason at once. They are shown as a list rather than joined into
        // one sentence, because each one names a different control on this page.
        if (Array.isArray(json.faults)) setFaults(json.faults as string[]);
        setError(json.error ?? "That did not go through.");
        return;
      }
      // Re-read here, unlike everywhere else: publishing is the one act whose answer this page
      // does not already hold — the version number was minted server-side.
      const fresh = await src.getProcedure(scoped(tenantId, procedureId));
      setProcedure(fresh);
      if (Array.isArray(json.dropped)) setDropped(json.dropped as string[]);
      setNote(`Frozen as v${json.version}. Jobs already running are untouched — they are pinned to the version they started under.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [procedureId, src, tenantId]);

  const destroy = useCallback(async () => {
    const answer = await op({ op: "delete" });
    if (answer?.deleted) router.push("/procedures/yours");
  }, [op, router]);

  if (loading) return <p className="records__empty">Reading this procedure…</p>;

  if (refused || !procedure) {
    return (
      <div className="stack stack--lg">
        <HoldBanner title="This procedure could not be read">
          {refused ?? "No procedure with that id is readable from this tenant."}
        </HoldBanner>
        <Link className="w-btn" href="/procedures/yours">Back to your procedures</Link>
      </div>
    );
  }

  const steps = procedure.steps ?? [];
  const published = procedure.status === "published";
  const archived = procedure.status === "archived";
  const frozen = procedure.current_version ?? procedure.version ?? 0;
  // The draft has moved on from what was last frozen. No flag records this and none should:
  // the two timestamps already say it, and a third field could disagree with them.
  const dirty = Boolean(
    procedure.updated_at && procedure.published_at && procedure.updated_at > procedure.published_at,
  );

  return (
    <div className="stack stack--lg pe">
      <div className="stack">
        <p className="eyebrow">
          <Link href="/procedures/yours">Your procedures</Link> · {procedure.key}
        </p>
        <div className="pe__head">
          <TextControl
            className="pe__title"
            value={procedure.title}
            placeholder="What is this procedure called?"
            disabled={busy || archived}
            onCommit={(title) => void op({ op: "update_procedure", patch: { title } })}
          />
          <div className="gallery__row">
            <span className="w-chip">{frozen > 0 ? `v${frozen}` : "never published"}</span>
            <span className="w-chip">{STRICTNESS[procedure.strictness] ?? procedure.strictness}</span>
            <span className="w-chip">{procedure.minimum_tier}</span>
            {archived && <span className="w-chip w-chip--out">archived</span>}
            {dirty && !archived && <span className="w-chip w-chip--out">edited since v{frozen}</span>}
          </div>
        </div>
        <p className="lede">
          Everything below edits the DRAFT. Jobs already running are pinned to the version they
          started under, so nothing here can change the steps under somebody&rsquo;s hands.
          Publishing is what freezes the next version.
        </p>
      </div>

      {archived && (
        <HoldBanner title="This procedure is out of service">
          Nobody can start a job against it and the public copy has been taken down. Its frozen
          versions and every record judged against them are untouched. Restore it to edit it —
          it comes back as a draft, because the reason it was retired is the thing worth
          re-reading first.
          <div className="w-step__exits">
            <button className="w-btn" disabled={busy} onClick={() => void op({ op: "restore" })}>
              Restore it as a draft
            </button>
          </div>
        </HoldBanner>
      )}

      {error && (
        <HoldBanner title="Nothing changed">
          {error}
          {faults.length > 0 && (
            <ul className="pe__faults">
              {faults.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
        </HoldBanner>
      )}

      {note && <HoldBanner kind="fixture" title="Published">{note}</HoldBanner>}

      {/*
        Shown ALONGSIDE "Published", never instead of it. The procedure is live; these are the
        parts of it that could never have been satisfied by anybody and are not in the frozen
        version. Refusing the publish over them was the old behaviour and it helped nobody —
        a field with no possible answer stops the technician dead on the step that carries it,
        and every step behind it with them. So it goes, and it is named here.
      */}
      {dropped.length > 0 && (
        <HoldBanner title="Published without these">
          Nobody could have satisfied {dropped.length === 1 ? "this" : "these"}, so
          {dropped.length === 1 ? " it is" : " they are"} not in the version you just froze. A
          technician handed a box that cannot be ticked cannot finish the job. Author
          {dropped.length === 1 ? " it" : " them"} properly and publish again if the check matters.
          <ul className="pe__faults">
            {dropped.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </HoldBanner>
      )}

      {/* --- what the procedure itself declares ------------------------------------- */}
      <div className="pe__grid">
        <div className="pe__cell">
          <label className="pe__label">Strictness</label>
          <select
            className="pe__select"
            value={procedure.strictness}
            disabled={busy || archived}
            onChange={(e) => void op({
              op: "update_procedure", patch: { strictness: Number(e.target.value) },
            })}
          >
            {STRICTNESS.map((s, i) => <option key={s} value={i}>{i} — {s}</option>)}
          </select>
          <p className="pe__hint">
            What is at stake. It decides which steps and captures are required at all: anything
            marked above this level is optional on every job run from here.
          </p>
        </div>
        <div className="pe__cell">
          <label className="pe__label">Minimum tier</label>
          <input className="pe__input" value={procedure.minimum_tier} disabled readOnly />
          <p className="pe__hint">
            Derived from the fields, never chosen — one instrument field puts this procedure out
            of a browser&rsquo;s reach, and a surface below it is refused rather than downgraded.
          </p>
        </div>
        <div className="pe__cell pe__cell--wide">
          <label className="pe__label">Disqualifiers</label>
          <TextControl
            className="pe__input"
            value={(procedure.disqualifiers ?? []).join(", ")}
            placeholder="Cracked disc, contaminated pad — comma separated"
            disabled={busy || archived}
            onCommit={(v) => void op({
              op: "update_procedure",
              patch: { disqualifiers: v.split(",").map((s) => s.trim()).filter(Boolean) },
            })}
          />
          <p className="pe__hint">
            Findings that stop the job and hold the machine whatever else passed.
          </p>
        </div>
        <div className="pe__cell pe__cell--wide">
          <label className="pe__label">Releases</label>
          <TextControl
            className="pe__input"
            value={(procedure.releases ?? []).join(", ")}
            placeholder="Return to service — comma separated"
            disabled={busy || archived}
            onCommit={(v) => void op({
              op: "update_procedure",
              patch: { releases: v.split(",").map((s) => s.trim()).filter(Boolean) },
            })}
          />
          <p className="pe__hint">What this procedure, completed, entitles the machine to do.</p>
        </div>
      </div>

      <Rule />

      {/* --- the steps -------------------------------------------------------------- */}
      <div className="stack">
        <p className="gallery__label">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </p>
        {steps.map((step, i) => (
          <StepEditor
            key={step.id}
            step={step}
            strictness={procedure.strictness}
            first={i === 0}
            last={i === steps.length - 1}
            busy={busy}
            frozen={archived}
            op={op}
          />
        ))}
        <button
          className="w-btn w-btn--tonal"
          disabled={busy || archived}
          onClick={() => void op({ op: "add_step" })}
        >
          Add a step
        </button>
      </div>

      <Rule />

      {/* --- the acts that change what anybody is judged against --------------------- */}
      <div className="w-step__exits">
        <button className="w-btn" disabled={busy || archived} onClick={() => void publish()}>
          {published ? `Publish v${frozen + 1}` : "Publish v1"}
        </button>
        {!archived && (
          <button
            className="w-btn w-btn--ghost"
            disabled={busy}
            onClick={() => void op({ op: "archive" })}
          >
            Take it out of service
          </button>
        )}
        {frozen === 0 && (
          <button className="w-btn w-btn--text" disabled={busy} onClick={() => void destroy()}>
            Delete it
          </button>
        )}
      </div>
      <p className="pe__hint">
        {frozen === 0
          ? "Never published and never run, so deleting it destroys no evidence. Once a version is frozen, the only exit is taking it out of service — records were judged against those versions and a record whose procedure cannot be read is a record nobody can check."
          : "Publishing freezes a new version. Jobs already running keep the version they started under, and every sealed record still names the one that ran."}
      </p>

      {src.fabricated && (
        <HoldBanner kind="fixture" title="Fixture data">
          This surface is bound to the fixture layer, so the procedure above is fabricated and
          edits will be refused — there is no session behind them and nothing in Firestore to
          write. Set <code className="w-mono">NEXT_PUBLIC_WARRANT_DATA_SOURCE=live</code> in{" "}
          <code className="w-mono">web/.env.local</code> and sign in to edit a real one.
        </HoldBanner>
      )}
    </div>
  );
}

// ---- one step ---------------------------------------------------------------------------

function StepEditor({
  step, strictness, first, last, busy, frozen, op,
}: {
  step: Step;
  strictness: number;
  first: boolean;
  last: boolean;
  busy: boolean;
  frozen: boolean;
  op: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const requiredAt = step.required_at_strictness ?? 0;
  // Optional HERE — at this procedure's strictness — rather than optional in the abstract. A
  // step required at 3 is mandatory on a regulated procedure and optional on a standard one,
  // and the person editing wants to know which of those they are looking at.
  const optional = requiredAt > strictness;
  const disabled = busy || frozen;

  return (
    <section className={`pe__step${optional ? " pe__step--optional" : ""}`}>
      <div className="pe__stephead">
        <span className="pe__num">Step {step.index}</span>
        <div className="pe__tools">
          <button className="pe__mini" disabled={disabled || first}
                  onClick={() => void op({ op: "move_step", step_id: step.id, direction: "up" })}>
            Move up
          </button>
          <button className="pe__mini" disabled={disabled || last}
                  onClick={() => void op({ op: "move_step", step_id: step.id, direction: "down" })}>
            Move down
          </button>
          <button className="pe__mini" disabled={disabled}
                  onClick={() => void op({ op: "add_step", step_id: step.id })}>
            Add step after
          </button>
          <button className="pe__mini pe__mini--danger" disabled={disabled}
                  onClick={() => void op({ op: "delete_step", step_id: step.id })}>
            Delete step
          </button>
        </div>
      </div>

      <div className="pe__grid">
        <div className="pe__cell pe__cell--wide">
          <label className="pe__label">Title</label>
          <TextControl
            className="pe__input"
            value={step.title}
            placeholder="What the technician is being asked to do"
            disabled={disabled}
            onCommit={(title) => void op({ op: "update_step", step_id: step.id, patch: { title } })}
          />
        </div>
        <div className="pe__cell pe__cell--wide">
          <label className="pe__label">Why this step exists</label>
          <TextControl
            as="textarea"
            className="pe__text"
            value={step.explanation}
            placeholder="What goes wrong without it, in the shop's own terms."
            disabled={disabled}
            onCommit={(explanation) => void op({
              op: "update_step", step_id: step.id, patch: { explanation },
            })}
          />
          <p className="pe__hint">
            A step nobody can justify is a step to cut, and publishing is refused without this.
          </p>
        </div>
        <div className="pe__cell">
          <label className="pe__label">Required</label>
          <select
            className="pe__select"
            value={requiredAt}
            disabled={disabled}
            onChange={(e) => void op({
              op: "update_step", step_id: step.id,
              patch: { required_at_strictness: Number(e.target.value) },
            })}
          >
            {REQUIRED_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
          <p className="pe__hint">
            {optional
              ? "Optional on this procedure. The step is still shown and can still be performed — it just cannot hold the job open or hold the machine."
              : "Required. The job cannot seal until this step has an outcome."}
          </p>
        </div>
        <div className="pe__cell">
          <label className="pe__label">Show only if</label>
          <TextControl
            className="pe__input"
            value={step.condition ?? ""}
            placeholder="Always"
            disabled={disabled}
            onCommit={(condition) => void op({
              op: "update_step", step_id: step.id, patch: { condition },
            })}
          />
        </div>
        <div className="pe__cell">
          <label className="pe__label">Inspector may ask for more</label>
          <select
            className="pe__select"
            value={step.max_add_fields}
            disabled={disabled}
            onChange={(e) => void op({
              op: "update_step", step_id: step.id,
              patch: { max_add_fields: Number(e.target.value) },
            })}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n} time{n === 1 ? "" : "s"}</option>
            ))}
          </select>
          <p className="pe__hint">
            On exhaustion the step escalates with the unresolved question rather than asking again.
          </p>
        </div>
      </div>

      <div className="stack">
        <p className="pe__label">
          {step.fields.length} capture{step.fields.length === 1 ? "" : "s"}
        </p>
        {step.fields.map((field, i) => (
          <FieldEditor
            key={field.key}
            field={field}
            stepId={step.id}
            strictness={strictness}
            first={i === 0}
            last={i === step.fields.length - 1}
            disabled={disabled}
            op={op}
          />
        ))}
        <button className="pe__mini" disabled={disabled}
                onClick={() => void op({ op: "add_field", step_id: step.id })}>
          Add a capture
        </button>
      </div>
    </section>
  );
}

// ---- one field --------------------------------------------------------------------------

function FieldEditor({
  field, stepId, strictness, first, last, disabled, op,
}: {
  field: FieldDef;
  stepId: string;
  strictness: number;
  first: boolean;
  last: boolean;
  disabled: boolean;
  op: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const optional = field.required_at_strictness > strictness;
  const patch = (p: Record<string, unknown>) =>
    void op({ op: "update_field", step_id: stepId, field_key: field.key, patch: p });

  // Which acceptance inputs are meaningful. Showing all six at once would put a bound on a
  // signature and a target on a photograph, and a field that carries values its rule ignores is
  // a field the next reader has to work out the meaning of.
  const wantsBound = field.acceptance_rule === "within";
  const wantsTarget = ["matches", "consistent_with", "per_spec", "signed_by"]
    .includes(field.acceptance_rule);
  const wantsDescription = field.acceptance_rule === "must_show";

  return (
    <div className={`pe__field${optional ? " pe__field--optional" : ""}`}>
      <div className="pe__stephead">
        <span className="pe__num w-mono">{field.key}</span>
        <div className="pe__tools">
          <button className="pe__mini" disabled={disabled || first}
                  onClick={() => void op({
                    op: "move_field", step_id: stepId, field_key: field.key, direction: "up",
                  })}>
            Up
          </button>
          <button className="pe__mini" disabled={disabled || last}
                  onClick={() => void op({
                    op: "move_field", step_id: stepId, field_key: field.key, direction: "down",
                  })}>
            Down
          </button>
          <button className="pe__mini pe__mini--danger" disabled={disabled}
                  onClick={() => void op({
                    op: "delete_field", step_id: stepId, field_key: field.key,
                  })}>
            Delete
          </button>
        </div>
      </div>

      <div className="pe__grid">
        <div className="pe__cell">
          <label className="pe__label">Key</label>
          <TextControl
            className="pe__input w-mono"
            value={field.key}
            disabled={disabled}
            onCommit={(key) => patch({ key })}
          />
          <p className="pe__hint">Stable within the step. e.g. pad_torque.</p>
        </div>
        <div className="pe__cell">
          <label className="pe__label">Kind</label>
          <select className="pe__select" value={field.kind} disabled={disabled}
                  onChange={(e) => patch({ kind: e.target.value })}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="pe__cell pe__cell--wide">
          <label className="pe__label">Prompt</label>
          <TextControl
            className="pe__input"
            value={field.prompt}
            placeholder="What to do, addressed to the technician."
            disabled={disabled}
            onCommit={(prompt) => patch({ prompt })}
          />
        </div>
        <div className="pe__cell">
          <label className="pe__label">Source</label>
          <select className="pe__select" value={field.source} disabled={disabled}
                  onChange={(e) => patch({ source: e.target.value })}>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <p className="pe__hint">
            Instrument is the only source that can reach the measured class — and choosing it
            puts this whole procedure out of a browser&rsquo;s reach.
          </p>
        </div>
        <div className="pe__cell">
          <label className="pe__label">Required</label>
          <select
            className="pe__select"
            value={field.required_at_strictness}
            disabled={disabled}
            onChange={(e) => patch({ required_at_strictness: Number(e.target.value) })}
          >
            {REQUIRED_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
          <p className="pe__hint">
            {optional
              ? "Optional here. Still captured and still judged if it is taken — it just cannot hold the step."
              : "Required. The step is not performed until this has been accepted."}
          </p>
        </div>

        {field.kind === "choice" && (
          <div className="pe__cell pe__cell--wide">
            <label className="pe__label">Choices</label>
            <TextControl
              className="pe__input"
              value={(field.choices ?? []).join(", ")}
              placeholder="Comma separated"
              disabled={disabled}
              onCommit={(v) => patch({ choices: v.split(",").map((s) => s.trim()).filter(Boolean) })}
            />
            <p className="pe__hint">
              At least two, and one of them must be the answer that means the job is NOT right.
              A choice offering only &ldquo;done&rdquo; is a tick box with the box already ticked.
            </p>
          </div>
        )}

        <div className="pe__cell">
          <label className="pe__label">Judged by</label>
          <select className="pe__select" value={field.acceptance_rule} disabled={disabled}
                  onChange={(e) => patch({ acceptance_rule: e.target.value })}>
            {RULES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <p className="pe__hint">{RULE_HINT[field.acceptance_rule]}</p>
        </div>

        {wantsBound && (
          <>
            <div className="pe__cell">
              <label className="pe__label">Minimum</label>
              <TextControl
                className="pe__input" type="number"
                value={field.acceptance_min === null || field.acceptance_min === undefined
                  ? "" : String(field.acceptance_min)}
                disabled={disabled}
                onCommit={(v) => patch({ acceptance_min: v === "" ? null : Number(v) })}
              />
            </div>
            <div className="pe__cell">
              <label className="pe__label">Maximum</label>
              <TextControl
                className="pe__input" type="number"
                value={field.acceptance_max === null || field.acceptance_max === undefined
                  ? "" : String(field.acceptance_max)}
                disabled={disabled}
                onCommit={(v) => patch({ acceptance_max: v === "" ? null : Number(v) })}
              />
            </div>
            <div className="pe__cell">
              <label className="pe__label">Unit</label>
              <TextControl
                className="pe__input"
                value={field.acceptance_unit ?? ""}
                placeholder="Nm, mm, bar"
                disabled={disabled}
                onCommit={(v) => patch({ acceptance_unit: v })}
              />
            </div>
          </>
        )}

        {wantsTarget && (
          <div className="pe__cell pe__cell--wide">
            <label className="pe__label">Target</label>
            <TextControl
              className="pe__input"
              value={field.acceptance_target ?? ""}
              placeholder="Where the figure is printed, or what the answer resolves against"
              disabled={disabled}
              onCommit={(v) => patch({ acceptance_target: v })}
            />
          </div>
        )}

        {wantsDescription && (
          <div className="pe__cell pe__cell--wide">
            <label className="pe__label">What the media must show</label>
            <TextControl
              className="pe__input"
              value={field.acceptance_description ?? ""}
              disabled={disabled}
              onCommit={(v) => patch({ acceptance_description: v })}
            />
          </div>
        )}

        <div className="pe__cell pe__cell--wide">
          <label className="pe__label">What good looks like</label>
          <TextControl
            as="textarea"
            className="pe__text"
            value={field.guidance}
            placeholder="Shown to the technician BEFORE the capture. The same rule the Inspector applies after it."
            disabled={disabled}
            onCommit={(guidance) => patch({ guidance })}
          />
          <p className="pe__hint">
            Every round trip this prevents is a model call the Ledger does not spend.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- a control that does not fight you --------------------------------------------------

/**
 * Text that commits when you leave it, not when you type.
 *
 * Local state while focused, so no keystroke waits on a network round trip; reconciled from
 * the server's value whenever it is not being edited, so an answer that differs from what was
 * typed — a trimmed title, a refused rename — actually shows. Committing on blur rather than
 * on change is what makes one save per edit instead of one per character.
 */
function TextControl({
  value, onCommit, className, placeholder, disabled, type, as,
}: {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  as?: "textarea";
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    focused.current = false;
    if (draft !== value) onCommit(draft);
  };

  const props = {
    className,
    value: draft,
    placeholder,
    disabled,
    onFocus: () => { focused.current = true; },
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  };

  if (as === "textarea") return <textarea {...props} />;
  return <input {...props} type={type} />;
}
