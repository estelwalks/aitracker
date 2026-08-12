export const sessions = {
  metaDescription:
    "Browse local session history and safely resume available sessions.",
  pageHeader: "Session Management",
  pageHeaderDesc:
    "Browse local sessions by time, tool, and project, then safely resume available sessions.",
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
  detail: {
    back: "Back to sessions",
    title: "Session details",
    safeSummary:
      "Only a sanitized session summary is shown. Paths, commands, and conversation content are never displayed.",
    activity: "Session activity",
    startedAt: "Started",
    endedAt: "Ended",
    duration: "Active duration",
    subagents: "Subagent calls",
  },
  action: {
    open: "View details",
    resume: "Resume session",
    resuming: "Resuming",
    resumeAccepted: "Local recovery request started",
    resumeUnavailable: "Unavailable",
  },
  pagination: {
    previous: "Previous",
    next: "Next",
    summary: "Page {page} / {totalPages} · {total} sessions",
  },
  row: {
    untitled: "(Untitled session)",
    copy: "Resume session",
    copied: "Started",
    copyUnsafe: "This session ID is not safe and cannot be resumed",
    project: "Project",
    model: "Model",
    time: "Time",
    duration: "Duration",
    cost: "Cost",
    turns: "Turns",
    edits: "Edits",
    resumeDirHint:
      "Recovery runs through a controlled local service; no command or directory is exposed to the browser.",
    statusReason: "Status:",
  },
  toast: {
    refreshed: "Session list refreshed",
    copied: "Local recovery request started",
  },
} as const;
