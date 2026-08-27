/**
 * Build the printable, paginated architecture document from the canvas's own data.
 *
 * `docs/architecture/Architecture.html` is a pan-and-zoom canvas: one 2400x1600 world that a
 * reader explores. Printing it puts fifty nodes on a single sheet, which is how the first PDF
 * came out illegible. A document is a different medium — it has pages, and a page can only
 * hold one idea. So this reads the SAME `NODES`/`EDGES`/`BANDS` the canvas uses and re-lays
 * them out one logical section at a time, ending with how the sections join up.
 *
 * There is deliberately no second copy of the data. Correct a fact in the canvas and it is
 * corrected here on the next run; if the two ever disagreed, the document would be the lie.
 *
 *   node scripts/gen_architecture_doc.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const SRC = "docs/architecture/Architecture.html";
const OUT = "docs/architecture/Architecture-document.html";

/* ---------------------------------------------------------------- the data */
const html = readFileSync(SRC, "utf8");
const from = html.indexOf("const STATE = {");
const endEdges = html.indexOf("\n];", html.indexOf("const EDGES = [")) + 3;
if (from < 0 || endEdges < 3) throw new Error("could not find the data block in " + SRC);
const ctx = createContext({});
runInContext(html.slice(from, endEdges) + "\n;globalThis.__d={STATE,BANDS,NODES,EDGES};", ctx);
const { STATE, BANDS, NODES, EDGES } = ctx.__d;

const byId = new Map(NODES.map(n => [n.id, n]));
const bandOf = new Map();
BANDS.forEach((b, i) => b.ids.forEach(id => bandOf.set(id, i)));

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Node notes carry deliberate <b>/<i>/<code>; keep those, escape everything else. */
const rich = s => String(s)
  .replace(/&/g, "&amp;")
  .replace(/<(?!\/?(b|i|code)>)/g, "&lt;");

/* Each section gets a thesis — the one thing a reader should take from the page. Written
 * here rather than derived, because a summary is a judgement and the data has no opinion. */
const THESIS = {
  "Supply chain — how the image got there":
    "The image is built on a laptop and pushed straight to Artifact Registry. Cloud Build is enabled and never runs.",
  "Identity — Google sign-in, wired to the live origin":
    "The browser never holds a long-lived credential: an ID token is exchanged server-side for an HttpOnly cookie.",
  "Request path — what a visitor actually touches":
    "One container serves the pages, the API and the images. Every agent call is made from server code, never from the browser.",
  "Platform services":
    "What the project actually calls, and what was enabled and left alone. Both are drawn, because an unused service is still a fact about the build.",
  "Data — carrying real records":
    "Everything lives under tenants/{t}/…, so a query that forgets its tenant returns nothing rather than everything.",
  "The fleet — deployed on Vertex AI Agent Engine":
    "Seven agents behind one engine, which answers for its own roster over the API — so the claim is checkable from outside.",
  "Scheduled work — one cron for the whole system":
    "One cron re-reads the world every five minutes. It is currently failing, and nothing downstream of it has ever run.",
  "Instruments — a reading nobody typed":
    "A signed frame from an instrument is the difference between a measurement and a number somebody typed.",
};

/* ------------------------------------------------------------- geometry */
/** Rank the distinct coordinates in a band so the hand-tuned layout survives as a grid. */
function grid(ids) {
  const ns = ids.map(id => byId.get(id));
  const xs = [...new Set(ns.map(n => n.x))].sort((a, b) => a - b);
  const ys = [...new Set(ns.map(n => n.y))].sort((a, b) => a - b);
  return { cols: xs.length, rows: ys.length,
           at: n => ({ c: xs.indexOf(n.x), r: ys.indexOf(n.y) }) };
}

const CHIP_W = 132, CHIP_H = 44, GAP_X = 96, GAP_Y = 46;

