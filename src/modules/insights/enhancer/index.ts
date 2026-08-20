/** Public API of the Insight Enhancer (M2). */
export {
  createInsightEnhancer,
  INSIGHT_ENHANCER_ID,
  type ActiveInsightProfile,
  type InsightEnhancerInput,
  type InsightEnhancerOptions,
  type InsightExecutionRecord,
  type InsightRecordExecution,
} from "./application.ts";
export {
  createLLMInsightGenerator,
  INSIGHT_MODEL_TIMEOUT_MS,
  type InsightGeneratePrompt,
  type InsightGenerateRequest,
  type InsightGenerateResult,
  type InsightGenerateStatus,
  type LLMInsightGenerator,
} from "./llm-page-insight-generator.ts";
export {
  assertPromptRegistryComplete,
  buildInsightPromptTemplate,
  getInsightPrompt,
  INSIGHT_ALLOWED_LOCALES,
  INSIGHT_OUTPUT_SCHEMA_VERSION,
  INSIGHT_PROMPT_VERSION,
  type InsightPrompt,
} from "./prompt-registry.ts";
export {
  assertPayloadSafe,
  INSIGHT_ACTION_IDS,
  MAX_ANALYSIS_CHARS,
  MAX_LINES,
  MAX_PAYLOAD_BYTES,
  MAX_RESPONSE_TEXT_LENGTH,
  stripCodeFence,
  validateEnhancementOutput,
  WIDGET_MAX_LINES,
  type AssertPayloadSafeOptions,
  type InsightEnhancementLine,
  type ValidateEnhancementOutputOptions,
  type ValidateEnhancementOutputResult,
  type ValidatedEnhancementLine,
  type ValidationStage,
} from "./validation.ts";
// Re-export the shared M1 contract types so the wiring module can depend on
// this single entry point for both the port type and its implementation.
export type {
  InsightActionId,
  InsightEnhancementInput,
  InsightEnhancementResult,
  InsightEnhancementStatus,
  InsightEnhancerPort,
  InsightMode,
  InsightSeverity,
  InsightSurfaceId,
} from "../page/contracts.ts";
