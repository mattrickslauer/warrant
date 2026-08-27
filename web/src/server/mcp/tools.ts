import "server-only";

// The machine-to-machine surface. Seven tools, over the same spine every other surface uses.
//
// THE POINT OF THIS FILE IS WHAT IT REFUSES TO EXPOSE.
//
// An MCP server over a system like this one is an invitation to build a bypass: a caller that
// can seal a record, release a machine or waive a step has been handed the keys the product
// exists to hold. So the surface is deliberately read-mostly, and the three tools that write
// all write things a PERSON still has to act on:
//
//   * `open_job` starts a job in `draft`. `finalize()` is what makes it real and is documented
//     in the contract as "the human act"; no tool here calls it. An external system may queue
//     work. It may not decide that work has begun.
//   * `raise_po` DRAFTS a purchase order as an `approve_order` task. Nothing is ordered and
//     nothing is sent. `tasks.ts` already makes this argument; this tool inherits it rather
//     than inventing a second, weaker version of it.
//   * `request` raises a task against a ROLE. It is a question put to a department, not an
//     instruction executed on one.
//
// Sealing, releasing, waiving and adjudicating are absent, and their absence is the feature.
// The Gate is a condition on `job.sealed` and it stays reachable from exactly one place.
//
// Every tool is tenant-scoped from the VERIFIED session — never from an argument — for the
// same reason `/api/jobs/seal` re-reads every fact: Admin credentials bypass firestore.rules,
// so a tenant a caller merely asserted is not a tenant boundary at all.

import { z } from "zod";
import type { DataSource } from "@/data/source";
import { openItems } from "@/data/attention";
import { stockFor, type StockLine } from "@/server/stock";
import { raiseTask, taskIdFor } from "@/server/tasks";
import type { Role } from "@/auth/members";

/** Who is calling, resolved from the session and never from the request body. */
export interface McpCaller {
  tenantId: string;
  uid: string;
}

export interface McpContext {
  caller: McpCaller;
  source: DataSource;
}

/**
 * One tool, in a shape both the MCP server and a test can consume.
 *
 * The handler returns plain JSON. Wrapping it in MCP's content envelope is the transport's
 * job and happens once, in `server.ts` — so these stay directly callable, which is what makes
 * `mcp.test.mjs` able to drive a whole job through the surface with no HTTP at all.
 */
export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /** Reads nothing and changes nothing, which MCP clients use to decide what needs consent. */
  readOnly: boolean;
  inputSchema: S;
  handler: (args: Record<string, unknown>, ctx: McpContext) => Promise<unknown>;
}

/**
 * The id to hand the DataSource, having CHECKED any tenant the caller wrote into it.
 *
 * Ids travel tenant-scoped through the interface (`scoped()` in live-source.ts). A caller may
 * therefore send `acme.com/job_9`, and the tenant in it names which tenant they THINK they are
 * in — the session says which one they are. Mismatched, it is refused rather than silently
 * rescoped, which is the same rule `/api/jobs/seal` applies to the same shape of input.
 */
function scopedId(tenantId: string, raw: string): string {
  const cut = raw.lastIndexOf("/");
  if (cut < 0) return `${tenantId}/${raw}`;
  const named = raw.slice(0, cut);
  const bare = raw.slice(cut + 1);
  if (named !== tenantId) {
    // Deliberately does not say which tenant the caller is in, only that this is not theirs.
    throw new Error(`${bare} does not belong to this tenant.`);
  }
  return `${tenantId}/${bare}`;
}

/**
 * A job the caller is allowed to see, or an error naming the id rather than the tenant.
 *
 * The tenant is never quoted back. A caller probing for another tenant's job learns whether
 * the id exists and nothing about who holds it.
 */
async function jobOrThrow(ctx: McpContext, jobId: string) {
  const job = await ctx.source.getJob(scopedId(ctx.caller.tenantId, jobId));
  if (!job || job.tenant_id !== ctx.caller.tenantId) {
    throw new Error(`No job ${jobId} in this tenant.`);
  }
  return job;
}

