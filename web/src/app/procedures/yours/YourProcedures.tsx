"use client";

// Every procedure this tenant has authored, and which of them the world can see.
//
// It did not exist until now, which is why a shop that finished an interview and pressed
// Publish had nowhere to go and no way to tell whether anything had been written. The
// authoring desk ended on a page about the version it had just frozen and then stopped.
//
// Nothing is seeded here. A row exists because somebody sat through a Scoper interview, or
// built one by hand at /procedures/yours/{id} — which is the same document either way, and the
// reason this page no longer claims a procedure can only come out of an interview.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HoldBanner, Rule } from "@/components";
import { getDataSource } from "@/data";
import { isBundled } from "@/data/catalogue";
import { useSession } from "@/auth/session-context";
import { currentTenantId } from "@/auth/current-tenant";
import type { Procedure } from "@/generated/types";

const STRICTNESS = ["log", "standard", "assured", "regulated"];

export function YourProcedures() {
  const router = useRouter();
  const { session, ensureSession } = useSession();
  const tenantId = currentTenantId(session);
  const src = useMemo(() => getDataSource(), []);

  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [refused, setRefused] = useState<string | null>(null);
  // Which row is mid-call, so two clicks cannot race one another to the same document.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Retired procedures are kept out of the way rather than deleted. They are still the thing
  // sealed records were judged against, so a shop has to be able to find them again.
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setRefused(null);
      try {
        const p = await src.listProcedures(tenantId);
        // The bundled catalogue is copied into every tenant by `/api/procedures/seed`, so those
        // sit in this collection looking exactly like authored work. Subtracting them is what
        // makes this page answer "what have I written?" rather than "what is in my tenant?".
        if (alive) setProcedures(p.filter((row) => !isBundled(row.id)));
      } catch (e) {
        // Against LiveSource this read goes through firestore.rules. A refusal must SHOW
        // rather than spin — the same reason Records.tsx catches here.
        if (alive) setRefused(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [src, tenantId]);

  /**
   * Show it to the world, or take it back down.
   *
   * The answer is applied to local state rather than re-read, because the server has just told
   * us what it wrote and a re-read would race Firestore's own propagation — the row would flick
   * back to its old state for a moment, which reads as the click having failed.
   */
  const setPublic = useCallback(async (procedure: Procedure, next: boolean) => {
    setBusy(procedure.id);
    setError(null);
    try {
      const res = await fetch("/api/procedures/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ procedure_id: procedure.id, public: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "That did not go through.");
        return;
      }
      setProcedures((rows) => rows.map((r) =>
        r.id === procedure.id ? { ...r, public_id: body.public_id ?? null } : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  /**
   * A new one, by hand.
   *
   * No dialog and no name asked for. The editor opens on a procedure that already exists, with
   * one step and one capture in it, and the title is the first thing on the page — which is a
   * shorter road to a procedure than a modal that asks for a name before showing you anything.
   * It is a draft nobody can run until it is published, so creating one costs nothing.
   */
  const create = useCallback(async () => {
    setBusy("new");
    setError(null);
    try {
      const res = await fetch("/api/procedures/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "create", title: "Untitled procedure" }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "That did not go through.");
        setBusy(null);
        return;
      }
      router.push(`/procedures/yours/${encodeURIComponent(body.procedure.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }, [router]);

  /**
   * Run it, from the page that lists it.
   *
   * The picker starts the bundled tasks and this page starts yours, because after this page
   * began subtracting the catalogue there was no surface left that could start an authored
   * procedure at all — you could publish one, share it with the world, and still have no way
   * to perform it yourself.
   *
   * `tier: "open"` matches the picker. A procedure whose minimum tier is higher is refused
   * before the job starts rather than quietly downgraded, which is the check the job screen
   * already makes.
   */
  const run = useCallback(async (procedure: Procedure) => {
    setBusy(procedure.id);
    setError(null);
    try {
      const active = await ensureSession();
      const job = await src.startJob({
        procedureId: procedure.id,
        tenantId: currentTenantId(active),
        tier: "open",
      });
      // A scoped id is `tenant/doc`; one encoded segment, not two. See TaskCarousel.
      router.push(`/job/${encodeURIComponent(job.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }, [ensureSession, router, src]);

  // Archived rows are hidden by default and counted anyway, so the toggle can say how many
  // there are. A shop that retires a procedure has not deleted it — the records judged against
  // its frozen versions are still out there naming it, and it must stay findable.
  const archivedCount = procedures.filter((p) => p.status === "archived").length;
  const visible = showArchived ? procedures : procedures.filter((p) => p.status !== "archived");

  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="eyebrow">Procedures</p>
        <h1 className="hero">What you have written</h1>
        <p className="lede">
          A procedure governs every job ever run against it. These are yours: private to this
          tenant until you say otherwise, and frozen version by version so a record can name the
          one it ran.
        </p>
        <div className="w-step__exits">
          <button className="w-btn" disabled={busy === "new"} onClick={() => void create()}>
            {busy === "new" ? "Working…" : "New procedure"}
          </button>
          <Link className="w-btn w-btn--ghost" href="/author">
            Author one by interview
          </Link>
        </div>
      </div>

      {loading && <p className="records__empty">Reading this tenant&rsquo;s procedures…</p>}

      {refused && (
        <HoldBanner title="This tenant&rsquo;s procedures could not be read">
          {refused}
        </HoldBanner>
      )}

      {error && <HoldBanner title="Nothing changed">{error}</HoldBanner>}

      {!loading && !refused && visible.length === 0 && (
        <div className="stack">
          <p className="records__empty">
            {procedures.length === 0
              ? "Nothing yet. Two roads in: an interview, which is right when you do not yet know what your procedure should say, or a blank one you fill in yourself. The bundled tasks in the picker are not counted here, because you did not write them."
              : "Everything you have written is out of service. Show the archived ones to bring one back."}
          </p>
        </div>
      )}

      {archivedCount > 0 && (
        <button className="w-btn w-btn--text" onClick={() => setShowArchived((v) => !v)}>
          {showArchived
            ? "Hide the archived ones"
            : `Show ${archivedCount} archived procedure${archivedCount === 1 ? "" : "s"}`}
        </button>
      )}

      {visible.length > 0 && (
        <div className="stack">
          {visible.map((p) => {
            const isPublic = Boolean(p.public_id);
            const published = p.status === "published";
            const archived = p.status === "archived";
            return (
              <div className="w-def" key={p.id}>
                <div className="w-def__head">
                  <span className="w-def__term">{p.title}</span>
                  <span className="w-def__meta">{p.key}</span>
                </div>
                <div className="gallery__row">
                  <span className="w-chip">
                    {published ? `v${p.current_version ?? p.version}` : "draft"}
                  </span>
                  <span className="w-chip">{STRICTNESS[p.strictness] ?? p.strictness}</span>
                  <span className="w-chip">{p.minimum_tier}</span>
                  <span className={`w-chip${isPublic ? "" : " w-chip--out"}`}>
                    {isPublic ? "public" : "private"}
                  </span>
                  {archived && <span className="w-chip w-chip--out">archived</span>}
                </div>
                <p className="w-def__note">
                  {archived
                    ? "Out of service. Nobody can start a job against it and the public copy has been taken down. Its frozen versions and every record judged against them are untouched — open it to bring it back as a draft."
                    : isPublic
                    ? `Anyone can read v${p.current_version ?? p.version} of this, including the steps and every acceptance rule. Your drafts and every record run against it stay private.`
                    : published
                      ? "Private to this tenant. Nobody outside it can read this, whatever any flag says — the tenant subtree is unreachable to them."
                      : "Still drafting. Publish it to freeze a version; only a frozen version can be made public, because a draft would change under whoever was reading it."}
                </p>
                <div className="w-step__exits">
                  {/* Running comes first: it is what a procedure is FOR, and sharing is the
                      administrative act you do once in its life. Editing sits between them —
                      an archived procedure offers only that, because opening it is the one
                      thing you can still do with it. */}
                  {!archived && (
                    <button
                      className="w-btn"
                      disabled={!published || busy === p.id}
                      onClick={() => void run(p)}
                    >
                      {busy === p.id ? "Working…" : "Run it"}
                    </button>
                  )}
                  <Link
                    className={`w-btn ${archived ? "" : "w-btn--ghost"}`}
                    href={`/procedures/yours/${encodeURIComponent(p.id)}`}
                  >
                    {archived ? "Open it" : "Edit the steps"}
                  </Link>
                  {!archived && (
                    <button
                      className={`w-btn ${isPublic ? "w-btn--ghost" : "w-btn--tonal"}`}
                      disabled={!published || busy === p.id}
                      onClick={() => void setPublic(p, !isPublic)}
                    >
                      {busy === p.id
                        ? "Working…"
                        : isPublic ? "Make it private" : "Show it to the world"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !refused && src.fabricated && (
        <>
          <Rule />
          <HoldBanner kind="fixture" title="Fixture data">
            This surface is bound to the fixture layer, so what you see above is fabricated and
            is not what is in Firestore. A procedure you published really was written — you are
            not looking at it. Set <code className="w-mono">NEXT_PUBLIC_WARRANT_DATA_SOURCE=live</code>{" "}
            in <code className="w-mono">web/.env.local</code> and sign in to read the real ones.
          </HoldBanner>
        </>
      )}
    </div>
  );
}
