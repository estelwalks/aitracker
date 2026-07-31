import type {
  LocalTokenCounts,
  LocalUsageBreakdown,
  LocalUsageDaily,
  LocalUsageEvent,
  LocalUsageSnapshot,
  LocalUsageSource,
  LocalUsageSourceSummary,
  LocalUsageTotals,
} from "./types.ts";

const RECENT_EVENT_LIMIT = 50;

function emptyTokenCounts(): LocalTokenCounts {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function emptyTotals(): LocalUsageTotals {
  return { events: 0, ...emptyTokenCounts() };
}

function emptySourceCounts(): Record<string, LocalTokenCounts> {
  return {
    "claude-code": emptyTokenCounts(),
    codex: emptyTokenCounts(),
    cursor: emptyTokenCounts(),
    "gemini-cli": emptyTokenCounts(),
    "kimi-code": emptyTokenCounts(),
    opencode: emptyTokenCounts(),
    grok: emptyTokenCounts(),
    "github-copilot": emptyTokenCounts(),
    cline: emptyTokenCounts(),
    "roo-code": emptyTokenCounts(),
  };
}

function addTokenCounts(totals: LocalTokenCounts, event: LocalUsageEvent): void {
  totals.inputTokens += event.inputTokens;
  totals.cachedInputTokens += event.cachedInputTokens;
  totals.cacheCreationInputTokens += event.cacheCreationInputTokens;
  totals.outputTokens += event.outputTokens;
  totals.reasoningOutputTokens += event.reasoningOutputTokens;
  totals.totalTokens += event.totalTokens;
}

function addEvent(totals: LocalUsageTotals, event: LocalUsageEvent): void {
  totals.events += 1;
  addTokenCounts(totals, event);
}

function addToBreakdown(
  breakdown: Map<string, LocalUsageTotals>,
  key: string,
  event: LocalUsageEvent,
): void {
  const totals = breakdown.get(key) ?? emptyTotals();
  addEvent(totals, event);
  breakdown.set(key, totals);
}

function serializeBreakdown(breakdown: Map<string, LocalUsageTotals>): LocalUsageBreakdown[] {
  return [...breakdown.entries()]
    .map(([key, totals]) => ({ key, ...totals }))
    .sort(
      (left, right) => right.totalTokens - left.totalTokens || left.key.localeCompare(right.key),
    );
}

function localDateKey(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function sumTokenCounts(
  counts: Pick<LocalTokenCounts, keyof LocalTokenCounts>[],
): LocalTokenCounts {
  return counts.reduce<LocalTokenCounts>(
    (totals, current) => ({
      inputTokens: totals.inputTokens + current.inputTokens,
      cachedInputTokens: totals.cachedInputTokens + current.cachedInputTokens,
      cacheCreationInputTokens: totals.cacheCreationInputTokens + current.cacheCreationInputTokens,
      outputTokens: totals.outputTokens + current.outputTokens,
      reasoningOutputTokens: totals.reasoningOutputTokens + current.reasoningOutputTokens,
      totalTokens: totals.totalTokens + current.totalTokens,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  );
}

export function buildLocalUsageSnapshot(
  events: LocalUsageEvent[],
  sources: LocalUsageSourceSummary[],
  generatedAt = new Date(),
): LocalUsageSnapshot {
  const sortedEvents = [...events].sort((left, right) =>
    right.timestamp.localeCompare(left.timestamp),
  );
  const totals = emptyTotals();
  const bySource = new Map<string, LocalUsageTotals>();
  const byModel = new Map<string, LocalUsageTotals>();
  const byProject = new Map<string, LocalUsageTotals>();
  const daily = new Map<string, LocalUsageTotals>();
  const dailyBySource = new Map<string, Record<string, LocalTokenCounts>>();

  for (const event of sortedEvents) {
    const date = localDateKey(event.timestamp);
    addEvent(totals, event);
    addToBreakdown(bySource, event.source, event);
    addToBreakdown(byModel, event.model, event);
    addToBreakdown(byProject, event.project, event);
    addToBreakdown(daily, date, event);

    const sourceCounts = dailyBySource.get(date) ?? emptySourceCounts();
    const counts = sourceCounts[event.source] ?? emptyTokenCounts();
    addTokenCounts(counts, event);
    sourceCounts[event.source] = counts;
    dailyBySource.set(date, sourceCounts);
  }

  const dailyRows: LocalUsageDaily[] = [...daily.entries()]
    .map(([date, dayTotals]) => ({
      date,
      ...dayTotals,
      bySource: dailyBySource.get(date) ?? emptySourceCounts(),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    generatedAt: generatedAt.toISOString(),
    mode: sortedEvents.length > 0 ? "real" : "empty",
    sources,
    events: sortedEvents.length,
    totals,
    bySource: serializeBreakdown(bySource),
    byModel: serializeBreakdown(byModel),
    byProject: serializeBreakdown(byProject),
    daily: dailyRows,
    details: sortedEvents,
    recent: sortedEvents.slice(0, RECENT_EVENT_LIMIT),
  };
}
