export const insights = {
  title: "Daily Insights",
  rotate: "Rotate",
  dots: "Insights",
  sources: {
    empty: "No source data yet — real insights will appear after a scan.",
    coverage: "{connected} / {total} tools connected, {rate} coverage.",
    events: "{events} events collected, ready for analysis and reports.",
    notInstalled: "{count} tools not installed — visit their sites to connect.",
    noLogs: "{count} tools have no log files, usage cannot be collected.",
    malformed: "{count} malformed lines need review — check log format.",
    allGood: "All {total} tools healthy with no anomalies.",
  },
  tracker: {
    empty: "No usage data yet — real insights will appear after a scan.",
    burn: "{tokens} tokens burned across {events} events.",
    wasteLeader: "Highest waste: {name} · {waste}, worth a look.",
    cacheLow: "Lowest cache hit: {name} · {rate}, consider reusing context.",
    suggestCount: "{count} optimizations suggested — see the leaderboard.",
    topBurn: "Biggest burn: {name} · {tokens} tokens.",
  },
} as const;
