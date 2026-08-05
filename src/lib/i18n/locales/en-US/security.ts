export const security = {
  pageHeader: "Security Scan",
  pageHeaderDesc:
    "SKILL.md files and Skill folders only · 11 security dimensions scanned locally",
  pageDescription:
    "Runs 11-dimension static security checks on SKILL.md entirely on this device.",
  stats: {
    scanned: "Total scans",
    averageDuration: "Avg. duration",
    rulesVersion: "Rules version",
  },
  verdict: {
    all: "All",
    safe: "Safe",
    suspicious: "Suspicious",
    dangerous: "Dangerous",
  },
  severity: {
    high: "High",
    medium: "Medium",
    low: "Low",
  },
  source: {
    builtin: "Built-in rule",
    custom: "User rule",
  },
  phase: {
    idle: "Idle",
    scanning: "Scanning",
    done: "Done",
  },
  scanSteps: {
    read: "Read local SKILL.md",
  },
  rulesNotice:
    "Built-in rules v{version} ship with AITracker updates; there is currently no remote rules update channel, so no network requests are made and no fake update status is shown.",
  dropzone: {
    title: "Drop a SKILL.md or Skill folder to start scanning",
    hint: "SKILL.md / folders containing SKILL.md · max 100 MB per file · parsed locally, source never uploaded",
    tccHint:
      "When picking files from Documents/Downloads/Desktop, macOS asks for one-time access to that file; the app requests no other directory permissions",
    selectFile: "Select SKILL.md",
    selectFolder: "Select folder",
    remaining: "{remaining} / {limit} scans left today",
  },
  scanning: {
    title: "Scanning locally · {progress}%",
  },
  history: {
    title: "Scan history (last 30 days)",
    clear: "Clear history",
    loading: "Loading scan history…",
    empty: "No scans yet.",
    searchPlaceholder: "Search by scan name…",
    showing: "Showing {shown} / {total}",
  },
  report: {
    title: "Security report · {name}",
    viewSource: "View source",
    verdictLabel: "Overall verdict: {verdict}",
    riskScore: "/ 100 risk score",
    riskHits: "{count} hits · {duration}",
    pass: "Pass",
    hits: "{count} hits",
    noRisks: "None of the 11 dimensions matched static risk rules.",
    riskDetails: "Non-passing item details",
    reviewTitle: "Overall review",
    sourceTitle: "Local source: {name}",
    sourceTruncated: "… remaining local content omitted (not uploaded)",
  },
  privacy: {
    statement:
      "The verdict comes only from local static rules; no SKILL.md, code snippets or hit details are uploaded.",
  },
  review: {
    safe: "No risks found by the current static rules; static scanning cannot replace manual review of a Skill's behavior and origin.",
    suspicious:
      "Static risk signals requiring manual confirmation were found; review the flagged lines and their context before installing.",
    dangerous:
      "High-risk static signals were found; do not install or run this Skill until an independent manual review is completed.",
  },
  confirm: {
    deleteReport:
      "Delete the current report and reset the scanner? History will be kept.",
    clearHistory:
      "Clear all scan history from the last 30 days? This cannot be undone.",
  },
  toast: {
    scanDone: "Local scan complete: {verdict}",
    historyCleared: "Scan history cleared",
    noSource:
      "This historical report has no saved source; select a local file to view it again.",
  },
} as const;
