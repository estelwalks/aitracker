import type { MessageKey } from "../../../lib/i18n/schema.ts";
import type {
  InsightActionId,
  InsightCandidate,
  InsightSurfaceId,
} from "./contracts.ts";

type CompleteSurfaceId = Exclude<InsightSurfaceId, "widget">;

const GUIDANCE_FACT_KEYS = {
  dashboard: {
    collection: "insights.page.dashboard.dashboard-guide-collection",
    sessions: "insights.page.dashboard.dashboard-guide-sessions",
    concentration: "insights.page.dashboard.dashboard-guide-concentration",
    cache: "insights.page.dashboard.dashboard-guide-cache",
    distill: "insights.page.dashboard.dashboard-guide-distill",
  },
  agents: {
    coverage: "insights.page.agents.agents-guide-coverage",
    activity: "insights.page.agents.agents-guide-activity",
    prompt: "insights.page.agents.agents-guide-prompt",
    cache: "insights.page.agents.agents-guide-cache",
    security: "insights.page.agents.agents-guide-security",
  },
  distill: {
    intake: "insights.page.distill.distill-guide-intake",
    outputs: "insights.page.distill.distill-guide-outputs",
    quota: "insights.page.distill.distill-guide-quota",
    reuse: "insights.page.distill.distill-guide-reuse",
    start: "insights.page.distill.distill-guide-start",
  },
  reports: {
    inventory: "insights.page.reports.reports-guide-inventory",
    highlights: "insights.page.reports.reports-guide-highlights",
    security: "insights.page.reports.reports-guide-security",
    workflow: "insights.page.reports.reports-guide-workflow",
    next: "insights.page.reports.reports-guide-next",
  },
  memory: {
    inventory: "insights.page.memory.memory-guide-inventory",
    approval: "insights.page.memory.memory-guide-approval",
    hygiene: "insights.page.memory.memory-guide-hygiene",
    types: "insights.page.memory.memory-guide-types",
    distill: "insights.page.memory.memory-guide-distill",
  },
  security: {
    posture: "insights.page.security.security-guide-posture",
    failures: "insights.page.security.security-guide-failures",
    coverage: "insights.page.security.security-guide-coverage",
    recency: "insights.page.security.security-guide-recency",
    scan: "insights.page.security.security-guide-scan",
  },
  tracker: {
    consumption: "insights.page.tracker.tracker-guide-consumption",
    waste: "insights.page.tracker.tracker-guide-waste",
    cache: "insights.page.tracker.tracker-guide-cache",
    concentration: "insights.page.tracker.tracker-guide-concentration",
    optimize: "insights.page.tracker.tracker-guide-optimize",
  },
  skills: {
    inventory: "insights.page.skills.skills-guide-inventory",
    enablement: "insights.page.skills.skills-guide-enablement",
    coverage: "insights.page.skills.skills-guide-coverage",
    updates: "insights.page.skills.skills-guide-updates",
    safety: "insights.page.skills.skills-guide-safety",
  },
  market: {
    installs: "insights.page.market.market-guide-installs",
    updates: "insights.page.market.market-guide-updates",
    cache: "insights.page.market.market-guide-cache",
    review: "insights.page.market.market-guide-review",
    install: "insights.page.market.market-guide-install",
  },
  chats: {
    inventory: "insights.page.chats.chats-guide-inventory",
    sources: "insights.page.chats.chats-guide-sources",
    recovery: "insights.page.chats.chats-guide-recovery",
    activity: "insights.page.chats.chats-guide-activity",
    distill: "insights.page.chats.chats-guide-distill",
  },
  "chat-detail": {
    turns: "insights.page.chat-detail.chat-detail-guide-turns",
    tokens: "insights.page.chat-detail.chat-detail-guide-tokens",
    state: "insights.page.chat-detail.chat-detail-guide-state",
    recovery: "insights.page.chat-detail.chat-detail-guide-recovery",
    distill: "insights.page.chat-detail.chat-detail-guide-distill",
  },
  settings: {
    model: "insights.page.settings.settings-guide-model",
    enhancement: "insights.page.settings.settings-guide-enhancement",
    schedules: "insights.page.settings.settings-guide-schedules",
    retention: "insights.page.settings.settings-guide-retention",
    privacy: "insights.page.settings.settings-guide-privacy",
  },
  sources: {
    inventory: "insights.page.sources.sources-guide-inventory",
    availability: "insights.page.sources.sources-guide-availability",
    logs: "insights.page.sources.sources-guide-logs",
    rescan: "insights.page.sources.sources-guide-rescan",
    privacy: "insights.page.sources.sources-guide-privacy",
  },
} as const satisfies Record<
  CompleteSurfaceId,
  Readonly<Record<string, MessageKey>>
>;

function guidance(
  surface: CompleteSurfaceId,
  id: string,
  factKey: MessageKey,
  actionId: InsightActionId,
): InsightCandidate {
  return {
    id: `${surface}.guide-${id}`,
    severity: "info",
    factKey,
    factParams: {},
    evidenceRefs: [],
    allowedActionIds: [actionId],
    actionId,
  };
}