function flowSvg(ids) {
  const g = grid(ids);
  const w = g.cols * CHIP_W + (g.cols - 1) * GAP_X;
  const h = g.rows * CHIP_H + (g.rows - 1) * GAP_Y;
  const pos = new Map();
  for (const id of ids) {
    const n = byId.get(id), { c, r } = g.at(n);
    pos.set(id, { x: c * (CHIP_W + GAP_X), y: r * (CHIP_H + GAP_Y) });
  }
  const inSet = new Set(ids);
  const lines = [], chips = [];

  for (const [a, b, st, label] of EDGES) {
    if (!inSet.has(a) || !inSet.has(b)) continue;
    const pa = pos.get(a), pb = pos.get(b);
    // Leave from the facing edge, not the centre: a line drawn centre-to-centre crosses the
    // box it starts in, and any label sitting at its midpoint lands on top of a chip.
    const rightward = pb.x > pa.x, leftward = pb.x < pa.x;
    const x1 = pa.x + (rightward ? CHIP_W : leftward ? 0 : CHIP_W / 2);
    const x2 = pb.x + (rightward ? 0 : leftward ? CHIP_W : CHIP_W / 2);
    const vertical = !rightward && !leftward;
    const y1 = pa.y + (vertical ? (pb.y > pa.y ? CHIP_H : 0) : CHIP_H / 2);
    const y2 = pb.y + (vertical ? (pb.y > pa.y ? 0 : CHIP_H) : CHIP_H / 2);
    const col = `var(--${st})`;
    const dash = st === "dorm" || st === "drift" ? ' stroke-dasharray="5 4"' : "";
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const d = vertical || y1 === y2
      ? `M${x1} ${y1} L${x2} ${y2}`
      : `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
    lines.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="1.4" opacity=".8"${dash}/>`);
    if (label && !vertical) {
      const txt = label.length > 22 ? label.slice(0, 21) + "\u2026" : label;
      const w = txt.length * 3.9 + 8;
      lines.push(
        `<rect x="${mx - w / 2}" y="${my - 12}" width="${w}" height="11" rx="3" class="ebg"/>` +
        `<text x="${mx}" y="${my - 3.6}" class="elab">${esc(txt)}</text>`);
    }
  }
  for (const id of ids) {
    const n = byId.get(id), p = pos.get(id);
    chips.push(
      `<g transform="translate(${p.x},${p.y})">
         <rect width="${CHIP_W}" height="${CHIP_H}" rx="7" class="chip"/>
         <rect width="3" height="${CHIP_H}" rx="1.5" fill="var(--${n.s})"/>
         <text x="11" y="17" class="ct">${esc(n.t)}</text>
         <text x="11" y="31" class="cs">${esc(String(n.sub).split(" · ")[0])}</text>
       </g>`);
  }
  return `<svg class="flow" viewBox="-16 -26 ${w + 32} ${h + 42}" preserveAspectRatio="xMidYMid meet">
    ${lines.join("\n")}${chips.join("\n")}</svg>`;
}

