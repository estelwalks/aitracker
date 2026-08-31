import { getUsageTaxonomy } from "../tool-registry/registry.ts";
import type {
  LocalUsageCommandDurationBucket,
  LocalUsageEvent,
} from "./types.ts";
import {
  buildContextBreakdown,
  type LocalUsageContextBreakdownRow,
} from "./context-breakdown.ts";

/**
 * Model-level behavioral intent distribution (behavior bar for the Model Details drawer).
 *
 * Clean-room compliance: The input is only the desensitized tool/skill/command aggregation + token count,
 * No conversation text is read. Classification is purely heuristic, based on categories of buildContextBreakdown
 * Line proportion and commands signature prefix.
 */

export interface ModelBehavior {
  /** Behavior labels (Chinese). */
  label: string;
  /** The Token proportion of this behavior in the total number of events (0–1). */
  tokenShare: number;
  /** The proportion of this behavior in the number of events (0–1). */
  eventShare: number;
}

// Debug-command hints (P4-T3): moved to _shared/usage-taxonomy.json; the
// inline list is a null-safe fallback only.
const DEBUG_COMMAND_HINTS = getUsageTaxonomy()?.debugCommandHints ?? [
  "diff",
  "grep",
  "log",
  "status",
  "test",
  "lint",
];

function isDebugCommand(row: LocalUsageContextBreakdownRow): boolean {
  return DEBUG_COMMAND_HINTS.some((hint) => row.key.includes(hint));
}

/**
 * Classify several events of a model into behavioral distributions.
 *
 * Priority determination (by event one by one): debugging command > execution code changes > browser/research >
 * agent sub-agent > planning planning > plain text question and answer. Each event only counts towards one main action,
 * tokenShare/eventShare is normalized by event weight and token amount.
 */
export function classifyModelBehaviors(
  events: LocalUsageEvent[],
): ModelBehavior[] {
  if (events.length === 0) return [];

  const buckets = new Map<string, { tokens: number; events: number }>();
  const bump = (label: string, tokens: number) => {
    const bucket = buckets.get(label) ?? { tokens: 0, events: 0 };
    bucket.tokens += tokens;
    bucket.events += 1;
    buckets.set(label, bucket);
  };

  let totalTokens = 0;
  for (const event of events) {
    totalTokens += event.totalTokens;
    const breakdown = buildContextBreakdown([event]);
    const categoryRow = (cat: string) =>
      breakdown.categories.find((row) => row.key === cat);
    const commandRows = breakdown.commands;

    if (commandRows.some(isDebugCommand)) {
      bump("调试", event.totalTokens);
    } else if ((categoryRow("execution")?.totalTokens ?? 0) > 0) {
      bump("代码生成/重构", event.totalTokens);
    } else if ((categoryRow("browser")?.totalTokens ?? 0) > 0) {
      bump("工具调用/研究", event.totalTokens);
    } else if ((categoryRow("agent")?.totalTokens ?? 0) > 0) {
      bump("子智能体", event.totalTokens);
    } else if ((categoryRow("planning")?.totalTokens ?? 0) > 0) {
      bump("规划", event.totalTokens);
    } else {
      bump("对话/问答", event.totalTokens);
    }
  }

  const eventCount = events.length;
  return [...buckets.entries()]
    .map(([label, stat]) => ({
      label,
      tokenShare: totalTokens > 0 ? stat.tokens / totalTokens : 0,
      eventShare: eventCount > 0 ? stat.events / eventCount : 0,
    }))
    .sort((a, b) => b.tokenShare - a.tokenShare);
}

/**
 * Calculate the "Typical command time" label from the collected command time into buckets.
 *
 * The data source is Codex's context.commands[].duration bucketing (under-1s / 1s-10s /
 * 10s-60s/over-60s/unknown). Sources without context return null, and the front end displays "—".
 * No new log parsing is introduced; only desensitized aggregations are reused.
 */
export function typicalCommandLatency(
  events: LocalUsageEvent[],
): string | null {
  const order: LocalUsageCommandDurationBucket[] = [
    "under-1s",
    "1s-10s",
    "10s-60s",
    "over-60s",
  ];
  const labelOf: Record<string, string> = {
    "under-1s": "< 1s",
    "1s-10s": "1–10s",
    "10s-60s": "10–60s",
    "over-60s": "> 60s",
  };
  const counts = new Map<LocalUsageCommandDurationBucket, number>();
  for (const event of events) {
    for (const command of event.context?.commands ?? []) {
      if (command.calls <= 0) continue;
      counts.set(
        command.duration,
        (counts.get(command.duration) ?? 0) + command.calls,
      );
    }
  }
  let best: LocalUsageCommandDurationBucket | null = null;
  let bestCount = 0;
  for (const bucket of order) {
    const count = counts.get(bucket) ?? 0;
    if (count > bestCount) {
      best = bucket;
      bestCount = count;
    }
  }
  return best == null ? null : (labelOf[best] ?? null);
}
