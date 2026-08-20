import Image from "next/image";
import type { Check, Prompt, Status } from "@/server/evals";
import { STATUS_LABEL } from "@/server/evals";

/**
 * The pieces /model-tests is built from.
 *
 * These deliberately do NOT go into `src/components`. That library is the product's surface,
 * and its constraint — no screen invents a component — is what keeps the workshop UI coherent.
 * This is an instrument panel pointed at the product, not part of it, and it should not be
 * able to drift the product's vocabulary by adding to it.
 */

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`mt-chip mt-chip--${status}`}>
      <i aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Machine output, in the machine's face. The mono/sans provenance rule holds here too. */
export function Json({ value, className = "" }: { value: unknown; className?: string }) {
  return (
    <pre className={`mt-json ${className}`}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-field">
      <span className="mt-field__label">{label}</span>
      <span className="mt-field__value">{children}</span>
    </div>
  );
}

/**
 * Exactly what was put in front of the model.
 *
 * The system instruction is collapsed by default and is worth opening once: it is not written
 * anywhere else. It is assembled from the contract schema's own `description` fields, so the
 * rule that validates an answer and the prompt that asks for it are the same sentence — which
 * is the claim this page exists to let someone check rather than take on trust.
 */
export function PromptView({ prompt, open = false }: { prompt?: Prompt; open?: boolean }) {
  if (!prompt) return null;
  return (
    <div className="mt-prompt">
      {prompt.instruction && (
        <details className="mt-fold" open={open}>
          <summary>
            System instruction
            <span className="mt-fold__note">assembled from the contract schema, not hand-written</span>
          </summary>
          <pre className="mt-pre">{prompt.instruction}</pre>
        </details>
      )}
      {(prompt.parts ?? []).map((part, i) =>
        part.kind === "media" ? (
          <figure key={i} className="mt-media">
            <Image
              src={`/evals/${part.label}`}
              alt={part.label ?? "evidence"}
              width={420}
              height={315}
              className="mt-media__img"
            />
            <figcaption>
              <span className="mt-mono">{part.label}</span>
              <span className="mt-dim">{part.mime} · {part.digest}</span>
            </figcaption>
          </figure>
        ) : (
          <pre key={i} className="mt-pre mt-pre--turn">{part.text}</pre>
        ),
      )}
    </div>
  );
}

/**
 * What the scenario demanded, next to what it got.
 *
 * Assertions pin the part of an answer that decides something and never the whole object —
 * exact-matching a rationale would fail the first time it was reworded. Showing the operator
 * and the path makes that visible: a reader can see the suite is testing the verdict, not the
 * prose around it.
 */
export function Checks({ checks }: { checks?: Check[] }) {
  if (!checks?.length) return null;
  return (
    <table className="mt-checks">
      <thead>
        <tr><th /><th>asserted</th><th>about</th><th>what happened</th></tr>
      </thead>
      <tbody>
        {checks.map((c, i) => (
          <tr key={i} className={c.ok ? "" : "mt-checks__bad"}>
            <td className="mt-checks__mark">{c.ok ? "ok" : "FAIL"}</td>
            <td className="mt-mono">{c.op}</td>
            <td className="mt-mono mt-dim">{c.path}</td>
            <td>{c.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