/**
 * Page-specific boundary and next-step facts used only when aggregate evidence
 * does not yield five distinct remote-safe candidates. They contain no claims
 * that an event happened and no invented measurements.
 */
export const PAGE_SUPPLEMENTAL_CANDIDATES: Record<
  CompleteSurfaceId,
  readonly InsightCandidate[]
> = {
  dashboard: [
    guidance(
      "dashboard",
      "collection",
      GUIDANCE_FACT_KEYS.dashboard.collection,
      "open_sources",
    ),
    guidance(
      "dashboard",
      "sessions",
      GUIDANCE_FACT_KEYS.dashboard.sessions,
      "open_sessions",
    ),
    guidance(
      "dashboard",
      "concentration",
      GUIDANCE_FACT_KEYS.dashboard.concentration,
      "open_tracker",
    ),
    guidance(
      "dashboard",
      "cache",
      GUIDANCE_FACT_KEYS.dashboard.cache,
      "open_tracker",
    ),
    guidance(
      "dashboard",
      "distill",
      GUIDANCE_FACT_KEYS.dashboard.distill,
      "open_distill",
    ),
  ],
  agents: [
    guidance(
      "agents",
      "coverage",
      GUIDANCE_FACT_KEYS.agents.coverage,
      "open_sources",
    ),
    guidance(
      "agents",
      "activity",
      GUIDANCE_FACT_KEYS.agents.activity,
      "open_tracker",
    ),
    guidance(
      "agents",
      "prompt",
      GUIDANCE_FACT_KEYS.agents.prompt,
      "open_tracker",
    ),
    guidance(
      "agents",
      "cache",
      GUIDANCE_FACT_KEYS.agents.cache,
      "open_tracker",
    ),
    guidance(
      "agents",
      "security",
      GUIDANCE_FACT_KEYS.agents.security,
      "open_security",
    ),
  ],
  distill: [
    guidance(
      "distill",
      "intake",
      GUIDANCE_FACT_KEYS.distill.intake,
      "open_sessions",
    ),
    guidance(
      "distill",
      "outputs",
      GUIDANCE_FACT_KEYS.distill.outputs,
      "open_distill",
    ),
    guidance(
      "distill",
      "quota",
      GUIDANCE_FACT_KEYS.distill.quota,
      "open_settings",
    ),
    guidance(
      "distill",
      "reuse",
      GUIDANCE_FACT_KEYS.distill.reuse,
      "open_memory",
    ),
    guidance(
      "distill",
      "start",
      GUIDANCE_FACT_KEYS.distill.start,
      "open_distill",
    ),
  ],
  reports: [
    guidance(
      "reports",
      "inventory",
      GUIDANCE_FACT_KEYS.reports.inventory,
      "open_reports",
    ),
    guidance(
      "reports",
      "highlights",
      GUIDANCE_FACT_KEYS.reports.highlights,
      "open_reports",
    ),
    guidance(
      "reports",
      "security",
      GUIDANCE_FACT_KEYS.reports.security,
      "open_security",
    ),
    guidance(
      "reports",
      "workflow",
      GUIDANCE_FACT_KEYS.reports.workflow,
      "open_reports",
    ),
    guidance(
      "reports",
      "next",
      GUIDANCE_FACT_KEYS.reports.next,
      "open_reports",
    ),
  ],
  memory: [
    guidance(
      "memory",
      "inventory",
      GUIDANCE_FACT_KEYS.memory.inventory,
      "open_memory",
    ),
    guidance(
      "memory",
      "approval",
      GUIDANCE_FACT_KEYS.memory.approval,
      "open_memory",
    ),
    guidance(
      "memory",
      "hygiene",
      GUIDANCE_FACT_KEYS.memory.hygiene,
      "open_memory",
    ),
    guidance("memory", "types", GUIDANCE_FACT_KEYS.memory.types, "open_memory"),
    guidance(
      "memory",
      "distill",
      GUIDANCE_FACT_KEYS.memory.distill,
      "open_distill",
    ),
  ],
  security: [
    guidance(
      "security",
      "posture",
      GUIDANCE_FACT_KEYS.security.posture,
      "open_security",
    ),
    guidance(
      "security",
      "failures",
      GUIDANCE_FACT_KEYS.security.failures,
      "open_security",
    ),
    guidance(
      "security",
      "coverage",
      GUIDANCE_FACT_KEYS.security.coverage,
      "open_security",
    ),
    guidance(
      "security",
      "recency",
      GUIDANCE_FACT_KEYS.security.recency,
      "open_security",
    ),
    guidance(
      "security",
      "scan",
      GUIDANCE_FACT_KEYS.security.scan,
      "open_security",
    ),
  ],
  tracker: [
    guidance(
      "tracker",
      "consumption",
      GUIDANCE_FACT_KEYS.tracker.consumption,
      "open_tracker",
    ),
    guidance(
      "tracker",
      "waste",
      GUIDANCE_FACT_KEYS.tracker.waste,
      "open_tracker",
    ),
    guidance(
      "tracker",
      "cache",
      GUIDANCE_FACT_KEYS.tracker.cache,
      "open_tracker",
    ),
    guidance(
      "tracker",
      "concentration",
      GUIDANCE_FACT_KEYS.tracker.concentration,
      "open_tracker",
    ),
    guidance(
      "tracker",
      "optimize",
      GUIDANCE_FACT_KEYS.tracker.optimize,
      "open_tracker",
    ),
  ],
  skills: [
    guidance(
      "skills",
      "inventory",
      GUIDANCE_FACT_KEYS.skills.inventory,
      "open_skills",
    ),
    guidance(
      "skills",
      "enablement",
      GUIDANCE_FACT_KEYS.skills.enablement,
      "open_skills",
    ),
    guidance(
      "skills",
      "coverage",
      GUIDANCE_FACT_KEYS.skills.coverage,
      "open_skills",
    ),
    guidance(
      "skills",
      "updates",
      GUIDANCE_FACT_KEYS.skills.updates,
      "open_skills",
    ),
    guidance(
      "skills",
      "safety",
      GUIDANCE_FACT_KEYS.skills.safety,
      "open_security",
    ),
  ],
  market: [
    guidance(
      "market",
      "installs",
      GUIDANCE_FACT_KEYS.market.installs,
      "open_market",
    ),
    guidance(
      "market",
      "updates",
      GUIDANCE_FACT_KEYS.market.updates,
      "open_market",
    ),
    guidance("market", "cache", GUIDANCE_FACT_KEYS.market.cache, "open_market"),
    guidance(
      "market",
      "review",
      GUIDANCE_FACT_KEYS.market.review,
      "open_security",
    ),
    guidance(
      "market",
      "install",
      GUIDANCE_FACT_KEYS.market.install,
      "open_market",
    ),
  ],
  chats: [
    guidance(
      "chats",
      "inventory",
      GUIDANCE_FACT_KEYS.chats.inventory,
      "open_sessions",
    ),
    guidance(
      "chats",
      "sources",
      GUIDANCE_FACT_KEYS.chats.sources,
      "open_sources",
    ),
    guidance(
      "chats",
      "recovery",
      GUIDANCE_FACT_KEYS.chats.recovery,
      "open_sessions",
    ),
    guidance(
      "chats",
      "activity",
      GUIDANCE_FACT_KEYS.chats.activity,
      "open_sessions",
    ),
    guidance(
      "chats",
      "distill",
      GUIDANCE_FACT_KEYS.chats.distill,
      "open_distill",
    ),
  ],
  "chat-detail": [
    guidance(
      "chat-detail",
      "turns",
      GUIDANCE_FACT_KEYS["chat-detail"].turns,
      "open_sessions",
    ),
    guidance(
      "chat-detail",
      "tokens",
      GUIDANCE_FACT_KEYS["chat-detail"].tokens,
      "open_tracker",
    ),
    guidance(
      "chat-detail",
      "state",
      GUIDANCE_FACT_KEYS["chat-detail"].state,
      "open_sessions",
    ),
    guidance(
      "chat-detail",
      "recovery",
      GUIDANCE_FACT_KEYS["chat-detail"].recovery,
      "open_sessions",
    ),
    guidance(
      "chat-detail",
      "distill",
      GUIDANCE_FACT_KEYS["chat-detail"].distill,
      "open_distill",
    ),
  ],
  settings: [
    guidance(
      "settings",
      "model",
      GUIDANCE_FACT_KEYS.settings.model,
      "open_settings",
    ),
    guidance(
      "settings",
      "enhancement",
      GUIDANCE_FACT_KEYS.settings.enhancement,
      "open_settings",
    ),
    guidance(
      "settings",
      "schedules",
      GUIDANCE_FACT_KEYS.settings.schedules,
      "open_settings",
    ),
    guidance(
      "settings",
      "retention",
      GUIDANCE_FACT_KEYS.settings.retention,
      "open_settings",
    ),
    guidance(
      "settings",
      "privacy",
      GUIDANCE_FACT_KEYS.settings.privacy,
      "open_settings",
    ),
  ],
  sources: [
    guidance(
      "sources",
      "inventory",
      GUIDANCE_FACT_KEYS.sources.inventory,
      "open_sources",
    ),
    guidance(
      "sources",
      "availability",
      GUIDANCE_FACT_KEYS.sources.availability,
      "open_sources",
    ),
    guidance(
      "sources",
      "logs",
      GUIDANCE_FACT_KEYS.sources.logs,
      "open_sources",
    ),
    guidance(
      "sources",
      "rescan",
      GUIDANCE_FACT_KEYS.sources.rescan,
      "open_sources",
    ),
    guidance(
      "sources",
      "privacy",
      GUIDANCE_FACT_KEYS.sources.privacy,
      "open_sources",
    ),
  ],
};
