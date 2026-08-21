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
      "dashboard-guide-collection":
        "Confirm collection is current so the dashboard is not distorted by data gaps.",
      "dashboard-guide-sessions":
        "Session activity shows whether today's work is ready to review or continue.",
      "dashboard-guide-concentration":
        "When usage is concentrated, check whether the primary tool is carrying the right work.",
      "dashboard-guide-cache":
        "Cache efficiency shows whether context is being reused; use the tracker to investigate.",
      "dashboard-guide-distill":
        "Distill reusable sessions so today's result becomes a lasting asset.",
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
      "agents-guide-coverage":
        "Tool coverage determines whether the Agent overview is complete; connect missing local tools first.",
      "agents-guide-activity":
        "Activity and session volume separate actively used Agents from installed-only ones.",
      "agents-guide-prompt":
        "Keep stable rules separate from temporary tasks to reduce repeated prompt context.",
      "agents-guide-cache":
        "Cache structure reveals whether an Agent repeatedly reads the same context.",
      "agents-guide-security":
        "Review Agent permissions together with Skill risk as capability expands exposure.",
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
        "Choose complete, reusable sessions first as distillation material.",
      "distill-guide-outputs":
        "Match the output to reuse: workflows for procedures and Skills for stable capabilities.",
      "distill-guide-quota":
        "Confirm the model and quota before generation so a job does not stop midway.",
      "distill-guide-reuse":
        "Approved outputs should enter knowledge or memory for later reuse.",
      "distill-guide-start":
        "When there are no candidates, start with a session that has a clear conclusion.",
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
        "The report archive shows which periods are complete and which still need review.",
      "reports-guide-highlights":
        "Lead with outcomes and key changes, then add detail for a clearer report.",
      "reports-guide-security":
        "List security events separately so general usage conclusions do not hide them.",
      "reports-guide-workflow":
        "Draft, edit, save, and export form the full report workflow; confirm conclusions before saving.",
      "reports-guide-next":
        "If this period has no report, start from the nearest period with session activity.",
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
        "Keep memory assets searchable and traceable so important rules do not stay buried in sessions.",
      "memory-guide-approval":
        "Approve before publishing to keep unconfirmed content out of long-term context.",
      "memory-guide-hygiene":
        "Remove stale or risky memory to reduce repeated reuse of incorrect context.",
      "memory-guide-types":
        "Use profiles for durable preferences and task memory for specific constraints.",
      "memory-guide-distill":
        "If memory is empty, distill one confirmed lesson from the workbench.",
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
        "Handle high-risk findings first; volume must not dilute severity.",
      "security-guide-failures":
        "A failed scan is a coverage blind spot, not evidence that no risk exists.",
      "security-guide-coverage":
        "Coverage should include enabled Skills and configuration; scan anything omitted.",
      "security-guide-recency":
        "Old scans describe the past; scan again after installs or updates.",
      "security-guide-scan":
        "If no result exists, run a local static scan to establish a baseline.",
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
      "tracker-guide-consumption":
        "Compare total consumption with event activity before attributing a change.",
      "tracker-guide-waste":
        "Prioritize repeated reads, rework, and excessive output when diagnosing waste.",
      "tracker-guide-cache":
        "Low cache reuse often means stable context is being read repeatedly.",
      "tracker-guide-concentration":
        "Concentrated model or project usage merits a dedicated task and prompt review.",
      "tracker-guide-optimize":
        "Recheck the same time range after optimization to verify the change worked.",
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
        "Inventory local Skills and their origins to avoid duplicate capabilities.",
      "skills-guide-enablement":
        "Enable only needed Skills to reduce irrelevant Agent exposure.",
      "skills-guide-coverage":
        "Inconsistent Agent coverage can produce different results for the same task.",
      "skills-guide-updates":
        "Review changes before syncing pending updates across Agents.",
      "skills-guide-safety":
        "Scan new or changed Skills again; old safety results do not cover new versions.",
    },
    market: {
      "market-installed": "{count} marketplace components installed.",
      "market-updates": "{count} components have updates — upgrade soon.",
      "market-scan-first":
        "Run a security scan before installing new components.",
      "market-review":
        "Review SKILL.md and version history before installing to avoid dead packages.",
      "market-guide-installs":
        "Use local install state to separate owned capabilities from candidates and avoid duplicates.",
      "market-guide-updates":
        "Review version changes before replacing a component already in use.",
      "market-guide-cache":
        "A cached catalog remains browsable offline, but may not be current.",
      "market-guide-review":
        "Marketplace listing is only a candidate; review content and security before install.",
      "market-guide-install":
        "With nothing installed, start from a clearly scoped and reviewed entry.",
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
        "The session list exposes safe metadata for locating work before opening details.",
      "chats-guide-sources":
        "Filter by source to find active Agents or collection gaps quickly.",
      "chats-guide-recovery":
        "Confirm recovery state before continuing, archiving, or distilling a session.",
      "chats-guide-activity":
        "Turn and token activity help identify sessions worth reviewing further.",
      "chats-guide-distill":
        "If no sessions appear, check data sources; distill only after a clear outcome exists.",
    },
    "chat-detail": {
      "chat-detail-turns":
        "This session has {count} turns; metadata fully collected.",
      "chat-detail-tokens": "This session burned {tokens} tokens.",
      "chat-detail-recoverable":
        "This session can be recovered or distilled — start from the detail page.",
      "chat-detail-resume":
        "This session can be resumed to continue context — the resume command carries the project path.",
      "chat-detail-guide-turns":
        "Turn count shows depth of progress, not the quality of the conclusion.",
      "chat-detail-guide-tokens":
        "Token activity shows context scale and helps spot unexpected growth.",
      "chat-detail-guide-state":
        "Judge session status together with metadata freshness before acting.",
      "chat-detail-guide-recovery":
        "Only sessions meeting recovery conditions should be resumed; keep others read-only.",
      "chat-detail-guide-distill":
        "When the conclusion is reusable, start distillation from metadata without exposing transcript content.",
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
        "Enhanced analysis requires both a usable model profile and valid credentials.",
      "settings-guide-enhancement":
        "The enhancement switch controls model rewriting; local rule insights always remain available.",
      "settings-guide-schedules":
        "Enable scheduled jobs only as needed to avoid duplicate collection or scans.",
      "settings-guide-retention":
        "Retention controls local history; confirm what still needs traceability before changing it.",
      "settings-guide-privacy":
        "Configuration and business data stay local; review scope before clearing data.",
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
      "sources-guide-inventory":
        "Detection confirms a tool is known, not that it has produced analyzable logs.",
      "sources-guide-availability":
        "Installed, has logs, and has usable events are separate source states.",
      "sources-guide-logs":
        "Sources without logs cannot produce usage insights; confirm real tool activity first.",
      "sources-guide-rescan":
        "Rescan after directory or install changes to refresh collection boundaries.",
      "sources-guide-privacy":
        "The source page shows aggregate status and errors, never transcript text or local paths.",
    },
  },
} as const;
