import type { RouterSettings, Target, Wire } from "./types.js";

export const DEFAULT_DECISION_MODEL = "typesafe/jev-1.13";
const DEFAULT_CHOICES = ["low", "medium", "high", "xhigh", "max"];
const WIRES = new Set<Wire>(["anthropic-messages", "openai-responses"]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function targetList(raw: unknown): Target[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('"targets" must be an array');
  const seen = new Set<string>();
  return raw.map((value, index) => {
    if (!record(value)) throw new Error(`targets[${index}] must be an object`);
    if (typeof value.providerID !== "string" || !value.providerID.trim()) throw new Error(`targets[${index}].providerID must be a non-empty string`);
    if (typeof value.modelID !== "string" || !value.modelID.trim()) throw new Error(`targets[${index}].modelID must be a non-empty string`);
    const providerID = value.providerID.trim();
    const modelID = value.modelID.trim();
    const wire = value.wire;
    if (typeof wire !== "string" || !WIRES.has(wire as Wire)) throw new Error(`targets[${index}].wire must be anthropic-messages or openai-responses`);
    const key = `${providerID}/${modelID}`;
    if (seen.has(key)) throw new Error(`duplicate target ${key}`);
    seen.add(key);
    const choices = value.choices === undefined ? DEFAULT_CHOICES : value.choices;
    if (!Array.isArray(choices) || !choices.every((item) => typeof item === "string" && item.length > 0)) {
      throw new Error(`targets[${index}].choices must contain at least two effort strings`);
    }
    const uniqueChoices = [...new Set(choices as string[])];
    if (uniqueChoices.length < 2) throw new Error(`targets[${index}].choices must contain at least two distinct effort strings`);
    return { providerID, modelID, key, wire: wire as Wire, choices: uniqueChoices };
  });
}

export function parseSettings(raw: unknown): RouterSettings {
  if (raw === undefined) raw = {};
  if (!record(raw)) throw new Error("plugin options must be an object");
  const enabled = raw.enabled ?? true;
  const model = raw.model ?? DEFAULT_DECISION_MODEL;
  const timeoutMs = raw.timeoutMs ?? 4000;
  const maxContextChars = raw.maxContextChars ?? 12000;
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  if (typeof model !== "string" || model.trim().length === 0) throw new Error("model must be a non-empty OpenRouter model id");
  if (!Number.isInteger(timeoutMs) || (timeoutMs as number) < 100 || (timeoutMs as number) > 60000) throw new Error("timeoutMs must be an integer from 100 to 60000");
  if (!Number.isInteger(maxContextChars) || (maxContextChars as number) < 200 || (maxContextChars as number) > 200000) throw new Error("maxContextChars must be an integer from 200 to 200000");
  return { enabled, model: model.trim(), timeoutMs: timeoutMs as number, maxContextChars: maxContextChars as number, targets: targetList(raw.targets) };
}
