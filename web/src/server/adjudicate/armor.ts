import "server-only";

// Model Armor, on evidence, before any model is shown it.
//
// A photograph can carry text, and text in an image can be an instruction. The Inspector is a
// model reading a picture chosen by the person being checked, which is the textbook setting
// for prompt injection — so the image is screened first, and a match means no model sees it.
//
// ## Only pi_and_jailbreak decides, and that is deliberate
//
// The template also runs Google's RAI filters. Screened against a real photograph of brake
// pads in a caliper, `rai.dangerous` returns MATCH_FOUND and the envelope's top-level
// `filterMatchState` therefore reads MATCH_FOUND too. Keying the verdict off that top-level
// field — the obvious thing to do — would refuse a routine photograph of a brake, a blade, a
// battery or a torque wrench, which is most of the evidence this product exists to collect.
//
// A general-purpose safety filter calling machinery "dangerous" says nothing about whether the
// evidence is trustworthy. `contract/entities/capture.schema.json` already says what this field
// means — "Model Armor pi_and_jailbreak on the image" — and that is what is read.
//
// CSAM is honoured, because that is not a judgement call.

const TIMEOUT_MS = 20_000;

export type ArmorVerdict = "NO_MATCH_FOUND" | "MATCH_FOUND" | "NOT_SCREENED";

export interface ArmorResult {
  verdict: ArmorVerdict;
  /** Why, in one line, for the record. Never empty. */
  detail: string;
}

function endpoint(): string | null {
  const location = process.env.MODEL_ARMOR_LOCATION;
  const template = process.env.MODEL_ARMOR_TEMPLATE;
  const project = process.env.GCP_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!location || !template || !project) return null;
  return `https://modelarmor.${location}.rep.googleapis.com/v1/projects/${project}` +
    `/locations/${location}/templates/${template}:sanitizeUserPrompt`;
}

/**
 * Screen one piece of evidence.
 *
 * NEVER returns NO_MATCH_FOUND when the screen did not run. An unscreened capture recorded as
 * clean is a lie the record would carry forever; NOT_SCREENED is an admitted gap, and the
 * whole posture of this system is that an admitted gap beats a fabricated pass.
 */
export async function screenEvidence(
  bytes: Uint8Array,
  accessToken: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ArmorResult> {
  const url = endpoint();
  if (!url) {
    return { verdict: "NOT_SCREENED", detail: "Model Armor is not configured for this build." };
  }
  if (!accessToken) {
    return { verdict: "NOT_SCREENED", detail: "No credential with which to reach Model Armor." };
  }

  let body: unknown;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        userPromptData: {
          byteItem: {
            // IMAGE, not IMAGE_JPEG. The enum is coarse and the API rejects a mime type here
            // with a message that does not name the values it will accept.
            byteDataType: "IMAGE",
            byteData: Buffer.from(bytes).toString("base64"),
          },
        },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        verdict: "NOT_SCREENED",
        detail: `Model Armor returned ${response.status}: ${text.slice(0, 200)}`,
      };
    }
    body = await response.json();
  } catch (error) {
    return { verdict: "NOT_SCREENED", detail: `Model Armor was unreachable: ${String(error)}` };
  }

  return readVerdict(body);
}

/**
 * Screen TEXT, on the same template, before any model is shown it.
 *
 * The image path was the only one that existed, and images were never the whole attack
 * surface. A technician who cannot perform a step records a reason in their own words, and
 * that transcript is handed VERBATIM to the Instructor and then to the Foreman — `cases.ts`
 * says so in as many words, and it is right to, because the words somebody chooses when a bolt
 * is round are evidence about the blocker. But the Foreman's answer is written straight onto
 * the step as `status: "impossible"` and a `disposition_action`, and `impossible` is one of the
 * three statuses that SETTLE a step. firestore.rules refuses all three from a client precisely
 * because the person being checked must not settle their own work — and an unscreened
 * transcript handed to the agent that settles it is the same authority by a longer route.
 *
 * So the transcript is screened too. Same template, same `pi_and_jailbreak` filter, same rule
 * that a failure to screen is NOT a pass.
 */
export async function screenText(
  text: string,
  accessToken: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ArmorResult> {
  const url = endpoint();
  if (!url) {
    return { verdict: "NOT_SCREENED", detail: "Model Armor is not configured for this build." };
  }
  if (!accessToken) {
    return { verdict: "NOT_SCREENED", detail: "No credential with which to reach Model Armor." };
  }
  if (!text.trim()) {
    return { verdict: "NO_MATCH_FOUND", detail: "There was no text to screen." };
  }

  let body: unknown;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ userPromptData: { text } }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        verdict: "NOT_SCREENED",
        detail: `Model Armor returned ${response.status}: ${detail.slice(0, 200)}`,
      };
    }
    body = await response.json();
  } catch (error) {
    return { verdict: "NOT_SCREENED", detail: `Model Armor was unreachable: ${String(error)}` };
  }

  return readVerdict(body);
}

/** Exported for test. The envelope is nested enough to be worth pinning. */
export function readVerdict(body: unknown): ArmorResult {
  const results = (body as any)?.sanitizationResult?.filterResults;
  if (!results) {
    return { verdict: "NOT_SCREENED", detail: "Model Armor returned no sanitization result." };
  }

  const pi = results.pi_and_jailbreak?.piAndJailbreakFilterResult;
  const csam = results.csam?.csamFilterFilterResult;

  if (csam?.matchState === "MATCH_FOUND") {
    return { verdict: "MATCH_FOUND", detail: "Refused by the CSAM filter." };
  }

  if (pi?.executionState && pi.executionState !== "EXECUTION_SUCCESS") {
    return {
      verdict: "NOT_SCREENED",
      detail: `The prompt-injection filter did not run: ${pi.executionState}.`,
    };
  }

  if (pi?.matchState === "MATCH_FOUND") {
    return {
      verdict: "MATCH_FOUND",
      detail: "The image carries what reads as an instruction to the model. No model was shown it.",
    };
  }

  if (pi?.matchState === "NO_MATCH_FOUND") {
    // Said explicitly, because the top-level filterMatchState will often disagree — see the
    // note at the top of this file about brake pads being "dangerous".
    return {
      verdict: "NO_MATCH_FOUND",
      detail: "No prompt injection found in the image.",
    };
  }

  return { verdict: "NOT_SCREENED", detail: "Model Armor did not report on prompt injection." };
}
