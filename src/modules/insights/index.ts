export { insightsModuleId } from "./contracts";
export type { InsightsModuleContract, InsightsModuleId } from "./contracts";
export { createInsightsApplication } from "./application";
export type {
  EvidenceRef,
  Insight,
  InsightFreshness,
  InsightSeverity,
  InsightSnapshot,
  InsightStatus,
  InsightUncertainty,
  InsightsInput,
  UsageInsightInput,
  SecurityInsightInput,
  JobInsightInput,
  KnowledgeInsightInput,
  StalePolicy,
} from "./contracts";
export type { InsightsViewModel } from "./presentation";
export type {
  InsightCandidate,
  InsightEvidence,
  InsightEvidenceBundle,
  InsightScope,
  InsightSurfaceId,
  PageInsightAdapter,
} from "./page/contracts.ts";
export { InsightCard } from "./page/presentation/insight-card.tsx";
export { InsightSettingsSection } from "./page/presentation/InsightSettingsSection.tsx";
export { usePageInsight } from "./page/presentation/use-page-insight.ts";
export { insightSeverityLabelKey } from "./page/presentation/use-page-insight.ts";
export { clearPageInsightClientCache } from "./page/presentation/use-page-insight.ts";
export {
  PAGE_INSIGHT_REFRESH_CHANNEL,
  PAGE_INSIGHT_REFRESH_EVENT,
  insightFallbackStatusLabel,
} from "./page/presentation/use-page-insight.pure.ts";
