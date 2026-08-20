import { Ground } from "@/components";
import { Masthead, Footer } from "../../Masthead";
import { RecordView } from "./RecordView";
import { PublicRecord } from "./PublicRecord";
import { readPublicRecord } from "@/server/publish";

/**
 * The paper ground: this is what survives the workshop.
 *
 * One URL, two readers. A stranger holding a shared link gets the redacted projection at
 * /records/{id} — no account, no session, no tenant. Anyone else gets the tenant-scoped view
 * they were already getting, read through the authenticated client so firestore.rules is what
 * enforces access.
 *
 * The public lookup comes FIRST and deliberately: a capability id is unguessable, so finding
 * one is itself the authorisation, and falling through to the tenant path would make a
 * stranger's link depend on a session they do not have.
 */
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const published = await readPublicRecord(id);

  return (
    <Ground tone="paper">
      <div className="page">
        <Masthead />
        <main className="page__body">
          {published ? <PublicRecord record={published} /> : <RecordView id={id} />}
        </main>
        <Footer />
      </div>
    </Ground>
  );
}
