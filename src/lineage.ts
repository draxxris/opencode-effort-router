import { createHash } from "node:crypto";
import type { LineageData, LineageState } from "./types.js";

export function prefixHashes(items: readonly unknown[], normalize: (item: unknown) => unknown = (x) => x): string[] {
  const hashes: string[] = [];
  let previous = createHash("sha256").update("effort-router/v1").digest("hex");
  hashes.push(previous.slice(0, 32));
  for (const item of items) {
    previous = createHash("sha256").update(previous).update(JSON.stringify(normalize(item)) ?? "undefined").digest("hex");
    hashes.push(previous.slice(0, 32));
  }
  return hashes;
}

export function readLineage(raw: unknown, model: string): LineageState {
  const state: LineageState = { efforts: new Map() };
  if (!Array.isArray(raw)) return state;
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const item = entry as Partial<LineageData>;
    if (item.v !== 1 || item.model !== model || typeof item.effort !== "string") continue;
    if (item.kind === "baseline") state.baseline ??= item.effort;
    if (item.kind === "effort" && typeof item.boundary === "string") {
      state.efforts.set(item.boundary, item.effort);
      state.lastEffort = item.effort;
    }
  }
  return state;
}

export function appendEntries(raw: unknown, model: string, entries: LineageData[]): LineageData[] {
  const prior = Array.isArray(raw) ? raw.filter((entry) => {
    return entry !== null && typeof entry === "object" && (entry as { model?: unknown }).model !== model;
  }) : [];
  return [...prior, ...entries].slice(-500);
}
