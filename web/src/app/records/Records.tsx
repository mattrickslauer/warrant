"use client";

// Every job this tenant has run, and the record each sealed one left behind.
//
// Nothing is seeded. A record exists here because somebody stood in front of a machine and made
// it, which is the whole difference between this list and a table of rows somebody typed.
//
// The Kotlin twin is android/…/ui/records/RecordsScreen.kt. The detail view is not duplicated:
// /r/{id} already renders a record on the paper ground for both a tenant member and a stranger
// holding a shared link, so a row here links there rather than to a second copy of that page.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HoldBanner, JobRow, Rule, StatusPill, type JobStatus } from "@/components";
import { getDataSource } from "@/data";
import { useSession } from "@/auth/session-context";
import { currentTenantId } from "@/auth/current-tenant";
import type { Job, Procedure, SealedRecord } from "@/generated/types";
import { useRouter } from "next/navigation";

export function Records() {
  const { session } = useSession();
  const tenantId = currentTenantId(session);
  const src = useMemo(() => getDataSource(), []);
  const router = useRouter();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [records, setRecords] = useState<SealedRecord[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setRefused(null);
      try {
        // Three reads rather than one join. A record can outlive the job list a screen happens
        // to be showing, and a job can exist with no record at all — which is exactly what "not
        // sealed" means, and the thing this screen has to be able to say.
        const [j, r, p] = await Promise.all([
          src.listJobs(tenantId),
          src.listRecords(tenantId),
          src.listProcedures("*"),
        ]);
        if (!alive) return;
        setJobs(j);
        setRecords(r);
        setProcedures(p);
      } catch (e) {
        // Against LiveSource these reads go through firestore.rules, which refuse a tenant that
        // is not yours — and a signed-out visitor asking for the `anon` tenant is exactly that.
        // A refusal must SHOW, not spin: leaving `loading` true here would leave the screen on
        // "Reading this tenant's work…" for ever, which reads as a hang rather than an answer.
        if (!alive) return;
        setRefused(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [src, tenantId]);

  const titleOf = (procedureId: string) =>
    procedures.find((p) => p.id === procedureId)?.title ?? procedureId;
  const recordFor = (jobId: string) => records.find((r) => r.job_id === jobId) ?? null;

  return (
    <div className="stack stack--lg">
      <div className="stack">
        <p className="eyebrow">Records</p>
        <h1 className="hero">What you have run</h1>
        <p className="lede">
          A sealed job is openable — that is the artifact a stranger can check. One that is not
          sealed is still here, and says so.
        </p>
      </div>

      {loading && <p className="records__empty">Reading this tenant&rsquo;s work…</p>}

      {refused && (
        <HoldBanner title="This tenant&rsquo;s records could not be read">
          {refused} Records belong to a tenant, and your account is what decides which one —
          signing in is what makes them reachable.
        </HoldBanner>
      )}

      {!loading && !refused && jobs.length === 0 && (
        <div className="stack">
          <p className="records__empty">
            Nothing yet. Run a procedure and the job appears here while it is open, then stays as
            a sealed record once its evidence is complete.
          </p>
          <div className="gate__actions">
            <Link className="w-btn" href="/">Start a task</Link>
          </div>
        </div>
      )}

      {!loading && !refused && jobs.length > 0 && (
        <div className="stack">
          <Rule />
          {jobs.map((job) => {
            const record = recordFor(job.id);
            return (
              <div className="records__row" key={job.id}>
                <JobRow
                  title={titleOf(job.procedure_id)}
                  asset={job.asset_urn}
                  status={job.status as JobStatus}
                  when={job.started_at?.slice(0, 19).replace("T", " ") ?? ""}
                  procedure={`${job.procedure_id} v${job.procedure_version}`}
                  onOpen={() => router.push(record ? `/r/${record.id}` : `/job/${job.id}`)}
                />
                {record ? (
                  <Link className="records__open" href={`/r/${encodeURIComponent(record.id)}`}>
                    Open the record <span className="w-mono">{record.id}</span>
                  </Link>
                ) : (
                  <p className="records__note w-mono">not sealed — no record yet</p>
                )}
                <Rule />
              </div>
            );
          })}
        </div>
      )}

      {!loading && !refused && records.length > 0 && (
        <div className="stack">
          <p className="gallery__label">Sealed</p>
          <div className="records__seals">
            {records.map((r) => (
              <Link className="records__seal" key={r.id} href={`/r/${encodeURIComponent(r.id)}`}>
                <StatusPill status={r.machine_released ? "sealed" : "held"} />
                <span className="records__sealid w-mono">{r.id}</span>
                <span className="records__sealwhen w-mono">
                  {r.sealed_at.slice(0, 19).replace("T", " ")} UTC
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!loading && !refused && src.fabricated && (
        <HoldBanner kind="fixture" title="Fixture data">
          This build has no backend, so jobs and records live only as long as the tab does. A
          reload empties this list — and a demo must never present fabricated data as though it
          were persisted.
        </HoldBanner>
      )}
    </div>
  );
}
