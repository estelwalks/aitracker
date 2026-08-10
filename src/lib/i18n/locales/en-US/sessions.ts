export const sessions = {
  metaDescription:
    "Browse local session history and copy a resume command in one click.",
  pageHeader: "Session Recovery",
  pageHeaderDesc:
    "Browse local session history and copy a resume command in one click",
  range: {
    d7: "Last 7 days",
    d30: "Last 30 days",
    d90: "Last 90 days",
  },
  status: {
    all: "All statuses",
    available: "Resumable",
    interrupted: "Interrupted",
    lost: "Marked as lost",
    unavailable: "No command available",
  },
  source: {
    all: "All tools",
  },
  project: {
    all: "All projects",
  },
  panelTitle: "Local Sessions",
  hint: "Only Claude Code, Codex, and Grok are currently supported; costs are estimated from the local model pricing catalog, with unknown prices explicitly marked.",
  searchPlaceholder: "Search title / project / model / sessionId",
  summary: {
    count: "Sessions",
    tokens: "Total Tokens",
    cost: "Total Cost",
    turns: "Total Turns",
  },
  empty: {
    title: "No matching sessions",
    desc: "Adjust the filters or search keywords and try again.",
  },
  refreshing: "Refreshing",
  row: {
    untitled: "(Untitled session)",
    copy: "Copy resume command",
    copied: "Copied",
    copyUnsafe:
      "This session ID is not safe; a resume command cannot be generated",
    project: "Project",
    model: "Model",
    time: "Time",
    duration: "Duration",
    cost: "Cost",
    turns: "Turns",
    edits: "Edits",
    resumeDirHint: "Run the resume command in this directory:",
    statusReason: "Status:",
  },
  toast: {
    refreshed: "Session list refreshed",
    copied: "Resume command copied",
  },
} as const;
