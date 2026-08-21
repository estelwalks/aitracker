/**
 * Versioned prompt registry for the Insight Enhancer: one entry per surface
 * (14 total). `system` is the shared safety policy; `policy` tailors tone and
 * candidate priority per surface. The registry is complete by construction —
 * `POLICIES` is typed as `Record<InsightSurfaceId, string>`, so a missing
 * surface fails to compile rather than to serve.
 */
import { APP_NAME } from "../../../lib/app-config.ts";
import {
  INSIGHT_SURFACE_IDS,
  type InsightSurfaceId,
} from "../page/contracts.ts";
import {
  INSIGHT_ACTION_IDS,
  MAX_ANALYSIS_CHARS,
  MIN_LINES,
  MAX_LINES,
  WIDGET_MAX_LINES,
} from "./validation.ts";

export const INSIGHT_PROMPT_VERSION = 3;
export const INSIGHT_OUTPUT_SCHEMA_VERSION = 3;
export const INSIGHT_ALLOWED_LOCALES = [
  "zh-CN",
  "en-US",
  "ja-JP",
  "ko-KR",
] as const;

export interface InsightPrompt {
  readonly id: `insight.${InsightSurfaceId}`;
  readonly version: 3;
  readonly surfaceId: InsightSurfaceId;
  readonly maxLines: number;
  readonly maxAnalysisChars: number;
  readonly allowedLocales: readonly string[];
  readonly outputSchemaVersion: 3;
  readonly system: string;
  readonly policy: string;
}

const SHARED_SYSTEM = [
  `You are the ${APP_NAME} daily-insight analyst. The supplied fact is already shown to the user; your analysis must add decision-useful meaning instead of rewriting it.`,
  "Hard rules — violating any one invalidates the whole response:",
  "1. Use only the supplied candidate facts. Never invent a cause, trend, comparison, availability state, collection state, or recommendation that the facts do not establish.",
  "2. Do not repeat, paraphrase, summarize, or merely strengthen the candidate fact. Analysis must add a concrete implication, priority, trade-off, or action rationale that is directly supported by that same fact.",
  "3. Treat unknown, unavailable, unobserved, or missing values as unknown. Never convert them to zero, none, low, healthy, or risky.",
  "4. Never tell the user to confirm collection is running, prevent collection gaps, install or connect missing tools, maximize coverage, or perform generic optimization. Do not recommend work the user cannot verify from this page.",
  "5. Keep each surface within its stated responsibility. Do not repeat diagnostics owned by another surface, even when a candidate sounds related.",
  "6. Never echo numbers, counts, percentages, URLs, absolute file paths, command names, or entity names (projects, sessions, skills, tools, people).",
  "7. Never add a new action or navigation target; only reuse an action id listed for that exact candidate.",
  "8. Every mandatory candidate must receive exactly one line — never drop it.",
  "9. Respond with a single JSON object only: no markdown, no prose, no code fences. Answer in the request locale.",
  "10. Never soften a risk: keep or raise the severity implied by each fact.",
].join("\n");

const POLICIES: Record<InsightSurfaceId, string> = {
  dashboard:
    "Responsibility: cross-domain executive summary of observed aggregate security, usage, sessions, and source concentration. Cover distinct dimensions, but exclude agent-level cache diagnostics, source-collection troubleshooting, setup guidance, and details owned by specialist pages.",
  agents:
    "Responsibility: summarize only already-detected agents and tools—their activity, sessions, prompt behavior, and agent-specific security. Cover distinct dimensions; never recommend installing, connecting, or completing coverage for missing tools.",
  distill:
    "Responsibility: analyze observed distillation backlog, output, quota, and reuse. Cover distinct dimensions without inventing materials, naming outputs, or filling an empty state with generic workflow advice.",
  reports:
    "Responsibility: analyze observed report inventory, types, status, and recency. Cover distinct dimensions without inventing highlights, collaboration activity, security review, or a next-report recommendation not present in facts.",
  memory:
    "Responsibility: analyze observed memory inventory, approval/publishing state, types, and safety status. Cover distinct dimensions; never name an item or invent automatic aggregation and empty-state guidance.",
  security:
    "Responsibility: analyze observed scan risk, failures, coverage, and recency. Cover distinct dimensions, NEVER downplay severity, and lead with the most dangerous supported item; do not invent scan gaps or ask for a scan unless a fact supports it.",
  tracker:
    "Responsibility: analyze observed token consumption, waste, cache efficiency, and model/project concentration. Cover distinct dimensions; discuss cache only when the fact says it is observable and never treat missing telemetry as zero.",
  skills:
    "Responsibility: analyze the observed local Skill inventory, enablement, current Agent use, updates, and safety. Cover distinct dimensions without naming a Skill or recommending installation merely to increase coverage.",
  market:
    "Responsibility: analyze observed marketplace catalog availability, installed items, and updates. Cover distinct dimensions without naming a package, inventing security review, or recommending installation for completeness.",
  chats:
    "Responsibility: analyze observed session inventory, source distribution, activity, and recoverability. Cover distinct dimensions without naming sessions/participants or inventing recovery and distillation work.",
  "chat-detail":
    "Responsibility: analyze only the current session's observed turns, token activity, duration/status, and recoverability. Cover distinct dimensions, stay neutral, never name the session, and do not invent recovery or distillation actions.",
  widget:
    "Exactly ONE line only: the single most important action. Be extremely brief.",
  settings:
    "Responsibility: summarize observed configuration state for model readiness, insight mode, schedules, retention, and privacy. Cover distinct dimensions without claiming runtime health or asking the user to verify collection.",
  sources:
    "Responsibility: analyze observed source detection, usable data, missing logs/installations, malformed input, and scan results. Cover distinct dimensions without naming a source or asking the user to confirm background collection.",
};

