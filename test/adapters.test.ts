import { describe, expect, it } from "vitest";
import { prepareAnthropic, prepareResponses } from "../src/adapters.js";
import type { Target } from "../src/types.js";

const anthropic: Target = { providerID: "anthropic", modelID: "claude-x", key: "anthropic/claude-x", wire: "anthropic-messages", choices: ["low", "medium", "high"] };
const responses: Target = { providerID: "openai", modelID: "gpt-x", key: "openai/gpt-x", wire: "openai-responses", choices: ["low", "medium", "high"] };
const emptyLineage = { efforts: new Map<string, string>() };

describe("cache-preserving wire adapters", () => {
  it("keeps Anthropic top-level effort stable and appends selected effort-only message", () => {
    const payload = { model: "claude-x", thinking: { type: "adaptive" }, output_config: { effort: "high" }, messages: [{ role: "user", content: "hello" }] };
    const prepared = prepareAnthropic(payload, anthropic, emptyLineage)!;
    const applied = prepared.apply("low");
    expect((applied.payload.output_config as { effort: string }).effort).toBe("high");
    expect(applied.payload.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "system", content: [], output_config: { effort: "low" } },
    ]);
    expect(applied.payload.betas).toContain("mid-conversation-output-config-2026-07-01");
    expect(applied.entries[0]).toMatchObject({ kind: "baseline", effort: "high" });
    expect(applied.entries[1]).toMatchObject({ kind: "effort", effort: "low" });
  });

  it("pins Responses effort and inserts configuration updates without changing prior input", () => {
    const payload = { model: "gpt-x", reasoning: { effort: "high" }, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] };
    const prepared = prepareResponses(payload, responses, emptyLineage)!;
    const applied = prepared.apply("low");
    expect((applied.payload.reasoning as { effort: string }).effort).toBe("high");
    expect(applied.payload.input).toEqual([
      { type: "configuration_update", reasoning: { effort: "low" } },
      ...payload.input,
    ]);
    expect(applied.entries).toHaveLength(2);
  });

  it("leaves unsupported Responses delta requests untouched", () => {
    const payload = { reasoning: { effort: "high" }, previous_response_id: "resp_123", input: [] };
    expect(prepareResponses(payload, responses, emptyLineage)).toBeUndefined();
  });
});
