import { AppError } from "../../../lib/errors.ts";
import { INSIGHT_ACTIONS, isInsightActionId } from "./action-registry.ts";
import type {
  InsightEnhancementInput,
  InsightEnvelope,
  InsightEnvelopeLine,
  InsightMode,
  InsightScope,
  InsightSurfaceId,
  InsightEnhancerPort,
  InsightStorePort,
  PageInsightAdapter,
} from "./contracts.ts";
import {
  composeRulesEnvelope,
  filterValidCandidates,
  resolveFactText,
} from "./domain.ts";

export interface PageInsightsApplication {
  read(
    surfaceId: InsightSurfaceId,
    scope: InsightScope,
    locale: string,
  ): Promise<InsightEnvelope>;
  enhance(
    surfaceId: InsightSurfaceId,
    scope: InsightScope,
    options: { locale: string; reason: "manual" | "auto" },
  ): Promise<InsightEnvelope>;
}

export function createPageInsightsApplication(options: {
  readonly adapters: readonly PageInsightAdapter[];
  readonly enhancer?: InsightEnhancerPort;
  readonly store?: InsightStorePort;
  readonly now?: () => number;
}): PageInsightsApplication {
  const now = options.now ?? (() => Date.now());

  function adapterFor(
    surfaceId: InsightSurfaceId,
  ): PageInsightAdapter | undefined {
    return options.adapters.find((adapter) => adapter.surfaceId === surfaceId);
  }

  function modeFor(surfaceId: InsightSurfaceId): InsightMode {
    if (options.store === undefined) return "rules";
    return options.store.getEffectivePreference(surfaceId).mode;
  }

  async function read(
    surfaceId: InsightSurfaceId,
    scope: InsightScope,
    locale: string,
  ): Promise<InsightEnvelope> {
    const adapter = adapterFor(surfaceId);
    if (adapter === undefined) throw new AppError("errors.generic");
    const bundle = await adapter.loadEvidence(scope);
    return composeRulesEnvelope({
      adapter,
      bundle,
      locale,
      mode: modeFor(surfaceId),
      enhancerAvailable: options.enhancer !== undefined,
      now,
    });
  }

  async function enhance(
    surfaceId: InsightSurfaceId,
    scope: InsightScope,
    enhanceOptions: { locale: string; reason: "manual" | "auto" },
  ): Promise<InsightEnvelope> {
    const adapter = adapterFor(surfaceId);
    if (adapter === undefined) throw new AppError("errors.generic");
    const locale = enhanceOptions.locale;
    const mode = modeFor(surfaceId);
    const enhancer = options.enhancer;
    const bundle = await adapter.loadEvidence(scope);

    const base = composeRulesEnvelope({
      adapter,
      bundle,
      locale,
      mode,
      enhancerAvailable: enhancer !== undefined,
      now,
    });

    if (mode === "rules" || enhancer === undefined) {
      return { ...base, status: "enhancer-unavailable" };
    }

    const candidates = filterValidCandidates(
      bundle,
      adapter.composeCandidates(bundle),
    );
    const input: InsightEnhancementInput = {
      surface: surfaceId,
      locale,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        severity: candidate.severity,
        fact: resolveFactText(locale, candidate),
        actionIds: [...candidate.allowedActionIds],
        mandatory: candidate.mandatory ?? false,
      })),
    };

    const result = await enhancer.enhance(input);

    if (
      result.status === "enhanced-cached" ||
      result.status === "enhanced-ready"
    ) {
      const lines: InsightEnvelopeLine[] = base.lines.map((line) => {
        const match = result.lines.find((item) => item.candidateId === line.id);
        if (match === undefined) return line;
        const action =
          match.actionId !== undefined && isInsightActionId(match.actionId)
            ? {
                id: match.actionId,
                labelKey: INSIGHT_ACTIONS[match.actionId].labelKey,
              }
            : undefined;
        return {
          id: line.id,
          severity: line.severity,
          key: line.key,
          params: line.params,
          source: "enhanced",
          ...(match.analysis !== undefined ? { analysis: match.analysis } : {}),
          ...(action !== undefined ? { action } : {}),
        };
      });
      return {
        ...base,
        status: result.status,
        source: "enhanced",
        lines,
        modelLabel: result.modelLabel,
      };
    }

    return {
      ...base,
      status: result.status,
      modelLabel: result.modelLabel,
    };
  }

  return { read, enhance };
}