export function getInsightPrompt(surfaceId: InsightSurfaceId): InsightPrompt {
  return {
    id: `insight.${surfaceId}`,
    version: INSIGHT_PROMPT_VERSION,
    surfaceId,
    maxLines: surfaceId === "widget" ? WIDGET_MAX_LINES : MAX_LINES,
    maxAnalysisChars: MAX_ANALYSIS_CHARS,
    allowedLocales: [...INSIGHT_ALLOWED_LOCALES],
    outputSchemaVersion: INSIGHT_OUTPUT_SCHEMA_VERSION,
    system: SHARED_SYSTEM,
    policy: POLICIES[surfaceId],
  };
}

/** Full provider prompt (the `PromptVersion.template`) for one surface. */
export function buildInsightPromptTemplate(entry: InsightPrompt): string {
  const actionIds = INSIGHT_ACTION_IDS.join(", ");
  return [
    entry.system,
    "",
    `Surface policy (${entry.surfaceId}): ${entry.policy}`,
    "",
    "Output exactly one JSON object with this shape:",
    '{"lines":[{"candidateId":"<provided id>","analysis":"<one sentence, max ' +
      `${entry.maxAnalysisChars} chars, no digits/urls/paths/commands/names>` +
      '","actionId":"<optional, one of: ' +
      actionIds +
      '>"}]}',
    entry.surfaceId === "widget"
      ? "Output exactly one line. Every mandatory candidate must appear; omit actionId when no action is appropriate."
      : `When at least ${MIN_LINES} candidates are provided, output ${MIN_LINES}-${entry.maxLines} lines covering different policy dimensions. When fewer are provided, output every candidate. Every mandatory candidate must appear; omit actionId when no action is appropriate.`,
  ].join("\n");
}

/**
 * Build-time / test assertion: all 14 surfaces covered, ids unique, versions
 * legal, and per-surface limits consistent. Throws on any violation.
 */
export function assertPromptRegistryComplete(): void {
  const seenIds = new Set<string>();
  for (const surface of INSIGHT_SURFACE_IDS) {
    const entry = getInsightPrompt(surface);
    if (entry.id !== `insight.${surface}`) {
      throw new Error(`prompt id mismatch for surface "${surface}"`);
    }
    if (entry.surfaceId !== surface) {
      throw new Error(`prompt surfaceId mismatch for surface "${surface}"`);
    }
    if (!Number.isInteger(entry.version) || entry.version < 1) {
      throw new Error(`prompt version invalid for surface "${surface}"`);
    }
    if (seenIds.has(entry.id)) {
      throw new Error(`duplicate prompt id "${entry.id}"`);
    }
    seenIds.add(entry.id);
    if (
      entry.maxLines !== (surface === "widget" ? WIDGET_MAX_LINES : MAX_LINES)
    ) {
      throw new Error(`maxLines mismatch for surface "${surface}"`);
    }
    if (entry.maxAnalysisChars !== MAX_ANALYSIS_CHARS) {
      throw new Error(`maxAnalysisChars mismatch for surface "${surface}"`);
    }
    if (entry.allowedLocales.length !== INSIGHT_ALLOWED_LOCALES.length) {
      throw new Error(`allowedLocales mismatch for surface "${surface}"`);
    }
    if (entry.outputSchemaVersion !== INSIGHT_OUTPUT_SCHEMA_VERSION) {
      throw new Error(`outputSchemaVersion mismatch for surface "${surface}"`);
    }
    if (entry.system.trim() === "" || entry.policy.trim() === "") {
      throw new Error(`empty prompt text for surface "${surface}"`);
    }
  }
  if (seenIds.size !== INSIGHT_SURFACE_IDS.length) {
    throw new Error("prompt registry does not cover every surface");
  }
}
