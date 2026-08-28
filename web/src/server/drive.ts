import "server-only";

// Drive. Where the record and the ledger live, in the shop's own account.
//
// THE POINT IS THAT IT IS NOT IN WARRANT. A maintenance record is worth something years after
// the job, and often to somebody who never had a login here — an insurer, a buyer, a regulator,
// the next owner. A record that exists only inside a vendor's database is a record with a
// dependency on that vendor still being in business and still letting you in. So the seal is
// projected into the shop's Drive: a document per sealed job, and one row per seal in a ledger
// they can sort, filter and pivot without asking anyone.
//
// Warrant remains the source of truth and the Drive copy is a PROJECTION, exactly as the
// calendar is. Nothing here is read back and no decision depends on it. A shop that deletes the
// folder loses a convenience, not a record.
//
// THE SCOPE IS `drive.file`, which is per-file access to files THIS APP CREATED. Warrant can
// write the folder and the sheet it made and cannot see one other thing in the account — not a
// tax return, not a contract, not a photograph. That is also why the ledger costs no extra
// scope: the Sheets API accepts `drive.file` for a spreadsheet the app created.
//
// WHOSE DRIVE. The files belong to the tenant, not to whoever happened to seal first, so the
// ids live at /tenants/{t}/integrations/workspace and every later seal writes into the same
// folder using whichever member's token is available. The creating member's grant is what the
// API call rides on; the folder is shared to the domain so it does not become one person's
// private copy of the shop's records. See `ensureLedger`.

import { adminDb } from "@/auth/admin";
import { accessTokenFor, googleFetch, hasScope } from "@/server/workspace";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const DOC_MIME = "application/vnd.google-apps.document";

export interface WorkspaceFiles {
  folder_id: string;
  ledger_id: string;
  /** Whose grant created them. Recorded so the failure "that person left" is legible. */
  owner_uid: string;
  created_at: string;
}

const integrationRef = (tenantId: string) =>
  adminDb().collection("tenants").doc(tenantId)
    .collection("integrations").doc("workspace");

export async function workspaceFiles(tenantId: string): Promise<WorkspaceFiles | null> {
  const snap = await integrationRef(tenantId).get();
  return snap.exists ? (snap.data() as WorkspaceFiles) : null;
}

/**
 * The shop's folder and ledger, made once and remembered.
 *
 * Returns null when this member has not granted Drive, which is an ordinary state and not an
 * error: the record is already sealed and durable in Firestore, and the Drive copy is a
 * convenience that arrives when somebody connects Workspace.
 *
 * The stored ids are TRUSTED WITHOUT CHECKING on later calls. Verifying that a folder still
 * exists costs a round trip on every seal to defend against somebody deleting it, and the
 * write that follows already fails loudly in that case — at which point the next seal recreates
 * it, because `remember` is cleared on a 404. Cheap in the common case, self-healing in the
 * rare one.
 */
async function ensureLedger(
  tenantId: string, uid: string, shopName: string,
): Promise<{ files: WorkspaceFiles; token: string } | null> {
  if (!(await hasScope(uid, DRIVE_SCOPE))) return null;
  const token = await accessTokenFor(uid);
  if (!token) return null;

  const held = await workspaceFiles(tenantId);
  if (held?.folder_id && held?.ledger_id) return { files: held, token };

  const folderId = await createFile(token, {
    name: `Warrant — ${shopName}`,
    mimeType: FOLDER_MIME,
  });
  if (!folderId) return null;

  const ledgerId = await createFile(token, {
    name: "Warrant ledger",
    mimeType: SHEET_MIME,
    parents: [folderId],
  });
  if (!ledgerId) return null;

  // The header row, written once at creation. A ledger whose columns are unlabelled is a grid
  // of strings, and the person who opens it in two years is not the person who set it up.
  await googleFetch(
    `${SHEETS}/${encodeURIComponent(ledgerId)}/values/A1:append?valueInputOption=RAW`,
    token,
    { method: "POST", body: JSON.stringify({ values: [LEDGER_HEADER] }) },
  ).catch(() => undefined);

  // Share the folder with the domain, so it is the SHOP's ledger rather than one employee's.
  // Best effort: a personal Google account has no domain and this simply does not apply, and a
  // Workspace policy may forbid domain sharing — neither is a reason to lose the record.
  //
  // A tenant id IS the Workspace domain for an enterprise, and `u:<uid>` or `anon:<uid>` for a
  // tenant of one — see tenantOf() in firestore.rules. Testing for those prefixes rather than
  // for a dot, because a dot is a property of most domains and not a definition of one.
  const personal = shopName.startsWith("u:") || shopName.startsWith("anon:");
  const domain = !personal && shopName.includes(".") ? shopName : null;
  if (domain) {
    await googleFetch(`${DRIVE}/${encodeURIComponent(folderId)}/permissions`, token, {
      method: "POST",
      body: JSON.stringify({ type: "domain", role: "writer", domain }),
    }).catch(() => undefined);
  }

  const files: WorkspaceFiles = {
    folder_id: folderId, ledger_id: ledgerId, owner_uid: uid,
    created_at: new Date().toISOString(),
  };
  await integrationRef(tenantId).set(files, { merge: true });
  return { files, token };
}

