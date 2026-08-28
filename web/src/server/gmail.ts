import "server-only";

// Gmail. Where an order waits for a person, and where a record turns up.
//
// THE DRAFT IS THE PRODUCT HERE. `tasks.ts` has said this since the Foreman was written —
//
//     case "reorder":
//       // A purchase order is DRAFTED, never sent. Somebody with standing approves it, and
//       // that approval is the task.
//
// — and until this file existed the draft did not. A task appeared saying "Approve the drafted
// order" and there was no order and nothing to approve. That is the exact failure the whole
// product is an argument against: a record that asserts something nobody checked.
//
// "Never sent" is a property of the GRANT, not a promise in a comment. The scope is
// `gmail.compose`, which can create a draft and CANNOT send one and CANNOT read the mailbox.
// An agent that decided to order forty thousand pounds of steel could not transmit it if it
// wanted to; a person opens Gmail, reads what the Foreman wrote and presses send. The
// authority to spend money stays with the human because the API key does not carry it.
//
// SENDING is therefore a different mechanism with a different identity — see `sendMail` at the
// bottom. Warrant never sends mail out of a technician's mailbox.

import { accessTokenFor, googleFetch, hasScope } from "@/server/workspace";
import { GoogleAuth } from "google-auth-library";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

/** Header the draft carries so a re-run finds the one it wrote instead of writing another. */
const TASK_HEADER = "X-Warrant-Task-Id";

/**
 * RFC 2822, and then base64url.
 *
 * Written out rather than pulled from a MIME library because the message is four headers and a
 * plain-text body, and a dependency that encodes that is a dependency that also has to be
 * audited for what it does with a header somebody put a newline in. Which is the next comment.
 */
