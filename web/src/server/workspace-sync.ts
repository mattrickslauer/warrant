import "server-only";

// The projection into Workspace, and the three things it consists of.
//
// The README has claimed for months that Workspace is "where the answers turn up — the ledger,
// the records, the drafted orders". One of those three was true. This is the other two, plus
// the notifications that make an email a channel rather than an archive.
//
// Every function here is BEST EFFORT AND NEVER FATAL, and that is a rule rather than a habit.
// The record is sealed in Firestore before any of this runs; the machine is released or held by
// the Gate reading that record, not this copy of it. A Drive outage that could fail a seal
// would be a system that stops certifying work because a document did not upload, which is
// worse than the paperwork it replaces.

import { adminDb } from "@/auth/admin";
import { getMember, membersWithRole } from "@/auth/members";
import { exportRecord, driveMemberFor } from "@/server/drive";
import { draftOrder, sendMail, canSendMail } from "@/server/gmail";
import { attachDriveExport, attachOrderDraft } from "@/server/tasks";
import type { SealedRecord } from "@/generated/types";

/** Absolute URLs, because a link in an email or a spreadsheet has no page to be relative to. */
function siteUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

// ---------------------------------------------------------------------------------------
// The record, as a document
// ---------------------------------------------------------------------------------------

/**
 * The sealed record as HTML, for Drive to convert into a Google Doc.
 *
 * Pure, and exported, so what a stranger reads years from now is a test rather than a rendered
 * string nobody looked at. It says what the record says and no more: this document must not
 * become more confident than the record it projects, so a deficiency is printed, a held machine
 * is printed, and there is no summary sentence congratulating anybody.
 */
