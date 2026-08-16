export const tracker = {
  title: "Burn Leaderboard",
  desc: "Behavioral waste diagnostics: surfaces inefficient spend from real token data with actionable suggestions.",
  metric: {
    tokens: "Total tokens",
    events: "Events",
    entries: "Ranked entries",
  },
  board: {
    skill: "Skill spend",
    project: "Project spend",
    session: "Session spend",
  },
  row: {
    tokens: "{count} tokens",
    events: "{count} events",
    calls: "{count} calls",
    waste: "Waste index",
    cacheRate: "Cache hit {rate}",
    outputRatio: "Output share {ratio}",
    suggest: "Suggestions",
    trendUp: "Up vs prior period",
    trendDown: "Down vs prior period",
    trendFlat: "Flat vs prior period",
    trendNa: "No comparison",
  },
  suggest: {
    cache: "Cache hit rate is low; reuse context to improve cache reuse.",
    output: "Output-token share is high; trim output or enable compression.",
    volume: "Volume is large; review task scale and repeated scans.",
    none: "No obvious optimization opportunity.",
  },
  detail: {
    wasteDetail: "Waste breakdown",
    close: "Close",
  },
  empty: "No data yet",
  emptyDesc: "Once real usage is scanned, the ranked waste board appears here.",
} as const;
