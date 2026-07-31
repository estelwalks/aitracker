export interface ModelPrice {
  id: string;
  label: string;
  effectiveDate: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number | null;
  tiers?: Array<{
    maxInputTokens: number | null;
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    cacheReadUsdPerMillion: number;
  }>;
  matches: (normalizedModel: string) => boolean;
}

function exactOrSnapshot(...names: string[]) {
  const normalizedNames = names.map((name) =>
    name.toLowerCase().replaceAll("_", "-").replaceAll(".", "-"),
  );
  return (model: string) =>
    normalizedNames.some((name) => model === name || model.startsWith(`${name}-20`));
}

function includesAll(...parts: string[]) {
  return (model: string) => parts.every((part) => model.includes(part));
}

export const MODEL_PRICES: ModelPrice[] = [
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 30,
    cacheReadUsdPerMillion: 0.5,
    cacheWriteUsdPerMillion: null,
    matches: exactOrSnapshot("gpt-5.6-sol"),
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.25,
    cacheWriteUsdPerMillion: null,
    matches: exactOrSnapshot("gpt-5.6-terra"),
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 6,
    cacheReadUsdPerMillion: 0.1,
    cacheWriteUsdPerMillion: null,
    matches: exactOrSnapshot("gpt-5.6-luna"),
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 6.25,
    outputUsdPerMillion: 37.5,
    cacheReadUsdPerMillion: 0.625,
    cacheWriteUsdPerMillion: null,
    matches: exactOrSnapshot("gpt-5.5"),
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.25,
    cacheWriteUsdPerMillion: null,
    matches: exactOrSnapshot("gpt-5.4"),
  },
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1.75,
    outputUsdPerMillion: 14,
    cacheReadUsdPerMillion: 0.175,
    cacheWriteUsdPerMillion: null,
    matches: exactOrSnapshot("gpt-5.2"),
  },
  {
    id: "gpt-5.1-codex",
    label: "GPT-5.1 Codex",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
    cacheReadUsdPerMillion: 0.125,
    cacheWriteUsdPerMillion: null,
    matches: exactOrSnapshot("gpt-5.1-codex"),
  },
  {
    id: "gpt-5-codex",
    label: "GPT-5 Codex",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
    cacheReadUsdPerMillion: 0.125,
    cacheWriteUsdPerMillion: null,
    matches: exactOrSnapshot("gpt-5-codex"),
  },
  {
    id: "claude-opus-4",
    label: "Claude Opus 4",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 15,
    outputUsdPerMillion: 75,
    cacheReadUsdPerMillion: 1.5,
    cacheWriteUsdPerMillion: 18.75,
    matches: includesAll("claude", "opus", "4"),
  },
  {
    id: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.3,
    cacheWriteUsdPerMillion: 3.75,
    matches: includesAll("claude", "sonnet", "4"),
  },
  {
    id: "claude-sonnet-3.7",
    label: "Claude Sonnet 3.7",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.3,
    cacheWriteUsdPerMillion: 3.75,
    matches: includesAll("claude", "3-7", "sonnet"),
  },
  {
    id: "claude-haiku-3.5",
    label: "Claude Haiku 3.5",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 0.8,
    outputUsdPerMillion: 4,
    cacheReadUsdPerMillion: 0.08,
    cacheWriteUsdPerMillion: 1,
    matches: includesAll("claude", "3-5", "haiku"),
  },
];