export function rawMessage(m: {
  to: string; subject: string; body: string; from?: string; headers?: Record<string, string>;
}): string {
  const lines = [
    `To: ${headerSafe(m.to)}`,
    ...(m.from ? [`From: ${headerSafe(m.from)}`] : []),
    `Subject: ${headerSafe(m.subject)}`,
    ...Object.entries(m.headers ?? {}).map(([k, v]) => `${headerSafe(k)}: ${headerSafe(v)}`),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    m.body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/**
 * Strip anything that could end a header line.
 *
 * A part number is a string an agent produced from a photograph of a label, and a subject line
 * is assembled from it. CR or LF in that string is a header injection: everything after it is
 * parsed as a new header, so `\r\nBcc: someone@example.com` in a part number becomes a real
 * Bcc on a real purchase order. Tabs go too — a leading tab is a continuation line, which is
 * the same trick with different bytes.
 */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

export interface OrderDraft {
  /** Whose mailbox. The person who has standing to approve the spend, not the technician. */
  uid: string;
  /** Who the order goes to. Blank is fine: a draft with no recipient is still a draft. */
  supplierEmail: string | null;
  partNumber: string;
  /** The grade of a fastener is the detail outsiders never think of, so it gets its own line. */
  grade?: string | null;
  quantity?: number | null;
  /** What the machine is, so the supplier is not asked to guess from a part number. */
  assetLabel?: string | null;
  /** The Foreman's own words. Why this is being ordered at all. */
  rationale: string;
  taskId: string;
  /** Absolute, so it is useful from a mail client that knows nothing about Warrant. */
  recordUrl?: string | null;
  shopName?: string | null;
  /**
   * The draft this task already has, from the task document.
   *
   * Passed in rather than searched for. Gmail's `q` does not reliably index a custom
   * `X-Warrant-Task-Id` header, so a search would have found nothing every time and written a
   * second purchase order for the same part on every retry.
   */
  existingDraftId?: string | null;
}

/** The body, as a person reads it. Separated from the API call so it can be tested with none. */
export function orderBody(o: OrderDraft): string {
  const lines = [
    o.supplierEmail ? "" : "(No supplier address yet — add one before sending.)",
    "",
    `Please supply:`,
    ``,
    `  Part number   ${o.partNumber}`,
    ...(o.grade ? [`  Grade         ${o.grade}`] : []),
    `  Quantity      ${o.quantity ?? 1}`,
    ...(o.assetLabel ? [`  For           ${o.assetLabel}`] : []),
    ``,
    `Why this is needed:`,
    o.rationale,
    ``,
    ...(o.recordUrl
      ? [`The job this blocks, with its evidence so far:`, o.recordUrl, ``]
      : []),
    // The provenance line, and it is not decoration. A supplier receiving an order that an
    // agent originated is entitled to know that, and the person pressing send is entitled to
    // be told they are the one sending it.
    `— Drafted by Warrant's Foreman for ${o.shopName ?? "the workshop"}. Nobody has sent this yet;`,
    `  it is a draft in your mailbox until you press send.`,
  ];
  return lines.join("\n").replace(/^\n+/, "");
}

export function orderSubject(o: OrderDraft): string {
  const qty = o.quantity ?? 1;
  return headerSafe(
    `Purchase order — ${qty} × ${o.partNumber}${o.assetLabel ? ` for ${o.assetLabel}` : ""}`,
  );
}

/**
 * Put the order in the approver's drafts. Returns the draft id, or null if we could not.
 *
 * IDEMPOTENT BY SEARCH, like the calendar event. The draft carries `X-Warrant-Task-Id`, and
 * Gmail's query language can find a header, so a sweep that runs twice updates the draft it
 * wrote rather than leaving two purchase orders for the same part in somebody's mailbox. Two
 * drafts is not a cosmetic problem here: it is how a shop orders the same bolts twice.
 */
export async function draftOrder(o: OrderDraft): Promise<string | null> {
  if (!(await hasScope(o.uid, COMPOSE_SCOPE))) return null;
  const token = await accessTokenFor(o.uid);
  if (!token) return null;

  const message = {
    raw: rawMessage({
      to: o.supplierEmail ?? "",
      subject: orderSubject(o),
      body: orderBody(o),
      headers: { [TASK_HEADER]: o.taskId },
    }),
  };

  const existing = o.existingDraftId ?? null;

  if (existing) {
    const updated = await googleFetch(`${GMAIL}/drafts/${encodeURIComponent(existing)}`, token,
                                      { method: "PUT", body: JSON.stringify({ id: existing, message }) });
    if (updated.ok) {
      return ((await updated.json()) as { id?: string }).id ?? existing;
    }
    // A 404 means the person deleted the draft, which is a legitimate thing to do with a draft
    // and must not mean the task can never have one again. Anything else — a revoked grant, a
    // mailbox that has gone away — is not fixed by writing a second copy.
    if (updated.status !== 404) return null;
  }

  const response = await googleFetch(`${GMAIL}/drafts`, token,
                                     { method: "POST", body: JSON.stringify({ message }) });
  if (!response.ok) return null;
  const created = (await response.json()) as { id?: string };
  return created.id ?? null;
}

// ---------------------------------------------------------------------------------------
// Sending, which is a different identity to drafting and deliberately so.
// ---------------------------------------------------------------------------------------

/**
 * The mailbox Warrant sends notifications from.
 *
 * NOT a technician's. A person's grant is `gmail.compose`, which cannot send, and widening it
 * so the server could mail a foreman from a mechanic's account would be a strange thing to ask
 * for and a stranger thing to receive. Notifications come from the shop's own notifier mailbox
 * — `notifications@acme.com` — reached by service-account impersonation, which is the ordinary
 * Workspace way for an application to speak as an organisation rather than as a person.
 *
 * Unset on most deployments, and that is a supported state rather than a broken one: push and
 * the calendar already reach people, and `sendMail` reports that it did nothing rather than
 * pretending. Setting it needs a Workspace admin to authorise the service account for
 * `gmail.send` domain-wide, which is a deliberate act by the organisation being spoken for.
 */
const NOTIFIER = process.env.WARRANT_NOTIFIER_MAILBOX ?? null;
const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export interface Mail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Send one notification. Returns whether it went.
 *
 * `false` is not an error and is never thrown: every caller has already reached the person by
 * push, and a mail server having a bad afternoon must not fail a sweep, block a seal, or leave
 * a job unsealed. It is counted and reported, the way `calendarFailed` is — a channel that
 * quietly stops is the failure the sweep's own comments are written against.
 */
export async function sendMail(m: Mail): Promise<boolean> {
  if (!NOTIFIER || !m.to) return false;

  try {
    const token = await notifierToken();
    if (!token) return false;

    const url = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(NOTIFIER)}/messages/send`;
    const response = await googleFetch(url, token, {
      method: "POST",
      body: JSON.stringify({
        raw: rawMessage({ to: m.to, from: NOTIFIER, subject: m.subject, body: m.body }),
      }),
    });
    return response.ok;
  } catch {
    // Includes RateLimited. A deferred notification is one the next sweep sends.
    return false;
  }
}

/**
 * An access token for the notifier mailbox, via domain-wide delegation.
 *
 * Keyless. There is no service-account private key in this repo or on the container, because a
 * key that can speak as an organisation's mailbox is exactly the credential you do not want
 * sitting in an environment variable. The runtime service account signs the assertion through
 * IAM Credentials `signJwt` and exchanges it for a token, so the authority is an IAM binding
 * that an administrator can see and revoke rather than a string somebody copied once.
 */
async function notifierToken(): Promise<string | null> {
  const sa = process.env.WARRANT_NOTIFIER_SA;
  if (!sa || !NOTIFIER) return null;

  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa,
    // The impersonation. Without `sub` this is the service account's own token, which has no
    // mailbox and would fail on send with a message about the user not existing.
    sub: NOTIFIER,
    scope: SEND_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const signed = await client.request<{ signedJwt?: string }>({
    url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(sa)}:signJwt`,
    method: "POST",
    data: { payload: JSON.stringify(claims) },
  });
  const assertion = signed.data?.signedJwt;
  if (!assertion) return null;

  const exchanged = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!exchanged.ok) return null;
  const body = (await exchanged.json()) as { access_token?: string };
  return body.access_token ?? null;
}

/** Whether this deployment can send at all. The sweep reports it rather than guessing. */
export function canSendMail(): boolean {
  return Boolean(NOTIFIER && process.env.WARRANT_NOTIFIER_SA);
}
