import type { DashboardV2Snapshot, DashboardV2Event } from "./contracts.ts";

/**
 * Test-only builder: converts a raw event array into a browser-safe
 * DashboardV2Snapshot. Used by the budget verifier against the sanitized
 * performance fixtures. Production code never constructs this from raw events
 * on a query path.
 */
export function createDashboardV2SnapshotFromEvents(
  events: readonly DashboardV2Event[],
): DashboardV2Snapshot {
  const sourceCounts = new Map<string, { events: number; tokens: number }>();
  for (const event of events) {
    const current = sourceCounts.get(event.source) ?? { events: 0, tokens: 0 };
    current.events += 1;
    current.tokens += event.totalTokens;
    sourceCounts.set(event.source, current);
  }
  const tools = [...sourceCounts.entries()].map(([id, usage]) => ({
    id,
    name: id,
    available: true,
    detected: true,
    usageSupport: "native" as const,
    ...usage,
  }));
  return {
    generatedAt: "2026-07-01T00:00:00.000Z",
    mode: "real",
    events: events.map((event) => ({
      ...event,
      context: event.context ?? {
        textResponses: 0,
        toolCalls: 0,
        tools: [],
        skillCalls: 0,
        toolOutputCalls: 0,
      },
      evidence: event.evidence ?? {
        textResponses: false,
        toolCalls: false,
        skillCalls: false,
        toolOutputCalls: false,
        reasoningTokens: false,
        systemPromptTokens: false,
      },
    })),
    tools,
    skills: { available: true, count: 0, generatedAt: null },
    sessions: {
      available: true,
      generatedAt: "2026-07-01T00:00:00.000Z",
      byProjectDay: [],
      bySourceDay: [],
    },
    pricingAvailable: false,
    outputAvailability: {
      securityRuns: { count: null, available: false },
      distillationOutputs: { count: null, available: false },
      distillationBreakdown: { capability: null, memory: null },
      dailyReports: { count: null, available: false },
      weeklyReports: { count: null, available: false },
      monthlyReports: { count: null, available: false },
    },
  };
}
