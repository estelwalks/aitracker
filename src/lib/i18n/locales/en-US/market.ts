export const market = {
  pageHeader: "Skill Market",
  pageHeaderDesc: "Only Skills that passed security scanning are listed",
  meta: {
    description:
      "Browse the real TrustTools Skill Market index — only Skills that passed security scanning are included.",
  },
  notProvided: "Not provided",
  network: {
    loadFailed: "Network unavailable: failed to load the Skill Market",
    unavailableTitle:
      "Network unavailable — the Skill Market is temporarily inaccessible",
    unavailableDesc:
      "The locally cached list is still browsable; it will auto-sync with the latest data once the network recovers.",
  },
  empty: {
    noMatch: "No matching Skills",
    noMatchDesc: "Try a different keyword.",
  },
  stats: {
    totalSkills: "Total Skills listed",
    officialCount: "Official releases",
    passRate: "Security pass rate",
    installedCount: "Installed",
    totalDownloads: "Total downloads",
    hintCurrentPage: "Current page stats",
    hintLocalInstalled: "Installed on this machine",
  },
  search: {
    placeholder: "Search real Skills by name or description…",
    keyword: " · keyword “{keyword}”",
    updatedAt: "Data updated {time}",
    perPage: "{count} per page · page {page}",
  },
  sort: {
    downloads: "Downloads",
    latest: "Latest",
    stars: "Star",
    tokens: "Token usage",
  },
  list: {
    title: "Skill list ({count})",
  },
  table: {
    rank: "Rank",
    publisher: "Publisher",
    downloads: "Downloads",
    tokenUsage: "Token usage",
    size: "Size",
    stars: "Star",
    security: "Security status",
    actions: "Actions",
  },
  installed: "Installed",
  official: "Official",
  noDescription: "This Skill has no description yet.",
  metric: {
    downloads: "Downloads",
    tokenUsage: "Token usage",
    size: "Size",
    stars: "Star",
  },
  security: {
    score: "Security score {score}",
    scoreMissing: "Security score not provided",
  },
  install: {
    button: "Install",
    toSelected: "Install to selected tool",
    success: "Installed to {agent}",
    downloading: "Downloading and scanning…",
    failure: {
      scanBlocked:
        "Static scanning found high-risk rules; installation was blocked.",
      noAgent: "Please select an install target",
      diskFull: "Insufficient disk space. Clean up and retry",
      download: "Download failed. Check your network and retry",
      generic: "Download or static scan failed",
    },
  },
  drawer: {
    viewRepo: "View source repository",
    viewSource: "View source",
    securityNotice:
      "Security scan passed · no malicious URLs, dangerous commands, or sensitive information detected",
    commandExample: "Example install command",
    contextTokens: "Context tokens",
    lastUpdated: "Last updated",
    permissionClaim: "Permission claims",
    networkClaim: "Network claims",
    selectAgent:
      "Select install target (single-select, {count} tools supported)",
    agentNotInstalled: "Not installed",
  },
  pagination: {
    prev: "Previous",
    next: "Next",
  },
  outcome: {
    compressed: "Archive {size}",
    unpacked: "Unpacked {size}",
    entries: "Entries checked {count}",
    files: "Files scanned {count}",
    success: "Succeeded",
    failed: "Failed",
  },
} as const;
