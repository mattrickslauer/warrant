"use client";

// Every procedure this tenant has authored, and which of them the world can see.
//
// It did not exist until now, which is why a shop that finished an interview and pressed
// Publish had nowhere to go and no way to tell whether anything had been written. The
// authoring desk ended on a page about the version it had just frozen and then stopped.
//
// Nothing is seeded here. A row exists because somebody sat through a Scoper interview.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HoldBanner, Rule } from "@/components";
import { getDataSource } from "@/data";
import { useSession } from "@/auth/session-context";
import { currentTenantId } from "@/auth/current-tenant";
import type { Procedure } from "@/generated/types";

const STRICTNESS = ["log", "standard", "assured", "regulated"];

export function YourProcedures() {
  const { session } = useSession();
  const tenantId = currentTenantId(session);
  const src = useMemo(() => getDataSource(), []);

  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [refused, setRefused] = useState<string | null>(null);
  // Which row is mid-call, so two clicks cannot race one another to the same document.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setRefused(null);
      try {
        const p = await src.listProcedures(tenantId);
        if (alive) setProcedures(p);
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
      </div>

      {loading && <p className="records__empty">Reading this tenant&rsquo;s procedures…</p>}

      {refused && (
        <HoldBanner title="This tenant&rsquo;s procedures could not be read">
          {refused}
        </HoldBanner>
      )}

      {error && <HoldBanner title="Nothing changed">{error}</HoldBanner>}

      {!loading && !refused && procedures.length === 0 && (
        <div className="stack">
          <p className="records__empty">
            Nothing yet. A procedure comes out of an interview, not a form.
          </p>
          <Link className="w-btn" href="/author">Create a procedure</Link>
        </div>
      )}

      {procedures.length > 0 && (
        <div className="stack">
          {procedures.map((p) => {
            const isPublic = Boolean(p.public_id);
            const published = p.status === "published";
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
                </div>
                <p className="w-def__note">
                  {isPublic
                    ? `Anyone can read v${p.current_version ?? p.version} of this, including the steps and every acceptance rule. Your drafts and every record run against it stay private.`
                    : published
                      ? "Private to this tenant. Nobody outside it can read this, whatever any flag says — the tenant subtree is unreachable to them."
                      : "Still drafting. Publish it to freeze a version; only a frozen version can be made public, because a draft would change under whoever was reading it."}
                </p>
                <div className="w-step__exits">
                  <button
                    className={`w-btn ${isPublic ? "w-btn--ghost" : "w-btn--tonal"}`}
                    disabled={!published || busy === p.id}
                    onClick={() => void setPublic(p, !isPublic)}
                  >
                    {busy === p.id
                      ? "Working…"
                      : isPublic ? "Make it private" : "Show it to the world"}
                  </button>
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
