import { AppShell } from "../../shell/AppShell";
import { JobFlow } from "./JobFlow";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell tone="work"><JobFlow jobId={id} /></AppShell>;
}
