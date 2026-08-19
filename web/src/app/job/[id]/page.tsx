import { Ground } from "@/components";
import { Masthead, Footer } from "../../Masthead";
import { JobFlow } from "./JobFlow";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Ground tone="work">
      <div className="page">
        <Masthead />
        <main className="page__body"><JobFlow jobId={id} /></main>
        <Footer />
      </div>
    </Ground>
  );
}
