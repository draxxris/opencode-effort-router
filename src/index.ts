import { Plugin } from "@opencode/plugin";
import { buildClassifierContext } from "./context.js";
import { parseSettings } from "./config.js";
import { askDecision } from "./decisions.js";
import { prepareRequest } from "./adapters.js";
import { appendEntries, readLineage } from "./lineage.js";
import type { LineageData, Target } from "./types.js";

const LINEAGE_KEY = (sessionID: string) => `session:${sessionID}:lineage`;
const SESSION_KEY = (sessionID: string) => `session:${sessionID}:enabled`;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function sessionCommand(name: string, description: string, execute: (sessionID: string, args: string) => Promise<void>) {
  return { name, description, execute: (input: { sessionID: string; prompt: { text?: string } }) => execute(input.sessionID, input.prompt.text ?? "") };
}

export default Plugin.define({
  id: "opencode-effort-router",
  async setup(ctx) {
    const settings = parseSettings(ctx.options);
    const configuredKey = typeof ctx.options.apiKey === "string" ? ctx.options.apiKey : undefined;
    const registrations: { dispose: () => Promise<void> }[] = [];

    registrations.push(await ctx.command.transform((editor) => {
      editor.add(sessionCommand("effort-router", "Enable or disable per-session reasoning effort routing", async (sessionID, raw) => {
        const action = raw.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "";
        if (action === "on") await ctx.storage.set(SESSION_KEY(sessionID), true);
        else if (action === "off") await ctx.storage.set(SESSION_KEY(sessionID), false);
        else if (action === "status") {
          // The v2 server command contract has no output channel. Status is available
          // through the command's persisted state and the next routed request.
          await ctx.storage.get(SESSION_KEY(sessionID));
        }
      }));
    }));

    if (!settings.enabled) return async () => { await Promise.all(registrations.map((registration) => registration.dispose())); };

    registrations.push(await ctx.session.hook("http.request", async (event) => {
      if (event.kind !== "primary") return;
      const target = settings.targets.find((item) => item.providerID === event.model.providerID && item.modelID === event.model.id);
      if (!target) return;
      if (await ctx.storage.get(SESSION_KEY(event.sessionID)) === false) return;

      let payload: unknown;
      try { payload = await event.request.clone().json(); } catch { return; }
      if (!isRecord(payload)) return;
      if (target.wire === "anthropic-messages") {
        const betaHeader = event.request.headers.get("anthropic-beta");
        if (betaHeader) payload.betas = betaHeader.split(",").map((value) => value.trim()).filter(Boolean);
      }

      const stored = await ctx.storage.get(LINEAGE_KEY(event.sessionID));
      const lineage = readLineage(stored, target.key);
      const prepared = prepareRequest(target.wire, payload, target, lineage);
      if (!prepared) return;

      let effort = prepared.recordedEffort;
      if (effort === undefined) {
        const apiKey = configuredKey || process.env.OPENROUTER_API_KEY;
        if (apiKey) {
          const result = await askDecision({
            apiKey,
            model: settings.model,
            choices: target.choices,
            context: buildClassifierContext(target.wire, payload, settings.maxContextChars),
            currentEffort: prepared.effectiveEffort,
            timeoutMs: settings.timeoutMs,
            signal: event.request.signal,
          });
          if (result.ok) effort = result.effort;
        }
        // Keep the most recent valid branch effort on failures, otherwise keep the
        // effort already present in the provider request.
        if (effort === undefined) {
          effort = lineage.lastEffort && target.choices.includes(lineage.lastEffort)
            ? lineage.lastEffort
            : prepared.effectiveEffort;
        }
      }

      const applied = prepared.apply(effort);
      if (applied.entries.length > 0) {
        const next = appendEntries(stored, target.key, applied.entries);
        await ctx.storage.set(LINEAGE_KEY(event.sessionID), next as unknown as import("effect/Schema").Json);
      }
      if (applied.entries.length === 0 && !prepared.recordedEffort) return;
      const headers = new Headers(event.request.headers);
      headers.delete("content-length");
      if (target.wire === "anthropic-messages" && Array.isArray(applied.payload.betas)) {
        headers.set("anthropic-beta", applied.payload.betas.join(","));
        delete applied.payload.betas;
      }
      event.request = new Request(event.request, { headers, body: JSON.stringify(applied.payload) });
    }));

    return async () => { await Promise.all(registrations.map((registration) => registration.dispose())); };
  },
});

export { parseSettings } from "./config.js";
export { askDecision, buildDecisionBody, parseDecisionResponse } from "./decisions.js";
export { prepareAnthropic, prepareResponses, prepareRequest, configurationUpdate, responseUpdateBoundary } from "./adapters.js";
export { buildClassifierContext } from "./context.js";
export type { RouterSettings, Target, Wire } from "./types.js";
