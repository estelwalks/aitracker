export const market = {
  pageHeader: "Skill Market",
  pageHeaderDesc: "Only Skills that passed security scanning are listed",
  strip: {
    subtitle:
      "Only Skills that passed security scanning · one-click install to local agents",
  },
  meta: {
    description:
      "Browse the real {appName} Skill Market index — only Skills that passed security scanning are included.",
  },
  notProvided: "Not provided",
  jarvis: {
    available:
      "The market currently offers {total} Skills, {official} of which are official releases.",
    installed: "{count} market Skills installed on this machine.",
  },
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
    totalSkills: "Total Skills",
    officialCount: "Official",
    passRate: "Security passed",
    passRatePage: "This page pass rate",
    installedCount: "Installed",
    totalDownloads: "Total downloads",
    hintCurrentPage: "Current page stats",
    hintLocalInstalled: "Installed on this machine",
    hintOfficial: "Maintained by the official team",
    hintDomains: "{count} categories",
    hintDownloads: "Total downloads {count}",
  },
  search: {
    placeholder: "Search skill name, source path, or capability",
    keyword: " · keyword “{keyword}”",
    updatedAt: "Data updated {time}",
    perPage: "{count} per page · page {page}",
  },
  sort: {
    hot: "Popular",
    latest: "Latest",
    rating: "Top rated",
    tokens: "Token usage",
    nameAsc: "A-Z",
    nameDesc: "Z-A",
    downloads: "Downloads",
  },
  list: {
    title: "Skill list ({count})",
    count: "{count} Skills total",
    allSafe: "All passed security scanning",
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
  domainAll: "All",
  card: {
    detail: "Details",
    publisher: "Publisher",
    installedAgents: "Installed in {count} tools",
  },
  noDescription: "This Skill has no description yet.",
  detail: {
    repo: "Source repository",
    sourcePath: "Source path",
    tokens: "Context tokens",
    securityPass: "Security scan passed · safe to install",
    infoTitle: "Install info",
    lastScanned: "Last scanned",
  },
  metric: {
    downloads: "Downloads",
    tokenUsage: "Token usage",
    size: "Size",
    stars: "Star",
  },
  security: {
    score: "Security score {score}",
    scoreMissing: "Security score not provided",
    safe: "Safe",
    attention: "Review",
  },
  install: {
    button: "Install",
    expandAll: "Show all {count}",
    expandMore: "{count} more",
    toSelected: "Install to selected tool",
    target: "Install target",
    notDetected: "Not detected",
    succeeded: "Install succeeded",
    failed: "Install failed",
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
    range: "Items {start}–{end} of {total}",
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
