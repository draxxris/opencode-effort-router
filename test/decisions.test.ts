import { describe, expect, it } from "vitest";
import { askDecision, buildDecisionBody, parseDecisionResponse } from "../src/decisions.js";

describe("OpenRouter Decisions API contract", () => {
  const choices = ["low", "medium", "high"];
  it("sends the configured decision model and returns only an allowed effort", async () => {
    const body = buildDecisionBody({
      apiKey: "test-key", model: "inception/mercury-decide", choices,
      context: { requestKind: "user_turn", transcript: "[user] Fix the failing test" },
      timeoutMs: 1000,
    });
    expect(body.model).toBe("inception/mercury-decide");
    expect(parseDecisionResponse({ answers: { reasoning_effort: { choice: "medium" } } }, choices)).toEqual({ ok: true, effort: "medium" });
    expect(parseDecisionResponse({ answers: { reasoning_effort: { choice: "unexpected" } } }, choices)).toEqual({ ok: false, reason: "invalid_choice" });
  });

  it("fails closed on malformed probability responses instead of choosing arbitrarily", () => {
    expect(parseDecisionResponse({ answers: { reasoning_effort: { probabilities: { other: 1 } } } }, choices)).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("uses the endpoint contract and authorization header without exposing response text", async () => {
    let sent: RequestInit | undefined;
    const result = await askDecision({
      apiKey: "test-key", model: "typesafe/jev-1.13", choices,
      context: { requestKind: "tool_continuation", transcript: "[tool_result] done" }, timeoutMs: 1000,
      fetchImpl: async (input, init) => {
        expect(input).toBe("https://openrouter.ai/api/alpha/decisions");
        sent = init;
        return new Response(JSON.stringify({ answers: { reasoning_effort: { selected: "high" } } }), { status: 200 });
      },
    });
    expect(new Headers(sent?.headers).get("authorization")).toBe("Bearer test-key");
    expect(result).toEqual({ ok: true, effort: "high" });
  });
});
