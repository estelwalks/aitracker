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
        "The current snapshot contains {skills} Skill assets and {knowledge} knowledge assets.",
      "dashboard-assets":
        "The highest-usage Agent, “{name}”, accounts for {rate} of total tokens.",
      "dashboard-usage":
        "Collected {events} usage events in the current range.",
      "dashboard-security-safe":
        "No security risks found today; every scanned item passed.",
      "dashboard-security-risk":
        "{count} security risks need attention today — review the security page.",
      "dashboard-efficiency":
        "“{name}” cache hit rate is only {rate}; reuse context to cut cost.",
      "dashboard-empty":
        "No session data collected yet — connect a local Agent in Data sources.",
      "dashboard-guide-collection":
        "The current range consumed {tokens} tokens.",
      "dashboard-guide-sessions":
        "The current range contains {count} AI sessions.",
      "dashboard-guide-concentration":
        "Each usage event consumed {average} tokens on average.",
      "dashboard-guide-cache":
        "The current range contains {events} usage events.",
      "dashboard-guide-distill":
        "{count} Agents produced measurable usage events.",
    },
    agents: {
      "agents-overview":
        "Detected {count} existing Agents: {active} with usage events and {inactive} without events.",
      "agents-focus-prompt":
        "“{name}” has high prompt repetition — extract shared instructions to cut tokens.",
      "agents-focus-cache":
        "“{name}” cache hit rate is only {rate}; enable context reuse.",
      "agents-focus-security":
        "Local data is currently readable for {available} existing Agents.",
      "agents-prompt-guide":
        "The highest-usage existing Agent, “{name}”, accounts for {rate} of total tokens.",
      "agents-guide-coverage":
        "Detected {count} Agents that are installed, readable, or have usage events.",
      "agents-guide-activity":
        "Existing Agents have {count} recorded sessions.",
      "agents-guide-prompt":
        "Existing Agents produced {events} usage events and {tokens} tokens.",
      "agents-guide-cache":
        "Local data is currently readable for {available} Agents.",
      "agents-guide-security": "{count} existing Agents produced usage events.",
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
      "distill-guide-intake":
        "Today's distillation ledger has used {used} of {limit} calls.",
      "distill-guide-outputs":
        "The distillation workbench currently contains {count} knowledge assets.",
      "distill-guide-quota": "{count} distillation calls remain today.",
      "distill-guide-reuse":
        "{count} distillation results are awaiting approval.",
      "distill-guide-start":
        "The distillation candidate queue currently contains {count} items.",
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
      "reports-guide-inventory":
        "The report library currently contains {total} reports.",
      "reports-guide-highlights":
        "It contains {daily} daily reports and {weekly} weekly reports.",
      "reports-guide-security": "{count} reports are currently drafts.",
      "reports-guide-workflow": "{count} reports are approved.",
      "reports-guide-next": "{count} reports are archived.",
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
      "memory-guide-inventory":
        "The memory library currently contains {count} assets.",
      "memory-guide-approval":
        "{approved} memory assets are approved or published.",
      "memory-guide-hygiene":
        "{unsafe} memory assets are marked suspicious or dangerous.",
      "memory-guide-types":
        "{pending} memory assets are not yet approved or published.",
      "memory-guide-distill":
        "{safe} memory assets are not marked with a security risk.",
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
      "security-guide-posture":
        "The latest security summary records {risky} suspicious or dangerous assets.",
      "security-guide-failures":
        "The latest scan failed to assess {failed} assets.",
      "security-guide-coverage":
        "The latest scan discovered {discovered} assets and assessed {assessed}.",
      "security-guide-recency":
        "The latest security summary was generated at {time}.",
      "security-guide-scan": "{clean} assets passed the latest scan.",
    },
    tracker: {
      "tracker-burn-leader": "Biggest burn: “{name}”, {tokens} tokens total.",
      "tracker-waste-leader": "Highest waste: “{name}” · {rate}, worth a look.",
      "tracker-cache-low":
        "Lowest cache hit: “{name}” · {rate}, reuse context.",
      "tracker-suggest":
        "{count} optimizations suggested — see the leaderboard.",
      "tracker-top-model":
        "“{name}” consumed the most tokens in the current range.",
      "tracker-top-project":
        "“{name}” is the highest-token project in the current range.",
      "tracker-empty": "No obvious waste right now.",
      "tracker-guide-consumption":
        "{events} events consumed {tokens} tokens in the current range.",
      "tracker-guide-waste": "“{name}” has the highest waste index at {rate}.",
      "tracker-guide-cache": "{count} sources expose verifiable cache fields.",
      "tracker-guide-concentration":
        "The highest-token source, “{name}”, accounts for {rate} of total tokens.",
      "tracker-guide-optimize":
        "Each usage event consumed {average} tokens on average.",
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
      "skills-guide-inventory":
        "The local Skill snapshot contains {count} Skills.",
      "skills-guide-enablement":
        "{enabled} Skills are installed on at least one Agent.",
      "skills-guide-coverage": "{agents} installed Agents were detected.",
      "skills-guide-updates":
        "{outdated} Skill installations have an available update.",
      "skills-guide-safety":
        "{unassigned} Skills are not installed on any Agent.",
    },
    market: {
      "market-installed": "{count} marketplace components installed.",
      "market-updates": "{count} components have updates — upgrade soon.",
      "market-scan-first":
        "Run a security scan before installing new components.",
      "market-review":
        "Review SKILL.md and version history before installing to avoid dead packages.",
      "market-guide-installs":
        "{installed} marketplace Skills are currently installed.",
      "market-guide-updates":
        "{updates} marketplace Skills have an available update.",
      "market-guide-cache":
        "The local marketplace cache contains {total} browsable entries.",
      "market-guide-review":
        "{current} installed marketplace Skills currently have no pending update.",
      "market-guide-install":
        "The marketplace cache was fetched about {hours} hours ago.",
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
      "chats-guide-inventory":
        "The session snapshot currently contains {count} sessions.",
      "chats-guide-sources": "These sessions come from {count} Agent sources.",
      "chats-guide-recovery": "{count} sessions are currently recoverable.",
      "chats-guide-activity":
        "All sessions total {turns} turns and {tokens} tokens.",
      "chats-guide-distill":
        "All sessions total about {minutes} active minutes.",
    },
    "chat-detail": {
      "chat-detail-turns":
        "This session has {count} turns; metadata fully collected.",
      "chat-detail-tokens": "This session burned {tokens} tokens.",
      "chat-detail-recoverable":
        "This session can be recovered or distilled — start from the detail page.",
      "chat-detail-resume":
        "This session can be resumed to continue context — the resume command carries the project path.",
      "chat-detail-guide-turns": "This session records {count} retry turns.",
      "chat-detail-guide-tokens":
        "This session records {count} subagent calls.",
      "chat-detail-guide-state":
        "This session comes from “{source}” and has local status “{status}”.",
      "chat-detail-guide-recovery":
        "This session has {count} turns containing edit operations.",
      "chat-detail-guide-distill":
        "This session totals about {minutes} active minutes.",
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
      "settings-guide-model":
        "{profiles} model profiles are saved; {ready} have configured credentials.",
      "settings-guide-enhancement": "{total} background jobs are registered.",
      "settings-guide-schedules": "{enabled} background jobs are enabled.",
      "settings-guide-retention": "{disabled} background jobs are disabled.",
      "settings-guide-privacy":
        "{ready} model profiles currently have usable credential configuration.",
    },
    sources: {
      "sources-connected": "{count} data sources connected.",
      "sources-malformed":
        "{count} malformed lines need review — check log format.",
      "sources-not-installed":
        "{count} detected sources currently have no analyzable events.",
      "sources-all-good": "All {count} sources healthy with no anomalies.",
      "sources-rescan":
        "Re-scan after tool directories change, or session and skill collection will have gaps.",
      "sources-local":
        "All collection happens locally — your conversation content is never uploaded.",
      "sources-guide-inventory":
        "The source snapshot contains {total} registry sources.",
      "sources-guide-availability":
        "Local data is currently readable for {available} sources.",
      "sources-guide-logs":
        "{connected} sources have produced analyzable events.",
      "sources-guide-rescan":
        "The source snapshot records {malformed} malformed lines.",
      "sources-guide-privacy":
        "The installation snapshot detects {installed} installed tools.",
    },
  },
} as const;
