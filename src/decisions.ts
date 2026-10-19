import type { ClassifierContext } from "./context.js";

export const DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const CRITERIA: Record<string, string> = {
  low: "Trivial or mechanical step: short answer, simple lookup, routine tool follow-up.",
  medium: "Ordinary task needing some reasoning but no deep analysis.",
  high: "Non-trivial work: multi-step coding, debugging, or careful analysis.",
  xhigh: "Hard problem: subtle bugs, complex design, or long multi-file reasoning.",
  max: "Exceptionally hard problem where maximum deliberation is clearly worth the cost.",
};

export type DecisionResult = { ok: true; effort: string } | { ok: false; reason: "timeout" | "aborted" | "http_error" | "network_error" | "invalid_response" | "invalid_choice" };
export interface DecisionRequest {
  apiKey: string;
  model: string;
  choices: readonly string[];
  context: ClassifierContext;
  currentEffort?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export function buildDecisionBody(input: DecisionRequest): Record<string, unknown> {
  const criteria = Object.fromEntries(input.choices.map((choice) => [choice, CRITERIA[choice] ?? choice]));
  return {
    model: input.model,
    questions: { reasoning_effort: {
      type: "choice",
      instructions: "How much reasoning effort should a coding agent spend on its next response to this conversation? Prefer the lowest effort that will still produce a correct, complete result.",
      criteria,
    } },
    state: { request_kind: input.context.requestKind, current_effort: input.currentEffort ?? "unknown", conversation: input.context.transcript },
  };
}

export function parseDecisionResponse(body: unknown, choices: readonly string[]): DecisionResult {
  if (!body || typeof body !== "object") return { ok: false, reason: "invalid_response" };
  const answers = (body as Record<string, unknown>).answers;
  if (!answers || typeof answers !== "object") return { ok: false, reason: "invalid_response" };
  const answer = (answers as Record<string, unknown>).reasoning_effort;
  if (!answer || typeof answer !== "object") return { ok: false, reason: "invalid_response" };
  const data = answer as Record<string, unknown>;
  let selected = typeof data.choice === "string" ? data.choice : typeof data.selected === "string" ? data.selected : undefined;
  if (!selected && data.probabilities && typeof data.probabilities === "object") {
    const probabilities = data.probabilities as Record<string, unknown>;
    let maximum = -Infinity;
    for (const choice of choices) {
      const probability = probabilities[choice];
      if (typeof probability === "number" && probability > maximum) {
        maximum = probability;
        selected = choice;
      }
    }
  }
  if (!selected) return { ok: false, reason: "invalid_response" };
  return choices.includes(selected) ? { ok: true, effort: selected } : { ok: false, reason: "invalid_choice" };
}

export async function askDecision(input: DecisionRequest): Promise<DecisionResult> {
  if (input.signal?.aborted) return { ok: false, reason: "aborted" };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, input.timeoutMs);
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await (input.fetchImpl ?? fetch)(DECISIONS_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(buildDecisionBody(input)),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: "http_error" };
    try { return parseDecisionResponse(await response.json(), input.choices); }
    catch { return { ok: false, reason: "invalid_response" }; }
  } catch {
    return { ok: false, reason: timedOut ? "timeout" : controller.signal.aborted ? "aborted" : "network_error" };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
  }
}
