"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { EvidenceChip, type ProvenanceClass } from "@/components";
import { getDataSource } from "@/data";
import { useSession } from "@/auth/session-context";
import { currentTenantId } from "@/auth/current-tenant";
import { DeviceStrip, type DeviceReport } from "./DeviceStrip";
import { DEST } from "./shell/nav";

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
  const { ensureSession } = useSession();
  const rail = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [, setReport] = useState<DeviceReport | null>(null);

  // Which card is chosen. Native scroll-snap does the movement; this only reads it.
  // Nearest-to-the-snap-line rather than "is intersecting" — on a wide screen several cards
  // are visible at once and intersection order would pick an arbitrary one.
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      // Leading-edge, not centre. Cards snap to the start, so the active one is the
      // leftmost still in view — which is the same card at 390px (one fills the rail) and
      // at 1440px (three are visible and the first is the one you are choosing).
      //
      // Measured off getBoundingClientRect, NOT offsetLeft. offsetLeft is relative to the
      // nearest POSITIONED ancestor, and nothing between a card and the document is
      // positioned — so it carried the rail's leading gutter, which `--gutter` grows to
      // (100vw - --maxw) / 2. Past 1576px that gutter exceeds half a card's pitch and the
      // nearest-card sum lands a whole card early: every card read as the one before it,
      // `i === active` was never true, and clicking a card scrolled it into place and then
      // refused to open it. On a 1920px monitor that is the entire carousel, unselectable.
      //
      // Rects put the cards and the rail in one coordinate space, so the comparison holds at
      // every width without knowing anything about who is positioned.
      const box = el.getBoundingClientRect();
      const lead = parseFloat(getComputedStyle(el).paddingInlineStart) || 0;
      const origin = box.left + el.clientLeft + lead;
      let best = 0;
      let bestDist = Infinity;
      el.querySelectorAll<HTMLElement>(".card").forEach((c, i) => {
        const d = Math.abs(c.getBoundingClientRect().left - origin);
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

  // The rail is the tasks plus one card at the end that is not a task: the way out to
  // everything else people have published. It lives IN the rail rather than under it because
  // the carousel is the only thing on this screen a person is looking at, and a link below the
  // sticky CTA can only be found by scrolling past the button you were meant to press.
  //
  // Which means `active` can point one past the end, and every read of `tasks[active]` below
  // has to survive that — the first cut did not, and landing on the last card left the CTA
  // reading "Not ready yet" with nothing to press.
  const browsing = active === tasks.length;
  const task = browsing ? undefined : tasks[active];

  async function start() {
    if (busy) return;
    // The browse card has nothing to seal and no tenant to write to. It is navigation, so it
    // does not touch the session and cannot fail the way starting a job can.
    if (browsing) { router.push(DEST.publicProcedures.route); return; }
    if (!task?.available) return;
    setBusy(true);
    try {
      warrantUid();
      // Sign the visitor in anonymously first. Without a Firebase user there is no uid to
      // name a tenant after, so the job would be written as VISITOR_TENANT — which
      // current-tenant.ts documents as never reaching Firestore, and which the rules
      // correctly refuse. This is the line that makes "no account, no install" true.
      const active = await ensureSession();
      const job = await getDataSource().startJob({
        procedureId: task.procedureId, tenantId: currentTenantId(active), tier: "open",
      });
      // A scoped id is `tenant/doc` and carries a slash, so it must be one encoded path segment
      // rather than two. `/job/[id]` and `/r/[id]` each take a single segment and Next decodes
      // the param back, which is why the pages split it themselves. Unencoded, the job is
      // written to Firestore correctly and the technician still lands on a 404.
      router.push(`/job/${encodeURIComponent(job.id)}`);
    } catch (e) {
      // Leaving the button on "Opening…" forever is how this failure hid: the write was
      // refused and the screen said nothing at all. Say it out loud and give the button
      // back, so the next person to hit this sees a cause rather than a dead control.
      console.error("Could not start the job:", e);
      setBusy(false);
    }
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

        {/* The last card, and the only one that is not a task.
            
            A real `<a href>` rather than a card that calls `router.push`, so it can be opened
            in a new tab, copied, and read by a crawler — the published catalogue is the one
            thing on this screen that is worth being found from outside. `role="option"` keeps
            it inside the listbox it is visually part of; without it the rail would announce
            five options and show six cards. */}
        <Link
          className={`card card--browse${browsing ? " card--active" : ""}`}
          href={DEST.publicProcedures.route}
          data-i={tasks.length}
          role="option"
          aria-selected={browsing}
        >
          <div className="card__art card__art--browse">
            <span className="card__glyph" aria-hidden>→</span>
          </div>
          <div className="card__foot">
            <h2 className="card__name">Everything else</h2>
            <p className="card__note">
              The tasks above are the three that ship with Warrant. Every other procedure here
              was written by somebody and published on purpose — read the steps before you
              trust one.
            </p>
            <div className="card__chips">
              <span className="w-chip">Published by everyone</span>
            </div>
          </div>
        </Link>
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
        {/* The browse card is a page of this carousel like any other, so it gets a dot. One
            fewer dot than there are cards is how an indicator starts lying about how far the
            rail goes. */}
        <button
          className={`dot${browsing ? " dot--on" : ""}`}
          aria-label={DEST.publicProcedures.label}
          aria-selected={browsing}
          role="tab"
          onClick={() => goto(tasks.length)}
        />
      </div>

      <DeviceStrip onReport={setReport} />

      {children}

      <div className="cta">
        <button
          className="w-btn w-btn--block cta__go"
          onClick={start}
          disabled={busy || (!browsing && !task?.available)}
        >
          {busy
            ? "Opening…"
            : browsing
              ? "See every published procedure"
              : task?.available ? `Start — ${task.name}` : "Not ready yet"}
        </button>
        <p className="cta__meta">
          {browsing
            ? "Everything anybody has chosen to show the world · newest first"
            : task?.available
              ? `${task.steps} steps · about a minute · ends in a sealed record you can share`
              : "Pick another task"}
        </p>
      </div>
    </div>
  );
}
