import { Ground } from "@/components";
import { Masthead, Footer } from "../../Masthead";
import { RecordView } from "./RecordView";

/** The paper ground: this is what survives the workshop, and it is public and shareable. */
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Ground tone="paper">
      <div className="page">
        <Masthead />
        <main className="page__body"><RecordView id={id} /></main>
        <Footer />
      </div>
    </Ground>
  );
}
