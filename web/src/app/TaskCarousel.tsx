"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { EvidenceChip, type ProvenanceClass } from "@/components";
import { getDataSource } from "@/data";
import { useSession } from "@/auth/session-context";
import { currentTenantId } from "@/auth/current-tenant";
import { DeviceStrip, type DeviceReport } from "./DeviceStrip";

export interface Task {
  procedureId: string;
  name: string;
  image: string;
  steps: number;
  note: string;
  classes: ProvenanceClass[];
  unreachable?: ProvenanceClass[];
  available: boolean;
}

function warrantUid(): string {
  const k = "warrant_uid";
  let v = window.localStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); window.localStorage.setItem(k, v); }
  return v;
}

/**
 * @param children the quick actions, and only ever those.
 *
 * They are a child rather than a sibling because `.cta` is `position: sticky; bottom: 0` —
 * anything rendered after the carousel lands BELOW the primary action and can only be found by
 * scrolling past it. A shortcut you have to scroll to find is not a shortcut.
 */
export function TaskCarousel({ tasks, children }: { tasks: Task[]; children?: React.ReactNode }) {
  const router = useRouter();
  // The tenant the job lands in. Hardcoding "anon" here is what used to put a signed-in
  // technician's jobs somewhere their own records screen would never look.
  const { session } = useSession();
  const rail = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [, setReport] = useState<DeviceReport | null>(null);

  // Which card is centred. Native scroll-snap does the movement; this only reads it.
  // Nearest-to-centre rather than "is intersecting" — on a wide screen several cards are
  // visible at once and intersection order would pick an arbitrary one.
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      // Leading-edge, not centre. Cards snap to the start, so the active one is the
      // leftmost still in view — which is the same card at 390px (one fills the rail) and
      // at 1440px (three are visible and the first is the one you are choosing).
      let best = 0;
      let bestDist = Infinity;
      el.querySelectorAll<HTMLElement>(".card").forEach((c, i) => {
        const d = Math.abs(c.offsetLeft - el.scrollLeft - el.clientLeft);
        if (d < bestDist - 1) { bestDist = d; best = i; }
      });
      setActive(best);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [tasks.length]);

  const goto = (i: number) => {
    const el = rail.current;
    const card = el?.querySelectorAll<HTMLElement>(".card")[i];
    card?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  const task = tasks[active];

  async function start() {
    if (!task?.available || busy) return;
    setBusy(true);
    warrantUid();
    const job = await getDataSource().startJob({
      procedureId: task.procedureId, tenantId: currentTenantId(session), tier: "open",
    });
    router.push(`/job/${job.id}`);
  }

  return (
    <div className="picker">
      <div className="picker__lead">
        <p className="picker__kicker">Pick a task</p>
        <p className="picker__sub">Do it now. No account, no install.</p>
      </div>

      <div className="rail" ref={rail} role="listbox" aria-label="Tasks">
        {tasks.map((t, i) => (
          <article
            className={`card${i === active ? " card--active" : ""}${t.available ? "" : " card--soon"}`}
            key={t.procedureId}
            data-i={i}
            role="option"
            aria-selected={i === active}
            onClick={() => (i === active ? start() : goto(i))}
          >
            <div className="card__art">
              <Image
                src={t.image}
                alt=""
                fill
                sizes="(max-width: 700px) 86vw, 420px"
                priority={i < 2}
                style={{ objectFit: "cover" }}
              />
              {!t.available && <span className="card__soon">Coming next</span>}
            </div>
            <div className="card__foot">
              <h2 className="card__name">{t.name}</h2>
              <p className="card__note">{t.note}</p>
              <div className="card__chips">
                {t.classes.map((c) => <EvidenceChip key={c} cls={c} />)}
                {t.unreachable?.map((c) => <EvidenceChip key={c} cls={c} out />)}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="dots" role="tablist" aria-label="Choose a task">
        {tasks.map((t, i) => (
          <button
            key={t.procedureId}
            className={`dot${i === active ? " dot--on" : ""}`}
            aria-label={t.name}
            aria-selected={i === active}
            role="tab"
            onClick={() => goto(i)}
          />
        ))}
      </div>

      <DeviceStrip onReport={setReport} />

      {children}

      <div className="cta">
        <button className="w-btn w-btn--block cta__go" onClick={start} disabled={!task?.available || busy}>
          {busy ? "Opening…" : task?.available ? `Start — ${task.name}` : "Not ready yet"}
        </button>
        <p className="cta__meta">
          {task?.available
            ? `${task.steps} steps · about a minute · ends in a sealed record you can share`
            : "Pick another task"}
        </p>
      </div>
    </div>
  );
}
