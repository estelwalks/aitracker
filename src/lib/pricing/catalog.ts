import { matchModel, type ModelMatcher } from "../tool-registry/contracts.ts";

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
  /**
   * Declarative matcher (data, not a function). Replaces the former `matches()`
   * closure so pricing rules are auditable and can live in tool configs. Use
   * `matchModel(price.match, normalizedModel)` to evaluate.
   */
  match: ModelMatcher;
}

/** Whether a declarative price rule matches an already-normalized model. */
export function priceMatches(
  price: ModelPrice,
  normalizedModel: string,
): boolean {
  return matchModel(price.match, normalizedModel);
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
    match: { kind: "exactOrSnapshot", names: ["gpt-5.6-sol"] },
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.25,
    cacheWriteUsdPerMillion: null,
    match: { kind: "exactOrSnapshot", names: ["gpt-5.6-terra"] },
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 6,
    cacheReadUsdPerMillion: 0.1,
    cacheWriteUsdPerMillion: null,
    match: { kind: "exactOrSnapshot", names: ["gpt-5.6-luna"] },
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 6.25,
    outputUsdPerMillion: 37.5,
    cacheReadUsdPerMillion: 0.625,
    cacheWriteUsdPerMillion: null,
    match: { kind: "exactOrSnapshot", names: ["gpt-5.5"] },
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.25,
    cacheWriteUsdPerMillion: null,
    match: { kind: "exactOrSnapshot", names: ["gpt-5.4"] },
  },
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1.75,
    outputUsdPerMillion: 14,
    cacheReadUsdPerMillion: 0.175,
    cacheWriteUsdPerMillion: null,
    match: { kind: "exactOrSnapshot", names: ["gpt-5.2"] },
  },
  {
    id: "gpt-5.1-codex",
    label: "GPT-5.1 Codex",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
    cacheReadUsdPerMillion: 0.125,
    cacheWriteUsdPerMillion: null,
    match: { kind: "exactOrSnapshot", names: ["gpt-5.1-codex"] },
  },
  {
    id: "gpt-5-codex",
    label: "GPT-5 Codex",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
    cacheReadUsdPerMillion: 0.125,
    cacheWriteUsdPerMillion: null,
    match: { kind: "exactOrSnapshot", names: ["gpt-5-codex"] },
  },
  {
    id: "claude-opus-4",
    label: "Claude Opus 4",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 15,
    outputUsdPerMillion: 75,
    cacheReadUsdPerMillion: 1.5,
    cacheWriteUsdPerMillion: 18.75,
    match: { kind: "includesAll", parts: ["claude", "opus", "4"] },
  },
  {
    id: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.3,
    cacheWriteUsdPerMillion: 3.75,
    match: { kind: "includesAll", parts: ["claude", "sonnet", "4"] },
  },
  {
    id: "claude-sonnet-3.7",
    label: "Claude Sonnet 3.7",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.3,
    cacheWriteUsdPerMillion: 3.75,
    match: { kind: "includesAll", parts: ["claude", "3-7", "sonnet"] },
  },
  {
    id: "claude-haiku-3.5",
    label: "Claude Haiku 3.5",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 0.8,
    outputUsdPerMillion: 4,
    cacheReadUsdPerMillion: 0.08,
    cacheWriteUsdPerMillion: 1,
    match: { kind: "includesAll", parts: ["claude", "3-5", "haiku"] },
  },
];
