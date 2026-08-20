// What a stranger sees.
//
// This renders the REDACTED PROJECTION at /records/{publicId}, not the tenant's private
// record. No account, no session, no tenant — holding the link is the whole credential, which
// is exactly what a paper service book has always offered and every digital replacement has
// broken.
//
// A server component on purpose: the reader has no Firebase session, so there is no
// authenticated client to read through. The Admin SDK reads the projection, which is safe
// precisely because the projection is what the Seal decided to publish.

import { Wrap, Rule, EvidenceChip, HoldBanner, Timeline } from "@/components";
import type { PublicRecord as PublicRecordDoc } from "@/server/publish";

function when(iso: string): string {
  return iso.slice(0, 19).replace("T", " ") + " UTC";
}

export function PublicRecord({ record }: { record: PublicRecordDoc }) {
  return (
    <Wrap>
      <div className="stack stack--lg">
        <div className="stack">
          <p className="eyebrow">Service record</p>
          <h1 className="hero">
            {record.machine_released ? record.procedure_title : `${record.procedure_title}, held`}
          </h1>
          <p className="w-timeline__when">
            {record.asset_label ? `${record.asset_label} · ` : ""}
            issued by {record.issuer.display_name} · sealed {when(record.sealed_at)}
          </p>
        </div>

        {!record.machine_released && (
          <HoldBanner title="Not released">
            A step was explained rather than performed, so this record is deficient and the
            machine stays held. That sentence is the point — a paper checklist cannot produce it.
          </HoldBanner>
        )}

        {record.actors.length > 0 && (
          <div className="stack">
            <p className="eyebrow">Who did the work</p>
            {record.actors.map((a) => (
              <div className="w-ceiling__row" key={a.display_name}>
                {/* The name and face as they were AT SEAL TIME. A record is immutable, so it
                    must not change when someone updates a profile photo or leaves the firm. */}
                {a.avatar && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.avatar} alt="" width={28} height={28} style={{ borderRadius: "50%" }} />
                )}
                <span className="w-ceiling__reason">{a.display_name} — {a.role}</span>
              </div>
            ))}
          </div>
        )}

        <div className="stack">
          <p className="eyebrow">What this record can and cannot prove</p>
          {record.ceiling_reachable.map((c) => (
            <div className="w-ceiling__row" key={c}>
              <EvidenceChip cls={c as "measured" | "specified" | "inferred" | "asserted"} />
              <span className="w-ceiling__reason">reachable on the surface that performed this</span>
            </div>
          ))}
          {record.ceiling_unreachable.map((c) => (
            <div className="w-ceiling__row" key={c.class}>
              <EvidenceChip cls={c.class as "measured" | "specified" | "inferred" | "asserted"} />
              <span className="w-ceiling__reason">{c.reason}</span>
            </div>
          ))}
        </div>

        {record.deficiencies.length > 0 && (
          <div className="stack">
            <p className="eyebrow">What was not done, and why</p>
            {record.deficiencies.map((d) => (
              <div className="stack" key={d.step_id}>
                <div className="w-ceiling__row">
                  <EvidenceChip cls="asserted" />
                  <span className="w-ceiling__reason">{d.status}</span>
                </div>
                <p className="w-step__why">&ldquo;{d.reason}&rdquo;</p>
              </div>
            ))}
          </div>
        )}

        <Rule />

        <div className="stack">
          <p className="eyebrow">Steps</p>
          <Timeline
            entries={record.steps.map((s, i) => ({
              id: String(s.step_id ?? i),
              when: `Step ${i + 1}`,
              what:
                s.status === "performed"
                  ? "Performed, evidence captured"
                  : `${s.status} — ${(s.reason_transcript as string) ?? "no reason recorded"}`,
              done: s.status === "performed",
            }))}
          />
        </div>

        <Rule />

        <div className="stack">
          <p className="eyebrow">Who decided what</p>
          {record.decisions.map((d, i) => (
            <div className="stack" key={i}>
              <p className="w-timeline__when">
                {String(d.agent)} · {String(d.agent_version)}
                {d.model ? ` · ${String(d.model)}` : ""} · {when(String(d.at))}
              </p>
              <p className="w-step__why">
                <strong>{String(d.verdict)}</strong> — {String(d.rationale)}
              </p>
            </div>
          ))}
        </div>

        <Rule />

        <p className="w-timeline__when">
          Anyone holding this link can read this page. The shop can revoke it at any time, and
          every image on it stops resolving the moment they do.
        </p>
      </div>
    </Wrap>
  );
}
