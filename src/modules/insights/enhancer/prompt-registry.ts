/**
 * Versioned prompt registry for the Insight Enhancer: one entry per surface
 * (14 total). `system` is the shared safety policy; `policy` tailors tone and
 * candidate priority per surface. The registry is complete by construction —
 * `POLICIES` is typed as `Record<InsightSurfaceId, string>`, so a missing
 * surface fails to compile rather than to serve.
 */
import {
  INSIGHT_SURFACE_IDS,
  type InsightSurfaceId,
} from "../page/contracts.ts";
import {
  INSIGHT_ACTION_IDS,
  MAX_ANALYSIS_CHARS,
  MAX_LINES,
  WIDGET_MAX_LINES,
} from "./validation.ts";

export const INSIGHT_PROMPT_VERSION = 1;
export const INSIGHT_OUTPUT_SCHEMA_VERSION = 1;
export const INSIGHT_ALLOWED_LOCALES = ["zh-CN", "en-US", "ja-JP"] as const;

export interface InsightPrompt {
  readonly id: `insight.${InsightSurfaceId}`;
  readonly version: 1;
  readonly surfaceId: InsightSurfaceId;
  readonly maxLines: number;
  readonly maxAnalysisChars: number;
  readonly allowedLocales: readonly string[];
  readonly outputSchemaVersion: 1;
  readonly system: string;
  readonly policy: string;
}

const SHARED_SYSTEM = [
  "You are the AITracker daily-insight enhancer. You rewrite a small set of rule-produced fact sentences into concise, actionable analysis lines.",
  "Hard rules — violating any one invalidates the whole response:",
  "1. Never invent or echo numbers, counts, percentages, URLs, absolute file paths, command names, or entity names (projects, sessions, skills, tools, people).",
  "2. Never add a new action or navigation target; only reuse an action id listed for that exact candidate.",
  "3. Every mandatory candidate must receive exactly one line — never drop it.",
  "4. Respond with a single JSON object only: no markdown, no prose, no code fences.",
  "5. Answer in the same language as the request locale.",
  "6. Never soften a risk: keep or raise the severity implied by each fact.",
].join("\n");

const POLICIES: Record<InsightSurfaceId, string> = {
  dashboard:
    "Prioritize the single most impactful cross-tool observation; calm, actionable tone.",
  agents:
    "Focus on agent health and utilization; suggest the most relevant drill-down action.",
  distill:
    "Emphasize distillation output quality and coverage gaps without naming outputs.",
  reports:
    "Highlight report completeness and scheduling gaps without naming report assets.",
  memory:
    "Summarize memory aggregation state and hygiene; never name a memory item.",
  security:
    "Security findings must NEVER be downplayed: keep or raise severity, never soften it; lead with the most dangerous item.",
  tracker:
    "Summarize usage-tracking coverage and anomalies; point at the tracker action.",
  skills: "Note skill health and adoption without naming a specific skill.",
  market:
    "Summarize marketplace availability and install state without naming a package.",
  chats:
    "Summarize conversation activity without naming sessions or participants.",
  "chat-detail":
    "Summarize the current conversation state neutrally and briefly.",
  widget:
    "Exactly ONE line only: the single most important action. Be extremely brief.",
  settings: "Summarize configuration state and the follow-up settings action.",
  sources:
    "Summarize data-source health and failures without naming a specific source.",
};

export function getInsightPrompt(surfaceId: InsightSurfaceId): InsightPrompt {
  return {
    id: `insight.${surfaceId}`,
    version: 1,
    surfaceId,
    maxLines: surfaceId === "widget" ? WIDGET_MAX_LINES : MAX_LINES,
    maxAnalysisChars: MAX_ANALYSIS_CHARS,
    allowedLocales: [...INSIGHT_ALLOWED_LOCALES],
    outputSchemaVersion: 1,
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
    `At most ${entry.maxLines} line(s). Every mandatory candidate must appear; ` +
      "omit actionId when no action is appropriate.",
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