export function warrantTools(): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "list_procedures",
      title: "List procedures",
      description:
        "What this shop knows how to do, and at which version. Returns published procedures " +
        "with the strictness they run at and the minimum surface tier they require — a " +
        "procedure whose steps need an instrument cannot be performed by a surface that has " +
        "none, and that is refused before a job starts rather than downgraded.",
      readOnly: true,
      inputSchema: {},
      handler: async (_args, ctx) => {
        const procedures = await ctx.source.listProcedures(ctx.caller.tenantId);
        return {
          procedures: procedures.map((p) => ({
            id: p.id,
            key: p.key,
            title: p.title,
            version: p.version,
            strictness: p.strictness,
            minimum_tier: p.minimum_tier,
            step_count: p.steps?.length ?? 0,
            // Published WITHOUT these, and named rather than hidden. A caller choosing a
            // procedure should be able to see which checks it went out missing.
            dropped: p.dropped ?? [],
            disqualifiers: p.disqualifiers ?? [],
            status: p.status ?? "published",
          })),
        };
      },
    },

    {
      name: "open_job",
      title: "Open a job",
      description:
        "Start a procedure against an asset. THE JOB IS CREATED AS A DRAFT: no agent runs on " +
        "a draft, and a person must finalize it before the work is real. That is deliberate — " +
        "an external system may queue work, but the decision that work has begun stays with a " +
        "human. Returns the job id and what it is waiting on.",
      readOnly: false,
      inputSchema: {
        procedure_id: z.string().describe("The procedure id, from list_procedures."),
        tier: z
          .enum(["open", "attested", "instrumented"])
          .optional()
          .describe(
            "What the surface performing this job can supply. Defaults to the procedure's " +
              "minimum, because a job opened below it could never be performed.",
          ),
      },
      handler: async (args, ctx) => {
        const procedureId = String(args.procedure_id ?? "");
        const procedure = await ctx.source.getProcedure(
          scopedId(ctx.caller.tenantId, procedureId),
        );
        if (!procedure || procedure.tenant_id !== ctx.caller.tenantId) {
          throw new Error(`No procedure ${procedureId} in this tenant.`);
        }
        // A tier below the procedure's minimum is refused rather than quietly downgraded —
        // the same rule `surfaceCanRun` enforces on every other surface.
        const tier = (args.tier as "open" | "attested" | "instrumented") ?? procedure.minimum_tier;
        const RANK = { open: 0, attested: 1, instrumented: 2 } as const;
        if (RANK[tier] < RANK[procedure.minimum_tier]) {
          throw new Error(
            `${procedure.title} requires a ${procedure.minimum_tier} surface and this job ` +
              `asked for ${tier}. A job opened below the minimum could never be performed.`,
          );
        }
        const job = await ctx.source.startJob({
          procedureId: procedure.id,
          tenantId: ctx.caller.tenantId,
          tier,
        });
        return {
          job_id: job.id,
          status: job.status,
          procedure: { id: procedure.id, title: procedure.title, version: procedure.version },
          // Said plainly, because a caller that does not know this will believe it started work.
          note:
            "This job is a draft. No agent will run on it and no evidence can be judged until " +
            "a person finalizes it.",
        };
      },
    },

    {
      name: "step_status",
      title: "What a job is waiting on",
      description:
        "What evidence a job is waiting on, and what any agent has asked a person for. Derived " +
        "from the step outcomes by the same function both surfaces use, so this cannot drift " +
        "from what the technician's screen says.",
      readOnly: true,
      inputSchema: { job_id: z.string() },
      handler: async (args, ctx) => {
        const job = await jobOrThrow(ctx, String(args.job_id ?? ""));
        const open = openItems(job);
        return {
          job_id: job.id,
          status: job.status,
          procedure_id: job.procedure_id,
          procedure_version: job.procedure_version,
          steps_total: job.steps?.length ?? 0,
          steps_performed: (job.steps ?? []).filter((s) => s.status === "performed").length,
          record_id: job.record_id ?? null,
          waiting_on: open.map((i) => ({
            step_id: i.stepId,
            // question · hold · evidence — what kind of thing is waiting decides what a
            // person can do about it.
            kind: i.kind,
            ask: i.ask,
            outstanding: i.outstanding,
            answered_by: i.answeredBy,
          })),
        };
      },
    },

    {
      name: "get_record",
      title: "Get a sealed record",
      description:
        "The sealed record, its evidence and the provenance class of every field — measured, " +
        "specified, inferred or asserted. Also returns what the record could NOT reach at the " +
        "tier it ran on, and any deficiency holding the machine out of service.",
      readOnly: true,
      inputSchema: {
        record_id: z
          .string()
          .describe("The record id, or the job id — a job carries its record_id once sealed."),
      },
      handler: async (args, ctx) => {
        const asked = String(args.record_id ?? "");
        let record = await ctx.source.getRecord(scopedId(ctx.caller.tenantId, asked));
        if (!record) {
          // A caller holding a job id is the common case and guessing that record id equals
          // job id is exactly what `Job.record_id` exists to stop clients doing.
          const job = await ctx.source.getJob(scopedId(ctx.caller.tenantId, asked));
          if (job?.record_id) {
            record = await ctx.source.getRecord(scopedId(ctx.caller.tenantId, job.record_id));
          }
        }
        if (!record || record.tenant_id !== ctx.caller.tenantId) {
          throw new Error(`No sealed record for ${asked} in this tenant.`);
        }
        return {
          record_id: record.id,
          job_id: record.job_id,
          sealed_at: record.sealed_at,
          ceiling_tier: record.ceiling_tier,
          ceiling_reachable: record.ceiling_reachable,
          // The honest half. What this tier could not establish, with the reason.
          ceiling_unreachable: record.ceiling_unreachable,
          // What the Gate reads. A deficiency here is why a machine is still held.
          deficiencies: record.deficiencies,
          public: record.public,
        };
      },
    },

    {
      name: "inventory",
      title: "Inventory",
      description:
        "What is on the shelf, and what is below its reorder floor. Shortages sort first, " +
        "because a caller asking about stock is usually asking what is about to stop a job.",
      readOnly: true,
      inputSchema: {
        shortages_only: z
          .boolean()
          .optional()
          .describe("Only lines at or below their floor."),
      },
      handler: async (args, ctx) => {
        const lines: StockLine[] | null = await stockFor(ctx.caller.tenantId);
        // NULL IS NOT AN EMPTY SHELF, and flattening it to `[]` here would undo the reason
        // `stockFor` returns it. A shop that keeps no inventory has told us nothing about
        // what it holds; a caller shown `parts: []` would conclude it holds nothing and
        // order everything. Said in words, because this crosses a machine boundary.
        if (lines === null) {
          return {
            parts: null,
            shortages: null,
            note:
              "This tenant keeps no inventory in Warrant. That is not the same as the shelf " +
              "being empty — nothing here knows what is on it.",
          };
        }
        const short = (l: StockLine) => l.on_hand <= (l.floor ?? 0);
        const chosen = args.shortages_only ? lines.filter(short) : lines;
        return {
          parts: chosen.map((l) => ({ ...l, below_floor: short(l) })),
          shortages: lines.filter(short).length,
        };
      },
    },

    {
      name: "raise_po",
      title: "Draft a purchase order",
      description:
        "Draft a purchase order against a shortage. NOTHING IS ORDERED AND NOTHING IS SENT: " +
        "this raises an approval task for somebody with standing, and their approval is the " +
        "act that spends money. Calling it twice for the same part updates the one draft " +
        "rather than raising a second.",
      readOnly: false,
      inputSchema: {
        part: z.string().describe("The part number or shelf key."),
        quantity: z.number().int().positive().optional(),
        reason: z.string().describe("Why this is being ordered. Goes on the task a person reads."),
      },
      handler: async (args, ctx) => {
        const part = String(args.part ?? "").trim();
        if (!part) throw new Error("A purchase order has to name a part.");
        const qty = typeof args.quantity === "number" ? args.quantity : null;
        const task = await raiseTask({
          tenantId: ctx.caller.tenantId,
          kind: "approve_order",
          title: `Approve the drafted order — ${part}${qty ? ` ×${qty}` : ""}`,
          detail: String(args.reason ?? "Raised over MCP by an external system."),
          // Keyed on the part, so a caller retrying is idempotent at the point of write —
          // the same property `taskFromDisposition` relies on. A second call must not become
          // a second order.
          cause: `mcp_po:${part}`,
          assigneeRole: "foreman",
          createdByAgent: null,
        });
        return {
          task_id: task.id,
          status: task.status,
          note: "Drafted, not sent. A person with standing has to approve it.",
        };
      },
    },

    {
      name: "request",
      title: "Send a request to a department",
      description:
        "Put a task to another department and track the reply. It is a question raised against " +
        "a ROLE, which makes it a queue anybody holding that role can claim — not an " +
        "instruction executed on somebody's behalf.",
      readOnly: false,
      inputSchema: {
        to_role: z.enum(["owner", "foreman", "technician", "viewer"]),
        title: z.string(),
        detail: z.string(),
        job_id: z.string().optional().describe("The job this concerns, if it concerns one."),
        due_at: z.string().optional().describe("ISO 8601. When this wants attention."),
      },
      handler: async (args, ctx) => {
        const title = String(args.title ?? "").trim();
        if (!title) throw new Error("A request has to say what it is asking for.");
        const jobId = args.job_id ? String(args.job_id) : null;
        // Verified rather than trusted: a request that names another tenant's job would file a
        // readable pointer to it in this tenant's task list.
        if (jobId) await jobOrThrow(ctx, jobId);
        const task = await raiseTask({
          tenantId: ctx.caller.tenantId,
          kind: "escalation",
          title,
          detail: String(args.detail ?? ""),
          cause: `mcp_request:${ctx.caller.uid}:${title}`,
          assigneeRole: args.to_role as Role,
          jobId,
          dueAt: args.due_at ? String(args.due_at) : null,
          createdByAgent: null,
        });
        return { task_id: task.id, status: task.status, assigned_role: args.to_role };
      },
    },
  ];

  return tools;
}

/** Exported so a test can assert the surface has not silently grown a way to seal a record. */
export const TOOL_NAMES = warrantTools().map((t) => t.name);
export { taskIdFor };
