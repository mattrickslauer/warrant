import { AppShell } from "../../shell/AppShell";
import { RecordView } from "./RecordView";
import { PublicRecord } from "./PublicRecord";
import { readPublicRecord } from "@/server/publish";

/**
 * The paper ground: this is what survives the workshop.
 *
 * One URL, two readers. A stranger holding a shared link gets the redacted projection at
 * /r/{id} — no account, no session, no tenant. Anyone else gets the tenant-scoped view they
 * were already getting, read through the authenticated client so firestore.rules is what
 * enforces access.
 *
 * The public lookup comes FIRST and deliberately: a capability id is unguessable, so finding
 * one is itself the authorisation, and falling through to the tenant path would make a
 * stranger's link depend on a session they do not have.
 */
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  // A tenant-scoped id is `tenant/doc` and arrives as one segment with the slash
  // percent-encoded; a public capability id has no slash and no percent, so decoding is a
  // no-op on that path and the stranger's link is unaffected.
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const published = await readPublicRecord(id);

  return (
    <AppShell tone="paper">
      {published ? <PublicRecord record={published} /> : <RecordView id={id} />}
    </AppShell>
  );
}
