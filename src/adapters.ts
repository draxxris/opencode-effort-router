import { prefixHashes } from "./lineage.js";
import type { LineageData, LineageState, Target, Wire } from "./types.js";

type Obj = Record<string, unknown>;
const isRecord = (x: unknown): x is Obj => x !== null && typeof x === "object" && !Array.isArray(x);
const valid = (value: unknown, target: Target): value is string => typeof value === "string" && target.choices.includes(value);

export interface PreparedRequest {
  effectiveEffort: string;
  recordedEffort?: string;
  apply(effort: string): { payload: Obj; entries: LineageData[] };
}

export function isEffortMessage(value: unknown): value is Obj & { output_config: { effort: string } } {
  return isRecord(value) && value.role === "system" && Array.isArray(value.content) && value.content.length === 0 &&
    isRecord(value.output_config) && typeof value.output_config.effort === "string";
}

function normalizeAnthropicMessage(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const copy = { ...value };
  if (typeof copy.content === "string") copy.content = [{ type: "text", text: copy.content }];
  return stripCacheControl(copy);
}

function stripCacheControl(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCacheControl);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "cache_control").map(([key, item]) => [key, stripCacheControl(item)]));
}

function effortMessage(effort: string): Obj { return { role: "system", content: [], output_config: { effort } }; }
function mergeBeta(value: unknown): string[] | undefined {
  if (value === undefined) return ["mid-conversation-output-config-2026-07-01"];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value.includes("mid-conversation-output-config-2026-07-01") ? [...value] : [...value, "mid-conversation-output-config-2026-07-01"];
}

export function prepareAnthropic(payload: Obj, target: Target, lineage: LineageState): PreparedRequest | undefined {
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) return undefined;
  const betas = mergeBeta(payload.betas);
  if (!betas) return undefined;
  const messages = payload.messages as unknown[];
  const base = messages.filter((message) => !isEffortMessage(message));
  const hashes = prefixHashes(base, normalizeAnthropicMessage);
  const trailing = isEffortMessage(messages.at(-1)) ? messages.at(-1) as Obj & { output_config: { effort: string } } : undefined;
  const history = trailing ? messages.slice(0, -1) : messages;
  const top = isRecord(payload.output_config) && typeof payload.output_config.effort === "string" ? payload.output_config.effort : undefined;
  let pinned: string | undefined;
  if (!trailing) {
    if (!isRecord(payload.thinking) || payload.thinking.type !== "adaptive" || !valid(top, target)) return undefined;
    pinned = valid(lineage.baseline, target) ? lineage.baseline : top;
  }
  const effective = valid(trailing?.output_config.effort ?? top, target) ? trailing?.output_config.effort ?? top! : target.choices.includes("high") ? "high" : target.choices[0]!;
  const head: unknown[] = [];
  let seen = 0;
  for (const message of history) {
    if (isEffortMessage(message)) {
      const candidateEffort = lineage.efforts.get(hashes[seen]!);
      const recorded = valid(candidateEffort, target) ? candidateEffort : undefined;
      head.push(recorded && recorded !== message.output_config.effort ? { ...message, output_config: { ...message.output_config, effort: recorded } } : message);
      continue;
    }
    const candidateEffort = lineage.efforts.get(hashes[seen]!);
    const recorded = valid(candidateEffort, target) ? candidateEffort : undefined;
    if (recorded && !isEffortMessage(head.at(-1))) head.push(effortMessage(recorded));
    head.push(message);
    seen++;
  }
  const boundary = hashes[seen]!;
  const candidateHere = lineage.efforts.get(boundary);
  const recordedHere = valid(candidateHere, target) ? candidateHere : undefined;
  return {
    effectiveEffort: effective,
    recordedEffort: recordedHere,
    apply(effort) {
      const entries: LineageData[] = [];
      if (pinned !== undefined && lineage.baseline !== pinned) entries.push({ v: 1, kind: "baseline", model: target.key, effort: pinned });
      if (recordedHere !== effort) entries.push({ v: 1, kind: "effort", model: target.key, boundary, effort });
      const last = trailing ? { ...trailing, output_config: { ...trailing.output_config, effort } } : effortMessage(effort);
      const next: Obj = { ...payload, messages: [...head, last], betas };
      if (pinned !== undefined) next.output_config = { ...(payload.output_config as Obj), effort: pinned };
      return { payload: next, entries };
    },
  };
}

function isUserMessage(item: unknown): boolean {
  return isRecord(item) && (item.type === undefined || item.type === "message") && item.role === "user";
}

export function configurationUpdate(effort: string): Obj { return { type: "configuration_update", reasoning: { effort } }; }
export function responseUpdateBoundary(input: readonly unknown[]): number { return input.length > 0 && isUserMessage(input.at(-1)) ? input.length - 1 : input.length; }

export function prepareResponses(payload: Obj, target: Target, lineage: LineageState): PreparedRequest | undefined {
  if (!Array.isArray(payload.input) || !isRecord(payload.reasoning) || !valid(payload.reasoning.effort, target)) return undefined;
  if (payload.truncation !== undefined && payload.truncation !== "disabled") return undefined;
  if (payload.context_management !== undefined || payload.previous_response_id !== undefined) return undefined;
  const input = payload.input as unknown[];
  if (input.some((item) => isRecord(item) && item.type === "configuration_update")) return undefined;
  const reasoning = payload.reasoning;
  const baseline = valid(lineage.baseline, target) ? lineage.baseline! : reasoning.effort as string;
  const hashes = prefixHashes(input);
  const boundaryIndex = responseUpdateBoundary(input);
  const head: unknown[] = [];
  let effective = baseline;
  for (let i = 0; i < boundaryIndex; i++) {
    const recorded = lineage.efforts.get(hashes[i]!);
    if (valid(recorded, target) && recorded !== effective) { head.push(configurationUpdate(recorded)); effective = recorded; }
    head.push(input[i]);
  }
  const boundary = hashes[boundaryIndex]!;
  const recorded = lineage.efforts.get(boundary);
  return {
    effectiveEffort: effective,
    recordedEffort: valid(recorded, target) ? recorded : undefined,
    apply(effort) {
      const entries: LineageData[] = [];
      if (lineage.baseline !== baseline) entries.push({ v: 1, kind: "baseline", model: target.key, effort: baseline });
      if (recorded !== effort) entries.push({ v: 1, kind: "effort", model: target.key, boundary, effort });
      const out = [...head];
      if (effort !== effective) out.push(configurationUpdate(effort));
      out.push(...input.slice(boundaryIndex));
      return { payload: { ...payload, input: out, reasoning: { ...reasoning, effort: baseline } }, entries };
    },
  };
}

export function prepareRequest(wire: Wire, payload: Obj, target: Target, lineage: LineageState): PreparedRequest | undefined {
  return wire === "anthropic-messages" ? prepareAnthropic(payload, target, lineage) : prepareResponses(payload, target, lineage);
}