export function recordHtml(record: SealedRecord, opts: {
  procedureTitle: string; procedureVersion: number; assetLabel: string | null;
  shopName: string;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const rows = record.steps.map((s) => `
    <tr>
      <td>${esc(s.step_id)}</td>
      <td>${esc(s.status)}</td>
      <td>${esc(s.reason_transcript ?? "")}</td>
    </tr>`).join("");

  const deficiencies = record.deficiencies.length
    ? `<h2>Deficiencies</h2><ul>${record.deficiencies.map((d) =>
        `<li><b>${esc(d.step_id)}</b> — ${esc(d.status)}: ${esc(d.reason)}</li>`).join("")}</ul>`
    // Said explicitly rather than omitted. An absent section reads as an oversight; this
    // sentence is a claim the record is actually making.
    : `<h2>Deficiencies</h2><p>None. Every binding step was settled by evidence.</p>`;

  const unreachable = record.ceiling_unreachable.length
    ? `<h2>What this evidence cannot support</h2><ul>${record.ceiling_unreachable.map((u) =>
        `<li><b>${esc(u.class)}</b> — ${esc(u.reason)}</li>`).join("")}</ul>`
    : "";

  const people = (record.actors ?? []).map((a) =>
    `${esc(a.display_name)}${a.role ? ` (${esc(a.role)})` : ""}`).join(", ");

  return `<!doctype html><html><body>
<h1>${esc(opts.procedureTitle)}</h1>
<p><b>${esc(opts.shopName)}</b><br>
Sealed ${esc(record.sealed_at)}<br>
Procedure version ${opts.procedureVersion}<br>
${opts.assetLabel ? `Asset: ${esc(opts.assetLabel)}<br>` : ""}
${people ? `Performed by: ${people}<br>` : ""}
${record.issuer?.display_name ? `Issued by: ${esc(record.issuer.display_name)}<br>` : ""}
Record: ${esc(record.id)}</p>

<h2>Evidence tier</h2>
<p><b>${esc(record.ceiling_tier)}</b> — this is what the evidence EARNED, not what the job
claimed. ${record.ceiling_reachable.length
  ? `Provenance reachable at this tier: ${record.ceiling_reachable.map(esc).join(", ")}.`
  : ""}</p>

<h2>The Gate</h2>
<p>${record.machine_released
  ? "Released. Every binding step passed."
  : "<b>HELD.</b> This machine was not released by this record."}</p>

${deficiencies}
${unreachable}

<h2>Steps</h2>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Step</th><th>Status</th><th>Reason</th></tr>${rows}
</table>

<p><small>Projected from Warrant. The authoritative record, with its photographs, readings and
agent decisions, is at ${esc(siteUrl(`/record/${record.id}`))}. This document is a copy for your
own files and is not itself the evidence.</small></p>
</body></html>`;
}

/**
 * Project one sealed record into the tenant's Drive, and tell whoever should know.
 *
 * Returns what happened, for the sweep to count. Never throws except `RateLimited`, which the
 * sweep understands as "try again next pass".
 */
export async function projectRecord(
  tenantId: string, recordId: string,
): Promise<{ exported: boolean; emailed: boolean }> {
  const db = adminDb();
  const snap = await db.collection("tenants").doc(tenantId)
    .collection("records").doc(recordId).get();
  if (!snap.exists) return { exported: false, emailed: false };
  const record = snap.data() as SealedRecord;

  const uid = await driveMemberFor(tenantId);
  if (!uid) {
    // Nobody in this tenant has linked Workspace. Not an error and not retried differently:
    // the record stays unexported and the window will offer it again after somebody links.
    return { exported: false, emailed: false };
  }

  // OFF THE RECORD, not off the job, and the distinction is the whole reason a record exists.
  //
  // `seal.ts` denormalises the procedure title, the version that ran and the asset onto the
  // record at seal time, deliberately: a record is immutable, so it must not change when
  // somebody renames a procedure or a machine is sold. Reading them back off the live job
  // would produce a Drive document that disagreed with the record it claims to be a copy of —
  // and the copy is the one a stranger reads.
  //
  // The Job document does not carry these fields at all (`procedure_id` and `asset_urn` are
  // what it holds), so reading them there would have silently produced "Maintenance record"
  // on every document and an empty asset column in every ledger row.
  const denormalised = record as unknown as {
    procedure_title?: string | null;
    procedure_version?: number | null;
    asset_label?: string | null;
  };
  const procedureTitle = denormalised.procedure_title ?? "Maintenance record";
  const procedureVersion = Number(denormalised.procedure_version ?? 1);
  const assetLabel = denormalised.asset_label ?? null;

  // The public URL when the record has been shared, the in-app one otherwise. A ledger row
  // pointing at a page the reader cannot open is worse than one pointing at a login.
  const recordUrl = record.public_id
    ? siteUrl(`/r/${record.public_id}`)
    : siteUrl(`/record/${recordId}`);

  const out = await exportRecord({
    tenantId, uid, shopName: tenantId,
    recordId,
    sealedAt: record.sealed_at,
    procedureTitle, procedureVersion, assetLabel,
    technician: (record.actors ?? []).map((a) => a.display_name).join(", ") || null,
    tier: record.ceiling_tier,
    machineReleased: record.machine_released,
    deficiencies: record.deficiencies.length,
    recordUrl,
    documentHtml: recordHtml(record, { procedureTitle, procedureVersion, assetLabel,
                                       shopName: tenantId }),
  });

  if (!out) return { exported: false, emailed: false };

  await attachDriveExport(tenantId, recordId, out.documentUrl, out.ledgerId);

  const emailed = await emailSealedRecord({
    tenantId, record, procedureTitle, assetLabel, recordUrl,
    documentUrl: out.documentUrl,
  });

  return { exported: true, emailed };
}

// ---------------------------------------------------------------------------------------
// The notifications
// ---------------------------------------------------------------------------------------

/**
 * Tell the people who performed a job that its record exists, and where.
 *
 * To the ACTORS, not to a mailing list. The person who did the work is the person who wants
 * proof they did it, and this is the first moment that proof has an address they can forward.
 */
async function emailSealedRecord(input: {
  tenantId: string; record: SealedRecord; procedureTitle: string;
  assetLabel: string | null; recordUrl: string; documentUrl: string | null;
}): Promise<boolean> {
  if (!canSendMail()) return false;

  const recipients = new Set<string>();
  for (const actor of input.record.actors ?? []) {
    const member = await getMember(input.tenantId, actor.uid).catch(() => null);
    if (member?.email) recipients.add(member.email);
  }
  if (recipients.size === 0) return false;

  const subject = `Record sealed — ${input.procedureTitle}` +
    (input.assetLabel ? ` on ${input.assetLabel}` : "");

  const body = [
    `${input.procedureTitle}${input.assetLabel ? ` on ${input.assetLabel}` : ""} is sealed.`,
    ``,
    `Evidence tier:    ${input.record.ceiling_tier}`,
    `Machine:          ${input.record.machine_released ? "released" : "HELD"}`,
    `Deficiencies:     ${input.record.deficiencies.length}`,
    ``,
    `The record:       ${input.recordUrl}`,
    ...(input.documentUrl ? [`Your copy in Drive: ${input.documentUrl}`] : []),
    ``,
    `This record is immutable. Anyone holding the link can read it without an account,`,
    `which is the point — it is proof you can hand to somebody who does not use Warrant.`,
  ].join("\n");

  let sent = false;
  for (const to of recipients) {
    sent = (await sendMail({ to, subject, body })) || sent;
  }
  return sent;
}

/**
 * A task, as an email.
 *
 * The third channel, and the one that reaches a foreman who is not carrying the phone the push
 * went to. Deliberately terse: an email that reproduces the whole job is an email nobody
 * finishes reading, and the link is one tap away from everything.
 */
export async function emailTask(input: {
  tenantId: string; taskId: string; kind: string; title: string; detail: string;
  assigneeUid: string | null; assigneeRole: string | null; dueAt: string | null;
  jobId: string | null;
}): Promise<number> {
  if (!canSendMail()) return 0;

  const members = input.assigneeUid
    ? [await getMember(input.tenantId, input.assigneeUid).catch(() => null)]
    : input.assigneeRole
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await membersWithRole(input.tenantId, input.assigneeRole as any)
      : [];

  const body = [
    input.detail,
    ``,
    ...(input.dueAt ? [`Due: ${input.dueAt}`, ``] : []),
    ...(input.jobId ? [`The job: ${siteUrl(`/job/${input.jobId}`)}`] : []),
    `The task: ${siteUrl(`/tasks`)}`,
    ``,
    `— Warrant. This was raised by an agent, not by a colleague.`,
  ].join("\n");

  let sent = 0;
  for (const member of members) {
    if (!member?.email) continue;
    if (await sendMail({ to: member.email, subject: input.title, body })) sent += 1;
  }
  return sent;
}

// ---------------------------------------------------------------------------------------
// The drafted order
// ---------------------------------------------------------------------------------------

/**
 * Draft the purchase order an `approve_order` task is asking somebody to approve.
 *
 * Called where the task is raised, because a task that says "approve the drafted order" and has
 * no draft behind it is the tick-in-a-box failure this whole product is an argument against.
 *
 * It goes in a FOREMAN's mailbox — the person with standing to spend money — and not the
 * technician's. Where there are several, the first who has linked Workspace: a draft sitting
 * with one of three foremen is the same approval, and three copies of one purchase order is
 * how a shop orders the same bolts three times.
 */
export async function draftOrderForTask(input: {
  tenantId: string; taskId: string; partNumber: string; rationale: string;
  jobId: string | null; assetLabel?: string | null;
}): Promise<string | null> {
  const foremen = await membersWithRole(input.tenantId, "foreman");
  const owners = await membersWithRole(input.tenantId, "owner");
  const candidates = [...foremen, ...owners];
  if (candidates.length === 0) return null;

  // What the shop knows about the part. The supplier's address and the grade live on the part
  // document, which is the shop's own assertion about its own shelf — see stock.ts. An order
  // with no supplier is still a draft worth writing: somebody types the address and sends it,
  // which is strictly better than somebody remembering to raise the order at all.
  const part = await adminDb()
    .collection("tenants").doc(input.tenantId)
    .collection("parts").doc(input.partNumber).get().catch(() => null);
  const partData = part?.data() ?? {};

  // The draft this task already has, if it has one.
  //
  // Read from the TASK rather than searched for in Gmail. A custom `X-Warrant-Task-Id` header
  // is not something Gmail's `q` reliably indexes, so a search-based idempotency check would
  // have quietly found nothing every time and left a second purchase order for the same part
  // in the mailbox on every retry. Two drafts is not cosmetic: it is how a shop orders the
  // same bolts twice. The task id is deterministic (`taskIdFor`), so the task document is the
  // stable place the answer already lives.
  const taskSnap = await adminDb()
    .collection("tenants").doc(input.tenantId)
    .collection("tasks").doc(input.taskId).get().catch(() => null);
  const existingDraftId = taskSnap?.data()?.gmail_draft_id
    ? String(taskSnap.data()!.gmail_draft_id)
    : null;

  for (const member of candidates) {
    const draftId = await draftOrder({
      existingDraftId,
      uid: member.uid,
      supplierEmail: partData.supplier_email ? String(partData.supplier_email) : null,
      partNumber: input.partNumber,
      grade: partData.grade ? String(partData.grade) : null,
      quantity: typeof partData.reorder_quantity === "number" ? partData.reorder_quantity : null,
      assetLabel: input.assetLabel ?? null,
      rationale: input.rationale,
      taskId: input.taskId,
      recordUrl: input.jobId ? siteUrl(`/job/${input.jobId}`) : null,
      shopName: input.tenantId,
    });
    if (draftId) {
      await attachOrderDraft(input.tenantId, input.taskId, draftId);
      return draftId;
    }
  }
  return null;
}
