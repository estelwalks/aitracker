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
  actions: {
    security: "Review security",
    distill: "Distill",
    reports: "View reports",
    sessions: "View sessions",
    sources: "Data sources",
    settings: "Model settings",
    tracker: "View burn leaderboard",
    market: "Marketplace",
    skills: "Skills",
    memory: "Memory",
  },
  page: {
    dashboard: {
      "dashboard-watch":
        "{agents} agents on duty today, {blocked} risks blocked, ~{hours} hours saved, and {distillable} sessions ready to distill.",
      "dashboard-assets":
        "Agent “{name}” carried {rate} of usage; the rest are lightly used — consider balancing.",
      "dashboard-usage":
        "Collected {events} usage events across {sessions} sessions today; open Sessions to review or distill.",
      "dashboard-security-safe":
        "No security risks found today; every scanned item passed.",
      "dashboard-security-risk":
        "{count} security risks need attention today — review the security page.",
      "dashboard-efficiency":
        "“{name}” cache hit rate is only {rate}; reuse context to cut cost.",
      "dashboard-empty":
        "No session data collected yet — connect a local Agent in Data sources.",
    },
    agents: {
      "agents-overview":
        "{count} agents on duty, {blocked} risks blocked today, ~{hours} hours saved.",
      "agents-focus-prompt":
        "“{name}” has high prompt repetition — extract shared instructions to cut tokens.",
      "agents-focus-cache":
        "“{name}” cache hit rate is only {rate}; enable context reuse.",
      "agents-focus-security":
        "“{name}” had {count} risky actions recently — review its permissions.",
      "agents-prompt-guide":
        "Writing more specific prompts cuts repeated reads and rework, saving tokens.",
    },
    distill: {
      "distill-ready":
        "{count} sessions are ready to distill — archive them as experience.",
      "distill-pending":
        "{count} distillations await approval — confirm or reject.",
      "distill-quota": "Distill quota is {rate} used; watch daily call volume.",
      "distill-empty": "No sessions to distill today.",
      "distill-focus":
        "More focused material means better distillation — pick 3–8 strong, related conversations instead of importing everything.",
      "distill-repeat":
        "Lots of repeated Q&A can be fixed into one Skill to save tokens.",
    },
    reports: {
      "reports-highlights":
        "Lead agent this period is “{name}”, contributing {rate} of usage.",
      "reports-security":
        "{count} security events need review — add them to the report.",
      "reports-latest":
        "Latest report generated at {time}; data up to the current scan.",
      "reports-empty": "No data for this period.",
      "reports-collab":
        "AI drafts, you refine, then save — reports only need your confirmation, not writing from scratch.",
      "reports-next":
        "Add a “next steps” line to the report — it is auto-referenced when summarizing.",
    },
    memory: {
      "memory-total":
        "{count} memories stored — {profiles} profiles, {tasks} tasks.",
      "memory-auto":
        "Auto-settle writes distilled experience to memory automatically.",
      "memory-empty":
        "Memory is empty — distill sessions to settle experience.",
      "memory-kinds":
        "Profiles remember who you are and how you like to work; task memory remembers the rules we set.",
    },
    security: {
      "security-risk-top":
        "{count} high-severity findings detected — handle them now.",
      "security-scan-gap":
        "{count} sources were not covered by this scan; cannot claim safety yet.",
      "security-scan-coverage":
        "Scan covered {rate} of sources — close the rest soon.",
      "security-last-scan":
        "Last full scan completed at {time}; results are indicative.",
      "security-scan-first":
        "Scan new skills before enabling — a few seconds blocks most poisoned scripts.",
      "security-history":
        "Scan history is archived — compare versions to pinpoint which update introduced a risk.",
    },
    tracker: {
      "tracker-burn-leader": "Biggest burn: “{name}”, {tokens} tokens total.",
      "tracker-waste-leader": "Highest waste: “{name}” · {rate}, worth a look.",
      "tracker-cache-low":
        "Lowest cache hit: “{name}” · {rate}, reuse context.",
      "tracker-suggest":
        "{count} optimizations suggested — see the leaderboard.",
      "tracker-top-model":
        "“{name}” consumed the most tokens — lighter tasks can run on a smaller model.",
      "tracker-top-project":
        "By project, “{name}” accounts for the most usage — tune its prompt templates first.",
      "tracker-empty": "No obvious waste right now.",
    },
    skills: {
      "skills-local": "{count} local skills available.",
      "skills-enabled": "{count} enabled; enable the rest as needed.",
      "skills-unscanned":
        "{count} skills unscanned — scan for safety before enabling.",
      "skills-sync":
        "A Skill installed on only some agents causes inconsistent results — one-click sync fixes it.",
      "skills-specific":
        "The more specific a Skill, the less the model drifts — saving tokens.",
    },
    market: {
      "market-installed": "{count} marketplace components installed.",
      "market-updates": "{count} components have updates — upgrade soon.",
      "market-scan-first":
        "Run a security scan before installing new components.",
      "market-review":
        "Review SKILL.md and version history before installing to avoid dead packages.",
    },
    chats: {
      "chats-total": "{count} sessions collected.",
      "chats-top-source": "Top session source is “{name}” — watch its usage.",
      "chats-recoverable": "{count} sessions recoverable — archive or distill.",
      "chats-empty": "No sessions yet — connect a data source to see them.",
      "chats-resume":
        "Resume commands carry the project path — paste into a terminal to return to the working directory.",
      "chats-distill":
        "Send reusable sessions to the distillation bench — turning them into Skills beats digging through history.",
    },
    "chat-detail": {
      "chat-detail-turns":
        "This session has {count} turns; metadata fully collected.",
      "chat-detail-tokens": "This session burned {tokens} tokens.",
      "chat-detail-recoverable":
        "This session can be recovered or distilled — start from the detail page.",
      "chat-detail-resume":
        "This session can be resumed to continue context — the resume command carries the project path.",
    },
    widget: {
      "widget-broadcast-security": "Security today: {count} risks to handle.",
      "widget-broadcast-efficiency":
        "Efficiency today: “{name}” has the lowest cache hit at {rate}.",
      "widget-broadcast-distill": "Distill today: {count} sessions ready.",
    },
    settings: {
      "settings-model-unconfigured":
        "No model configured yet — complete setup in Model settings to enable enhanced insights.",
      "settings-scan-plan": "Scan plan covers {count} sources — adjust here.",
      "settings-collection":
        "Collection completeness is {rate} — troubleshoot gaps here.",
      "settings-local":
        "Collection is fully local — conversation content is never uploaded; adjust scope in data sources.",
    },
    sources: {
      "sources-connected": "{count} data sources connected.",
      "sources-malformed":
        "{count} malformed lines need review — check log format.",
      "sources-not-installed":
        "{count} tools not installed — download and connect.",
      "sources-all-good": "All {count} sources healthy with no anomalies.",
      "sources-rescan":
        "Re-scan after tool directories change, or session and skill collection will have gaps.",
      "sources-local":
        "All collection happens locally — your conversation content is never uploaded.",
    },
  },
} as const;
