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

export const INSIGHT_PROMPT_VERSION = 2;
export const INSIGHT_OUTPUT_SCHEMA_VERSION = 2;
export const INSIGHT_ALLOWED_LOCALES = [
  "zh-CN",
  "en-US",
  "ja-JP",
  "ko-KR",
] as const;

export interface InsightPrompt {
  readonly id: `insight.${InsightSurfaceId}`;
  readonly version: 2;
  readonly surfaceId: InsightSurfaceId;
  readonly maxLines: number;
  readonly maxAnalysisChars: number;
  readonly allowedLocales: readonly string[];
  readonly outputSchemaVersion: 2;
  readonly system: string;
  readonly policy: string;
}

const SHARED_SYSTEM = [
  `You are the ${APP_NAME} daily-insight enhancer. You rewrite a small set of rule-produced fact sentences into concise, actionable analysis lines.`,
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
    "Cover distinct dimensions across security, usage and sessions, source concentration, cache efficiency, collection health, and distillation next steps; calm, actionable tone.",
  agents:
    "Cover distinct dimensions across tool coverage, activity, prompt structure, cache reuse, security posture, and agent-specific optimization.",
  distill:
    "Cover distinct dimensions across pending work, knowledge output, quota, reuse coverage, material focus, and the empty-state path without naming outputs.",
  reports:
    "Cover distinct dimensions across report inventory and recency, highlights, security review, collaboration, and the next report path without naming report assets.",
  memory:
    "Cover distinct dimensions across asset inventory, approval and publishing, risk hygiene, memory types, automatic aggregation, and the empty-state path; never name a memory item.",
  security:
    "Cover distinct dimensions across risk, failed-scan gaps, coverage, recency, history, and starting a scan. NEVER downplay severity; lead with the most dangerous item.",
  tracker:
    "Cover distinct dimensions across consumption, waste, cache efficiency, model and project concentration, and optimization; point at the tracker action.",
  skills:
    "Cover distinct dimensions across local inventory, enablement, Agent coverage, updates, sync, safety, and specialization without naming a specific skill.",
  market:
    "Cover distinct dimensions across local installs, updates, cached catalog availability and size, security review, and the installation path without naming a package.",
  chats:
    "Cover distinct dimensions across session inventory, sources, recoverability, activity, recovery, and distillation without naming sessions or participants.",
  "chat-detail":
    "Cover distinct dimensions across turns, token activity, recovery state, session status, recovery action, and distillation action; stay neutral and never name the session.",
  widget:
    "Exactly ONE line only: the single most important action. Be extremely brief.",
  settings:
    "Cover distinct dimensions across model readiness, insight enhancement, task schedules, collection, retention, and local privacy.",
  sources:
    "Cover distinct dimensions across detected sources, usable data, missing logs, missing installations, malformed input, rescanning, and local boundaries without naming a specific source.",
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
