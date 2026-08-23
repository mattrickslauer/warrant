import "server-only";

// The reasoning trace — one span per agent, nested under the capture that caused them.
//
// FEF asks for "OpenTelemetry-compliant audit logs, end-to-end reasoning traces", and until
// this file existed the adjudication spine emitted NOTHING: no request id, no timing beyond the
// latency on a single reply, no way to see that one photograph caused an armor screen, two
// agents in parallel and a step transition. The `decisions` collection is a real audit log and
// a better one than a trace for a dispute months later — but it is a flat list of verdicts, and
// a flat list cannot show that two agents ran concurrently under one cause.
//
// TWO OUTPUTS, ON PURPOSE.
//
//   1. A REAL OTEL SPAN, through `@opentelemetry/api`. That package is already present (it
//      arrives with @google-cloud/firestore), so this is the standard instrumentation API with
//      no new dependency. With no SDK registered the API returns a no-op tracer and this costs
//      nothing; register an exporter at deploy time and the spans go to Cloud Trace without a
//      line of this file changing. Instrumentation and export are separate concerns and this is
//      the half that belongs in the application.
//
//   2. A STRUCTURED LOG LINE, always. Cloud Run picks up JSON on stdout, and the magic field
//      `logging.googleapis.com/trace` is what makes Cloud Logging group lines under one trace —
//      so the reasoning trace is READABLE TODAY, with no collector deployed. Emitting it
//      unconditionally is what keeps this honest: a span that goes nowhere is not observability,
//      and "we added OpenTelemetry" with no exporter is the sort of claim this repo refuses
//      everywhere else.

import { randomBytes } from "node:crypto";

/** W3C trace ids are 32 hex characters, span ids 16. Cloud Trace expects exactly that. */
const traceId = () => randomBytes(16).toString("hex");
const spanId = () => randomBytes(8).toString("hex");

export interface TraceContext {
  traceId: string;
  /** The span this one hangs under, so the tree has a shape rather than being a flat list. */
  parentSpanId?: string;
}

export function newTrace(): TraceContext {
  return { traceId: traceId() };
}

type Attributes = Record<string, string | number | boolean | null | undefined>;

/**
 * Run one step of work as a span.
 *
 * Errors are recorded and RETHROWN, never swallowed: a span that reports ok because the
 * instrumentation ate the exception is worse than no span at all.
 */
export async function withSpan<T>(
  ctx: TraceContext,
  name: string,
  attributes: Attributes,
  fn: (child: TraceContext) => Promise<T>,
): Promise<T> {
  const id = spanId();
  const child: TraceContext = { traceId: ctx.traceId, parentSpanId: id };
  const started = Date.now();

  let otelSpan: { setAttribute: Function; setStatus: Function; end: Function } | null = null;
  try {
    // Imported lazily and defensively. If the package is ever absent this must degrade to the
    // log line rather than take an adjudication down for the sake of telemetry.
    const { trace, SpanStatusCode } = await import("@opentelemetry/api");
    const span = trace.getTracer("warrant").startSpan(name);
    for (const [k, v] of Object.entries(attributes)) {
      if (v !== null && v !== undefined) span.setAttribute(k, v);
    }
    otelSpan = { setAttribute: span.setAttribute.bind(span),
                 setStatus: (ok: boolean, message?: string) =>
                   span.setStatus({ code: ok ? SpanStatusCode.OK : SpanStatusCode.ERROR,
                                    message }),
                 end: span.end.bind(span) };
  } catch {
    otelSpan = null;
  }

  try {
    const result = await fn(child);
    otelSpan?.setStatus(true);
    emit(ctx, id, name, started, true, attributes);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    otelSpan?.setStatus(false, message);
    emit(ctx, id, name, started, false, { ...attributes, error: message });
    throw error;
  } finally {
    otelSpan?.end();
  }
}

/**
 * One line of JSON per span.
 *
 * `logging.googleapis.com/trace` and `...spanId` are the fields Cloud Logging reads to group a
 * request's lines into a trace, and `projects/{id}/traces/{trace}` is the shape it requires —
 * a bare id is silently ignored, which looks exactly like tracing not working.
 */
function emit(ctx: TraceContext, id: string, name: string, started: number,
              ok: boolean, attributes: Attributes): void {
  const project = process.env.GCP_PROJECT
    ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    ?? "";
  const line: Record<string, unknown> = {
    severity: ok ? "INFO" : "ERROR",
    message: `${name} ${Date.now() - started}ms`,
    span: name,
    duration_ms: Date.now() - started,
    ok,
    ...attributes,
    "logging.googleapis.com/spanId": id,
    ...(ctx.parentSpanId ? { parent_span_id: ctx.parentSpanId } : {}),
    ...(project ? { "logging.googleapis.com/trace": `projects/${project}/traces/${ctx.traceId}` }
                : { trace_id: ctx.traceId }),
  };
  // Never through a logger with its own buffering. One synchronous line, so a process that
  // dies mid-adjudication has still said what it was doing.
  process.stdout.write(JSON.stringify(line) + "\n");
}
