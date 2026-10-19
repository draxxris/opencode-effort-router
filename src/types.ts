export type Wire = "anthropic-messages" | "openai-responses";

export interface Target {
  providerID: string;
  modelID: string;
  key: string;
  wire: Wire;
  choices: string[];
}

export interface RouterSettings {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  maxContextChars: number;
  targets: Target[];
}

export interface LineageData {
  v: 1;
  kind: "baseline" | "effort";
  model: string;
  effort: string;
  boundary?: string;
}

export interface LineageState {
  baseline?: string;
  efforts: Map<string, string>;
  lastEffort?: string;
}
