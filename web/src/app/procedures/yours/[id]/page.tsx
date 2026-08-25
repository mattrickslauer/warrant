import { AppShell } from "../../../shell/AppShell";
import { ProcedureEditor } from "./ProcedureEditor";

/**
 * One procedure, editable.
 *
 * The id in the URL is the BARE document id, which is what the list page holds and what
 * `Procedure.id` carries. The editor scopes it to the tenant itself before reading, because
 * LiveSource addresses a procedure `{tenant}/{procedure}` — decoded here anyway, so that a
 * scoped id somebody pasted in still resolves rather than 404ing on its own slash.
 */
export default async function EditProcedurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell tone="work"><ProcedureEditor procedureId={decodeURIComponent(id)} /></AppShell>;
}
