import Link from "next/link";
import { AppShell } from "../../shell/AppShell";
import { Rule } from "@/components";
import { listPublicProcedures } from "@/server/public-procedures";
import { DEST } from "../../shell/nav";

/**
 * Everything anybody has chosen to publish.
 *
 * `/` is the picker: three bundled tasks, curated, and deliberately short — it is the first
 * decision a stranger makes and a longer carousel would make that decision worse. This is the
 * uncurated half, reached from the last card of that carousel, and it is the only surface in
 * the product where you can read work that is neither bundled nor yours.
 *
 * Read on the server through the Admin SDK rather than in the browser through the client. The
 * rules do allow a browser to list `public_procedures` — see firestore.rules, `allow read: if
 * true` — but a page that is world-readable by definition has nothing to gain from a session
 * and everything to gain from rendering before JavaScript arrives.
 *
 * There is no `Run it` here, and that is not an oversight. A public procedure is a projection
 * of one frozen version in somebody else's tenant, and running it would mean copying it into
 * yours, which is a decision about ownership rather than a button. What this page promises is
 * the thing publishing was for: you can READ it — every step, every acceptance rule, before
 * you trust it with anything.
 */

const STRICTNESS = ["log", "standard", "assured", "regulated"];

/** The day it was shared, in the reader's terms rather than an ISO stamp nobody parses. */
function day(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

export default async function PublicProceduresPage() {
  const procedures = await listPublicProcedures();

  return (
    <AppShell tone="work">
      <div className="stack stack--lg">
        <div className="stack">
          <p className="eyebrow">Procedures</p>
          <h1 className="hero">Published by everyone</h1>
          <p className="lede">
            Every procedure a shop or a person has chosen to show the world, newest first. Each
            one is a frozen version — what you read here will still say the same thing tomorrow,
            because publishing copies a version rather than pointing at a draft.
          </p>
        </div>

        {procedures.length === 0 && (
          <p className="records__empty">
            Nothing has been published yet. A procedure starts private to the tenant that wrote
            it and stays that way until somebody decides otherwise — which is done from{" "}
            <Link href={DEST.yourProcedures.route}>{DEST.yourProcedures.label}</Link>.
          </p>
        )}

        {procedures.map((p) => (
          <div className="w-def" key={p.id}>
            <div className="w-def__head">
              <span className="w-def__term">{p.title}</span>
              <span className="w-def__meta">{p.owner_label}</span>
            </div>
            <div className="gallery__row">
              <span className="w-chip">v{p.version}</span>
              <span className="w-chip">{STRICTNESS[p.strictness] ?? p.strictness}</span>
              <span className="w-chip">{p.minimum_tier}</span>
              <span className="w-chip">
                {p.steps.length} {p.steps.length === 1 ? "step" : "steps"}
              </span>
              <span className="w-chip w-chip--out">shared {day(p.shared_at)}</span>
            </div>

            {/* The steps, in full. A list of titles is what makes this a procedure you can
                judge rather than a name you have to take on trust. */}
            <ol className="stack">
              {p.steps.map((s) => (
                <li className="w-def__note" key={s.id}>
                  <strong>{s.index}. {s.title}</strong>
                  {s.explanation ? ` — ${s.explanation}` : null}
                </li>
              ))}
            </ol>

            {p.disqualifiers.length > 0 && (
              <p className="w-def__note">
                Stops the job outright: {p.disqualifiers.join(", ")}.
              </p>
            )}
          </div>
        ))}

        <Rule />
        <p className="records__empty">
          Want yours here? Write one in an interview, publish it to freeze a version, then share
          it from <Link href={DEST.yourProcedures.route}>{DEST.yourProcedures.label}</Link>. You
          can take it back down at any time — unsharing deletes the public copy rather than
          hiding it.
        </p>
      </div>
    </AppShell>
  );
}
