import type { Wire } from "./types.js";

export interface ClassifierContext { requestKind: "user_turn" | "tool_continuation"; transcript: string }
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const excerpt = (text: string) => text.length <= 400 ? text : `${text.slice(0, 400)}…`;

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.filter((part) => isRecord(part) && ["text", "input_text", "output_text"].includes(String(part.type)) && typeof part.text === "string")
    .map((part) => String((part as Record<string, unknown>).text)).join("\n");
}

function renderTail(turns: { label: string; text: string }[], limit: number): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0 && used < limit; i--) {
    const line = `[${turns[i]!.label}] ${turns[i]!.text}`;
    const available = limit - used;
    lines.unshift(line.length <= available ? line : `…${line.slice(line.length - available + 1)}`);
    used += Math.min(line.length, available) + 1;
  }
  return lines.join("\n");
}

export function buildClassifierContext(wire: Wire, payload: Record<string, unknown>, maxChars: number): ClassifierContext {
  const turns: { label: string; text: string }[] = [];
  let requestKind: ClassifierContext["requestKind"] = "user_turn";
  if (wire === "anthropic-messages") {
    for (const message of Array.isArray(payload.messages) ? payload.messages : []) {
      if (!isRecord(message)) continue;
      const blocks = Array.isArray(message.content) ? message.content : [];
      if (message.role === "user") {
        const results = blocks.filter((part) => isRecord(part) && part.type === "tool_result");
        for (const result of results) {
          const text = textOf((result as Record<string, unknown>).content);
          turns.push({ label: "tool_result", text: excerpt(text) });
          requestKind = "tool_continuation";
        }
        const text = textOf(message.content);
        if (text) { turns.push({ label: "user", text }); requestKind = "user_turn"; }
      } else if (message.role === "assistant") {
        const text = textOf(message.content);
        if (text) turns.push({ label: "assistant", text });
        for (const part of blocks) if (isRecord(part) && part.type === "tool_use" && typeof part.name === "string") turns.push({ label: "tool_call", text: part.name });
      }
    }
  } else {
    for (const item of Array.isArray(payload.input) ? payload.input : []) {
      if (!isRecord(item)) continue;
      const type = item.type ?? "message";
      if (type === "message" && item.role === "user") {
        const text = textOf(item.content);
        if (text) { turns.push({ label: "user", text }); requestKind = "user_turn"; }
      } else if (type === "message" && item.role === "assistant") {
        const text = textOf(item.content);
        if (text) turns.push({ label: "assistant", text });
      } else if (["function_call", "custom_tool_call"].includes(String(type)) && typeof item.name === "string") {
        turns.push({ label: "tool_call", text: item.name });
      } else if (["function_call_output", "custom_tool_call_output"].includes(String(type))) {
        turns.push({ label: "tool_result", text: excerpt(textOf(item.output)) });
        requestKind = "tool_continuation";
      }
    }
  }
  return { requestKind, transcript: renderTail(turns, maxChars) };
}