async function createFile(
  token: string, metadata: Record<string, unknown>,
): Promise<string | null> {
  const response = await googleFetch(`${DRIVE}?fields=id`, token, {
    method: "POST", body: JSON.stringify(metadata),
  });
  if (!response.ok) return null;
  return ((await response.json()) as { id?: string }).id ?? null;
}

/** The ledger's columns. Exported so a test can assert the row matches the header. */
export const LEDGER_HEADER = [
  "Sealed at", "Record", "Procedure", "Version", "Asset", "Technician",
  "Evidence tier", "Machine released", "Deficiencies", "Warrant link", "Document",
] as const;

export interface LedgerEntry {
  tenantId: string;
  /** Whose Drive grant this call rides on. Any linked member of the tenant will do. */
  uid: string;
  shopName: string;
  recordId: string;
  sealedAt: string;
  procedureTitle: string;
  procedureVersion: number;
  assetLabel: string | null;
  technician: string | null;
  tier: string;
  machineReleased: boolean;
  deficiencies: number;
  /** The public record URL if it has been shared, otherwise the in-app one. */
  recordUrl: string;
  /** The full record as a person reads it. Becomes a Google Doc beside the ledger row. */
  documentHtml: string;
}

export interface Exported {
  documentId: string | null;
  documentUrl: string | null;
  ledgerId: string;
}

/**
 * Project one sealed record into Drive: a document, and a row pointing at it.
 *
 * Returns null when Drive is not reachable for this tenant — nobody has linked, or the grant
 * was revoked. Never throws except `RateLimited`, which the sweep already understands: the
 * record is sealed either way, and losing a seal to save its Drive copy would be exactly
 * backwards.
 */
export async function exportRecord(entry: LedgerEntry): Promise<Exported | null> {
  const ready = await ensureLedger(entry.tenantId, entry.uid, entry.shopName);
  if (!ready) return null;
  const { files, token } = ready;

  const documentId = await uploadDocument(token, files.folder_id, entry);
  const documentUrl = documentId
    ? `https://docs.google.com/document/d/${documentId}/edit`
    : null;

  const appended = await googleFetch(
    `${SHEETS}/${encodeURIComponent(files.ledger_id)}/values/A1:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    { method: "POST", body: JSON.stringify({ values: [ledgerRow(entry, documentUrl)] }) },
  );

  if (appended.status === 404) {
    // Somebody deleted the sheet. Forget the ids so the next seal builds a new one rather than
    // failing forever against a file that is not there.
    await integrationRef(entry.tenantId).delete().catch(() => undefined);
    return null;
  }

  return { documentId, documentUrl, ledgerId: files.ledger_id };
}

/** One row, in the header's order. Pure, so the ordering is a test rather than a hope. */
export function ledgerRow(entry: LedgerEntry, documentUrl: string | null): string[] {
  return [
    entry.sealedAt,
    entry.recordId,
    entry.procedureTitle,
    String(entry.procedureVersion),
    entry.assetLabel ?? "",
    entry.technician ?? "",
    entry.tier,
    entry.machineReleased ? "released" : "held",
    String(entry.deficiencies),
    entry.recordUrl,
    documentUrl ?? "",
  ];
}

/**
 * The record itself, as a Google Doc.
 *
 * Uploaded as HTML and converted, rather than assembled through the Docs API. The Docs API
 * builds a document out of a hundred index-addressed insert requests whose offsets shift as you
 * apply them; HTML is the same document in one request, and Drive's converter has been doing
 * this for fifteen years. A PDF would be more final and less useful — nobody can paste a row of
 * a PDF into an email to an insurer.
 */
async function uploadDocument(
  token: string, folderId: string, entry: LedgerEntry,
): Promise<string | null> {
  const boundary = `warrant-${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: `${entry.procedureTitle} — ${entry.assetLabel ?? entry.recordId}`,
    mimeType: DOC_MIME,
    parents: [folderId],
    // The record's own timestamp, not the upload's. A ledger sorted by creation date should
    // read as the order the work was sealed in.
    createdTime: entry.sealedAt,
  };

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    `${entry.documentHtml}\r\n` +
    `--${boundary}--`;

  const response = await googleFetch(
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, token,
    { method: "POST", body, headers: { "content-type": `multipart/related; boundary=${boundary}` } },
  );
  if (!response.ok) return null;
  return ((await response.json()) as { id?: string }).id ?? null;
}

/**
 * Any member of this tenant whose Workspace grant covers Drive.
 *
 * The seal runs on the server with no user in front of it, so it needs somebody's grant to
 * write with. The tenant's recorded owner first — that keeps every record in one Drive even
 * after the person who sealed it has gone home — and any linked member otherwise, because a
 * record landing in a colleague's Drive is better than not landing.
 */
export async function driveMemberFor(tenantId: string): Promise<string | null> {
  const held = await workspaceFiles(tenantId);
  if (held?.owner_uid && (await hasScope(held.owner_uid, DRIVE_SCOPE))) return held.owner_uid;

  const snap = await adminDb()
    .collection("tenants").doc(tenantId).collection("members")
    .where("workspace.linked", "==", true)
    .limit(10)
    .get();

  for (const doc of snap.docs) {
    const uid = String(doc.data().uid ?? doc.id);
    if (await hasScope(uid, DRIVE_SCOPE)) return uid;
  }
  return null;
}