function card(n) {
  const facts = (n.facts || []).slice(0, 5).map(
    ([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  return `<article class="card">
    <h4><s style="background:var(--${n.s})"></s>${esc(n.t)}</h4>
    <p class="sub">${esc(n.sub)}</p>
    <dl>${facts}</dl>
    <p class="note">${rich(n.note || "")}</p>
  </article>`;
}

/** Edges that leave a section tell you what it depends on; a section page is incomplete
 *  without them, and they are the seam the last page is built from. */
function crossings(ids) {
  const inSet = new Set(ids);
  const out = [];
  for (const [a, b, st, label] of EDGES) {
    const ia = inSet.has(a), ib = inSet.has(b);
    if (ia === ib) continue;
    const other = ia ? b : a;
    const bi = bandOf.get(other);
    if (bi === undefined) continue;
    out.push({ dir: ia ? "to" : "from", self: ia ? a : b, other, band: BANDS[bi].t, st, label });
  }
  return out;
}

/* ------------------------------------------------------------------- css */
const CSS = `
:root{
  --work:#131314; --work-2:#1E1F20; --work-3:#282A2C; --rule-dark:#3C4043;
  --fg:#E3E3E3; --fg-2:#C4C7C5; --fg-3:#9AA0A6;
  --live:#5BB974; --prov:#FBBC04; --drift:#F28B82; --dorm:#80868B;
  --hub:#8AB4F8; --bench:#C58AF9; --primary:#8AB4F8;
  --mono:"Liberation Mono",ui-monospace,monospace;
  --sans:"Noto Sans","Liberation Sans",system-ui,sans-serif;
}
@page{ size:11in 8.5in; margin:0 }
*{box-sizing:border-box}
body{margin:0;background:var(--work);color:var(--fg);font-family:var(--sans);
     -webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:11in;height:8.5in;padding:.5in .55in .42in;page-break-after:always;
      position:relative;overflow:hidden;display:flex;flex-direction:column}
.page:last-child{page-break-after:auto}
.kicker{font-family:var(--mono);font-size:8.5px;letter-spacing:.18em;text-transform:uppercase;
        color:var(--fg-3)}
h1{font-size:34px;font-weight:500;letter-spacing:-.02em;margin:.18in 0 .06in}
h2{font-size:21px;font-weight:500;letter-spacing:-.012em;margin:4px 0 3px}
.thesis{font-size:12.5px;line-height:1.5;color:var(--fg-2);max-width:8.4in;margin:0 0 10px}
.rule{height:1px;background:var(--rule-dark);margin:9px 0 12px}
.flowwrap{background:var(--work-2);border:1px solid var(--rule-dark);border-radius:10px;
          padding:14px 12px;margin-bottom:11px;display:flex;align-items:center;justify-content:center;
          min-height:1.5in}
.flowwrap.tall{min-height:1.5in}
svg.flow{width:100%;height:100%;flex:1}
svg.flow .ebg{fill:var(--work-2);opacity:.92}
svg.flow .chip{fill:var(--work-3);stroke:var(--rule-dark);stroke-width:1}
svg.flow .ct{font-family:var(--sans);font-size:9.5px;fill:var(--fg)}
svg.flow .cs{font-family:var(--mono);font-size:7.2px;fill:var(--fg-3)}
svg.flow .ot{font-family:var(--sans);font-size:11px;fill:var(--fg)}
svg.flow .os{font-family:var(--mono);font-size:8px;fill:var(--fg-3)}
svg.flow .elab{font-family:var(--mono);font-size:6.6px;fill:var(--fg-3);text-anchor:middle}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;flex:1;align-content:start}
.cards.three{grid-template-columns:repeat(3,1fr)}
.card{background:var(--work-2);border:1px solid var(--rule-dark);border-radius:9px;
      padding:9px 10px;overflow:hidden;max-height:2.05in}
.card h4{margin:0 0 2px;font-size:11.5px;font-weight:500;display:flex;align-items:center;gap:6px}
.card h4 s{width:6px;height:6px;border-radius:99px;flex:none;text-decoration:none}
.card .sub{margin:0 0 6px;font-family:var(--mono);font-size:7.6px;color:var(--fg-3);line-height:1.4}
.card dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:1px 7px}
.card dt{font-family:var(--mono);font-size:7px;color:var(--fg-3);text-transform:uppercase;
         letter-spacing:.06em;white-space:nowrap}
.card dd{margin:0;font-family:var(--mono);font-size:7.4px;color:var(--fg-2);line-height:1.35}
.card .note{margin:6px 0 0;font-size:8.4px;line-height:1.45;color:var(--fg-3);
            border-top:1px solid var(--rule-dark);padding-top:5px;
            display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.card .note b{color:var(--fg-2);font-weight:600}
.card .note code{font-family:var(--mono);font-size:7.6px}
.foot{position:absolute;left:.55in;right:.55in;bottom:.2in;display:flex;justify-content:space-between;
      font-family:var(--mono);font-size:7.4px;color:var(--fg-3);border-top:1px solid var(--rule-dark);
      padding-top:5px}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:10px 0 0}
.legend div{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--fg-2)}
.legend s{width:8px;height:8px;border-radius:99px;text-decoration:none}
.legend em{font-style:normal;font-family:var(--mono);font-size:8.6px;color:var(--fg-3)}
.toc{display:grid;grid-template-columns:repeat(2,1fr);gap:5px 26px;margin-top:12px}
.toc div{display:flex;gap:9px;font-size:10.5px;color:var(--fg-2);
         border-bottom:1px dotted var(--rule-dark);padding-bottom:3px}
.toc b{font-family:var(--mono);font-size:9px;color:var(--fg-3);font-weight:400;min-width:16px}
.cross{display:grid;grid-template-columns:repeat(2,1fr);gap:5px 22px;margin-top:2px}
.cross div{font-family:var(--mono);font-size:8px;color:var(--fg-3);line-height:1.5}
.cross b{color:var(--fg-2);font-weight:400}
.steps{counter-reset:s;display:grid;grid-template-columns:repeat(2,1fr);gap:7px 22px;margin-top:2px}
.step{display:flex;gap:10px}
.step i{counter-increment:s;font-style:normal;font-family:var(--mono);font-size:9px;
        color:var(--work);background:var(--primary);border-radius:99px;width:17px;height:17px;
        display:grid;place-items:center;flex:none;margin-top:1px}
.step i::before{content:counter(s)}
.step p{margin:0;font-size:10px;line-height:1.5;color:var(--fg-2)}
.step p b{color:var(--fg)}
.step p code{font-family:var(--mono);font-size:8.6px;color:var(--fg-3)}
.warn{border-left:3px solid var(--drift);background:var(--work-2);padding:8px 12px;border-radius:0 8px 8px 0;
      margin-top:8px;font-size:9.4px;line-height:1.45;color:var(--fg-2)}
.warn b{color:var(--drift)}
`;

/* ----------------------------------------------------------------- pages */
const pages = [];
const foot = (l, r) => `<div class="foot"><span>${l}</span><span>${r}</span></div>`;
const STAMP = "warrent-505918 · us-central1 · verified 2026-08-26";

function sectionPages(band, idx) {
  const ids = band.ids;
  const cross = crossings(ids);
  const seen = new Set();
  const crossHtml = cross.filter(c => {
    const k = c.self + c.other; if (seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 8).map(c =>
    `<div><b>${esc(byId.get(c.self).t)}</b> ${c.dir === "to" ? "→" : "←"} ${esc(byId.get(c.other).t)} <span style="opacity:.7">(${esc(c.band.split(" — ")[0])})</span></div>`
  ).join("");

  const head = `<div class="kicker">Section ${idx + 1} of ${BANDS.length}</div>
    <h2>${esc(band.t)}</h2>
    <p class="thesis">${esc(THESIS[band.t] || "")}</p>`;

  const cardsOf = list => list.map(id => card(byId.get(id))).join("");
  const crossBlock = `<div class="kicker" style="margin-bottom:4px">What this section reaches outside itself</div>
    <div class="cross">${crossHtml}</div>`;

  if (ids.length <= 6) {
    pages.push(`<section class="page">${head}
      <div class="flowwrap">${flowSvg(ids)}</div>
      <div class="cards three">${cardsOf(ids)}</div>
      ${crossHtml ? crossBlock : ""}
      ${foot(STAMP, "")}</section>`);
    return;
  }
  // A wide section gets its map and its first eight nodes on one page, the rest on the next.
  // Eight is what fits under a flow at this type size; the cap is enforced in CSS too, so a
  // long note is clamped rather than pushed off the sheet.
  pages.push(`<section class="page">${head}
    <div class="flowwrap tall">${flowSvg(ids)}</div>
    <div class="cards">${cardsOf(ids.slice(0, 8))}</div>
    ${foot(STAMP, "")}</section>`);
  const rest = ids.slice(8);
  for (let i = 0; i < rest.length; i += 12) {
    const chunk = rest.slice(i, i + 12);
    const last = i + 12 >= rest.length;
    pages.push(`<section class="page">
      <div class="kicker">${esc(band.t)} — continued</div>
      <div class="rule"></div>
      <div class="cards">${cardsOf(chunk)}</div>
      ${last && crossHtml ? crossBlock : ""}
      ${foot(STAMP, "")}</section>`);
  }
}

function cover() {
  const counts = {};
  for (const n of NODES) counts[n.s] = (counts[n.s] || 0) + 1;
  const legend = Object.entries(STATE).filter(([k]) => counts[k]).map(([k, v]) =>
    `<div><s style="background:var(--${k})"></s>${esc(v.label)} <em>· ${counts[k]}</em></div>`).join("");
  let n = 2;
  const toc = BANDS.map((b, i) => {
    const p = n; n += b.ids.length <= 6 ? 1 : 1 + Math.ceil((b.ids.length - 8) / 12);
    return `<div><b>${p}</b><span>${esc(b.t)}</span></div>`;
  }).join("") + `<div><b>${n}</b><span>How they come together — one capture, end to end</span></div>`;
  pages.push(`<section class="page">
    <div class="kicker">Deployed architecture</div>
    <h1>Warrant</h1>
    <p class="thesis" style="font-size:13.5px;max-width:7.6in">Maintenance records that are evidence, not paperwork. This document describes the system
      as it is actually deployed, one section at a time. Every value was read out of the live
      project with gcloud or the REST APIs, or by requesting the running service — not from the
      repository. Where the two disagree, the project wins and the node is marked drift.</p>
    <div class="legend">${legend}</div>
    <div class="rule" style="margin-top:16px"></div>
    <div class="kicker">Contents</div>
    <div class="toc">${toc}</div>
    ${foot(STAMP, `${NODES.length} nodes · ${EDGES.length} links`)}</section>`);
}


/* The section-level view. Individual nodes are the wrong grain here — what a reader needs on
 * the last page is which sections talk to which, and how heavily. Edges are aggregated: one
 * line per ordered pair of sections, weighted by how many node-to-node links it stands for. */
function overviewSvg() {
  const ORDER = [0, 2, 5, 4, 1, 3, 6, 7];           // reading order across two rows
  const BW = 196, BH = 52, GX = 44, GY = 62, COLS = 4;
  const at = i => ({ x: (i % COLS) * (BW + GX), y: Math.floor(i / COLS) * (BH + GY) });
  const slot = new Map(ORDER.map((band, i) => [band, at(i)]));

  const pairs = new Map();
  for (const [a, b, st] of EDGES) {
    const ba = bandOf.get(a), bb = bandOf.get(b);
    if (ba === undefined || bb === undefined || ba === bb) continue;
    const k = `${ba}>${bb}`;
    const cur = pairs.get(k) || { a: ba, b: bb, n: 0, st };
    cur.n++;
    if (st === "drift") cur.st = "drift";
    pairs.set(k, cur);
  }
  const w = COLS * BW + (COLS - 1) * GX;
  const h = 2 * BH + GY;
  const lines = [], boxes = [];
  for (const { a, b, n, st } of pairs.values()) {
    const pa = slot.get(a), pb = slot.get(b);
    if (!pa || !pb) continue;
    const sameRow = pa.y === pb.y;
    const right = pb.x > pa.x;
    const x1 = pa.x + (sameRow ? (right ? BW : 0) : BW / 2);
    const x2 = pb.x + (sameRow ? (right ? 0 : BW) : BW / 2);
    const y1 = pa.y + (sameRow ? BH / 2 : (pb.y > pa.y ? BH : 0));
    const y2 = pb.y + (sameRow ? BH / 2 : (pb.y > pa.y ? 0 : BH));
    const mx = (x1 + x2) / 2;
    const d = sameRow ? `M${x1} ${y1} L${x2} ${y2}`
                      : `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
    lines.push(`<path d="${d}" fill="none" stroke="var(--${st})" stroke-width="${Math.min(1 + n * .5, 3.4)}"
      opacity=".55"${st === "drift" ? ' stroke-dasharray="5 4"' : ""}/>`);
  }
  for (const bi of ORDER) {
    const b = BANDS[bi], p = slot.get(bi);
    const title = b.t.split(" — ")[0];
    const live = b.ids.filter(id => byId.get(id).s === "live").length;
    boxes.push(`<g transform="translate(${p.x},${p.y})">
      <rect width="${BW}" height="${BH}" rx="8" class="chip"/>
      <text x="13" y="21" class="ot">${esc(title)}</text>
      <text x="13" y="37" class="os">${b.ids.length} nodes · ${live} live</text></g>`);
  }
  return `<svg class="flow" viewBox="-10 -14 ${w + 20} ${h + 26}" preserveAspectRatio="xMidYMid meet">
    ${lines.join("")}${boxes.join("")}</svg>`;
}

function together() {
  const steps = [
    "A technician opens the job on the web or the Android app. There is nothing to install, and a sealed record is readable by anyone with the link — which is why the service is public to <code>allUsers</code>.",
    "Google Front End terminates TLS and hands plain HTTP to the Cloud Run service <code>warrant</code>, one container serving the pages, the API and the images.",
    "The revision runs as <code>warrant-web@</code> — not the default compute account it used to run as — so the identity serving web pages cannot administer the project.",
    "The capture is written to the evidence bucket and the job to Firestore, both under <code>tenants/{t}/…</code>, with released rules refusing anything that reaches across a tenant.",
    "<b>Model Armor screens the photograph first.</b> A photograph is untrusted input, and a sticker with words on it is a prompt.",
    "The cheap screen (Flash-Lite) asks one question: is this frame so unusable that spending the judge on it is waste? It has no PASS in its enum, so it can cost a retake and nothing more.",
    "<code>warrant-web@</code> mints a short-lived token for <code>warrant-adjudicator@</code> and calls <code>reasoningEngines:query</code>. The credential that can reach a judgement model is never the one serving pages.",
    "The Inspector judges the evidence against the written rule; the Skeptic asks whether it belongs to this job at all. <b>Neither sees the other's verdict</b> — two agents shown each other's conclusions agree, and the second opinion stops being one.",
    "The verdict lands on the record with the model and the version that produced it. The Gate — deterministic code, not an agent — decides whether the step passes and whether the machine is held.",
    "Every five minutes Cloud Scheduler calls the sweep, which is where the Auditor reads weeks of jobs at once and hands a procedure defect back to the Scoper.",
  ];
  pages.push(`<section class="page">
    <div class="kicker">How they come together</div>
    <h2>One capture, end to end</h2>
    <p class="thesis">The sections above are the parts. This is the path a single photograph takes through all of them, in order, on the deployed system.</p>
    <div class="steps">${steps.map(s => `<div class="step"><i></i><p>${rich(s)}</p></div>`).join("")}</div>
    <div class="rule" style="margin:12px 0 8px"></div>
    <div class="kicker" style="margin-bottom:5px">The eight sections, and the traffic between them</div>
    <div class="flowwrap" style="min-height:0;flex:1;margin-bottom:6px">${overviewSvg()}</div>
    <div class="warn" style="border-left-color:var(--live)"><b style="color:var(--live)">Step 10 was broken for a day, and is not any more.</b>
      The sweep returned 500 on every run across two revisions, failing in under a second — before
      any model call — so no audit ran against real data. Revision 00014 answers 200 and completes
      in three to eleven seconds. <code>tasks</code>, <code>findings</code> and <code>audits</code>
      are still empty, which is now a thinness-of-data question rather than a broken one: two sealed
      records is a narrow window for an Auditor whose subject is a procedure across weeks of jobs.</div>
    ${foot(STAMP, "end of document")}</section>`);
}

cover();
BANDS.forEach(sectionPages);
together();

writeFileSync(OUT, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Warrant — deployed architecture</title><style>${CSS}</style></head>
<body>${pages.join("\n")}</body></html>`, "utf8");
console.log(`${pages.length} pages -> ${OUT}`);
