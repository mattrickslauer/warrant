import "server-only";

// A ceiling on what one caller can spend.
//
// Two routes in this system put a request in front of a model: `/api/adjudicate` and
// `/api/scoper/turn`. Both were reachable by any signed-in caller with no ceiling of any kind,
// and "any signed-in caller" is a lower bar here than it sounds — `session-context.tsx` signs a
// visitor in ANONYMOUSLY on first use, so a real session is available to anyone who loads the
// page. `/api/scoper/turn` needs no Firestore state at all: a bare POST reaches Gemini.
//
// `adjudicate()` made it worse by being replayable. It never read the `adjudicated` flag before
// running, so the same capture id could be re-submitted indefinitely and each call re-ran armor,
// the screen, the Inspector and the Skeptic. One request, four model calls, no limit.
//
// ## What this is, and what it honestly is not
//
// A fixed window per caller, held in memory. That is bounded by the process: Cloud Run runs up
// to `--max-instances 4`, so the real ceiling is up to four times what is written here, and a
// cold start forgets everything.
//
// It is deliberately not Firestore-backed, and the reason is worth stating rather than leaving
// as an omission. A rate limiter that writes a document per request costs a write per request —
// so under exactly the flood it exists to stop, it doubles the load and bills for it. What this
// is for is the difference between "a script empties the model budget in an afternoon" and "a
// script gets 30 calls a minute per instance and gives up". Standing in front of a determined
// distributed attacker is a job for Cloud Armor at the edge, which is where it belongs and
// where it is a deployment concern rather than a code one.

/** One caller's usage of one bucket. */
interface Window {
  count: number;
  /** When this window opened, in ms. */
  since: number;
}

const windows = new Map<string, Window>();

/**
 * Keep the map from being its own leak.
 *
 * Every entry is dead once its window has passed, but nothing walks the map on a quiet route.
 * Swept opportunistically on write rather than on a timer, because a `setInterval` in a Next.js
 * module holds the process awake and behaves differently in dev, in build and on Cloud Run.
 */
function sweep(now: number, windowMs: number): void {
  if (windows.size < 512) return;
  for (const [key, w] of windows) {
    if (now - w.since > windowMs) windows.delete(key);
  }
}

export interface Limit {
  /** How many requests one caller may make in the window. */
  max: number;
  windowMs: number;
}

export interface Decision {
  allowed: boolean;
  /** Whole seconds until the window resets. For `Retry-After`. */
  retryAfter: number;
  remaining: number;
}

/**
 * Spend one request against `key`.
 *
 * The key must identify the CALLER, not the request — a uid, never something from the body,
 * which the caller chooses and could vary to get a fresh bucket every time.
 */
export function take(key: string, limit: Limit, now: number = Date.now()): Decision {
  sweep(now, limit.windowMs);

  const existing = windows.get(key);
  if (!existing || now - existing.since >= limit.windowMs) {
    windows.set(key, { count: 1, since: now });
    return { allowed: true, retryAfter: 0, remaining: limit.max - 1 };
  }

  if (existing.count >= limit.max) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((limit.windowMs - (now - existing.since)) / 1000)),
      remaining: 0,
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfter: 0, remaining: limit.max - existing.count };
}

/** Test seam. The map is process-wide, so a test that fills it has to be able to empty it. */
export function resetLimits(): void {
  windows.clear();
}

/**
 * A ceiling from the environment, or the default when it is absent or nonsense.
 *
 * A malformed override must never mean "no requests allowed" — a typo in an env file would
 * then take the product down in a way whose cause is invisible from the outside. Falls back
 * loudly in the only way a module can: use the default and keep serving.
 */
function envMax(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * A ceiling that stops a script, not a demonstration.
 *
 * The number is deliberately generous, and the reason is that the two failure modes are not
 * symmetric. Set too high, a script drains an afternoon of model budget — bad, bounded, and
 * visible on a bill. Set too low, the product refuses a person who is using it correctly, and
 * a refusal is indistinguishable from the thing being broken. THIRTY WAS TOO LOW: one capture
 * is one call, but a step that grows a field, a retake, a reload that re-fires the pending
 * captures and a sweep running underneath all land in the same minute, and a run through a
 * seven-step procedure could reach it while the person was doing nothing unusual at all.
 *
 * So it is raised to something no human hand reaches and every script does, and it is
 * OVERRIDABLE, because the right number depends on what is being demonstrated and nobody
 * should need a deploy to find that out.
 */
export const MODEL_LIMIT: Limit = { max: envMax("WARRANT_MODEL_LIMIT", 240), windowMs: 60_000 };

/**
 * Lower than MODEL_LIMIT, because each turn carries the whole transcript so far — the cost of
 * turn N grows with N, and the last turn of a long interview is the most expensive request in
 * the system.
 *
 * Still far above a person typing. Twelve was not: an interview is a conversation, and a
 * conversation being conducted briskly — or restarted, which replays nothing but does spend a
 * turn — reaches twelve in a minute without anybody abusing anything. Being told to "give it a
 * moment" mid-sentence is the product failing at the exact moment it is being shown working.
 */
export const INTERVIEW_LIMIT: Limit = { max: envMax("WARRANT_INTERVIEW_LIMIT", 90), windowMs: 60_000 };
