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
  InsightPreference,
} from "./contracts.ts";
import { INSIGHT_AUTO_CONSENT_VERSION } from "./contracts.ts";
import { isInsightAnalysisUseful } from "./analysis-quality.ts";
import {
  composeRulesEnvelope,
  composePageCandidates,
  composeRemotePageCandidates,
  evidenceHash,
  formatInsightFactParams,
  rankCandidates,
  resolveFactText,
} from "./domain.ts";
import { getPageRuleConfig } from "./rule-registry.ts";

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

  function preferenceFor(surfaceId: InsightSurfaceId): InsightPreference {
    if (options.store !== undefined) {
      return options.store.getEffectivePreference(surfaceId);
    }
    return {
      scopeKey: "global",
      mode: "enhanced-auto",
      profileId: null,
      consentVersion: INSIGHT_AUTO_CONSENT_VERSION,
      consentedAtMs: 0,
      dailyCallLimit: null,
      updatedAtMs: 0,
    };
  }

  function hasValidAutoConsent(preference: InsightPreference): boolean {
    return (
      preference.mode === "enhanced-auto" &&
      preference.consentVersion === INSIGHT_AUTO_CONSENT_VERSION &&
      preference.consentedAtMs !== null &&
      preference.consentedAtMs <= now()
    );
  }

  async function read(
    surfaceId: InsightSurfaceId,
    scope: InsightScope,
    locale: string,
  ): Promise<InsightEnvelope> {
    const adapter = adapterFor(surfaceId);
    if (adapter === undefined) throw new AppError("errors.generic");
    const bundle = await adapter.loadEvidence(scope);
    const preference = preferenceFor(surfaceId);
    return composeRulesEnvelope({
      adapter,
      bundle,
      locale,
      mode: preference.mode,
      enhancerAvailable: options.enhancer !== undefined,
      autoEnhanceAuthorized: hasValidAutoConsent(preference),
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
    const preference = preferenceFor(surfaceId);
    const mode = preference.mode;
    const enhancer = options.enhancer;
    const bundle = await adapter.loadEvidence(scope);

    const base = composeRulesEnvelope({
      adapter,
      bundle,
      locale,
      mode,
      enhancerAvailable: enhancer !== undefined,
      autoEnhanceAuthorized: hasValidAutoConsent(preference),
      now,
    });

    const reasonAllowed =
      (mode === "enhanced-manual" && enhanceOptions.reason === "manual") ||
      (mode === "enhanced-auto" &&
        enhanceOptions.reason === "auto" &&
        hasValidAutoConsent(preference));
    if (!reasonAllowed || enhancer === undefined) {
      return { ...base, status: "enhancer-unavailable" };
    }

    const candidates = composePageCandidates(adapter, bundle);
    const maxLines = getPageRuleConfig(surfaceId).maxLines;
    const remoteCandidates = composeRemotePageCandidates(adapter, bundle);
    const input: InsightEnhancementInput = {
      surface: surfaceId,
      adapterVersion: adapter.adapterVersion,
      locale,
      profileId: preference.profileId,
      dailyCallLimit: preference.dailyCallLimit,
      candidates: remoteCandidates.map((candidate) => ({
        id: candidate.id,
        severity: candidate.severity,
        fact: resolveFactText(locale, candidate),
        actionIds: [...candidate.allowedActionIds],
        mandatory: candidate.mandatory ?? false,
      })),
    };

    if (input.candidates.length === 0) return base;

    const result = await enhancer.enhance(input);

    // Enhancement is deliberately off the first-paint path. Re-read only
    // after the model completes so an older request can never overwrite newer
    // evidence that arrived while it was running.
    const latestBundle = await adapter.loadEvidence(scope);
    if (evidenceHash(latestBundle) !== evidenceHash(bundle)) {
      return composeRulesEnvelope({
        adapter,
        bundle: latestBundle,
        locale,
        mode,
        enhancerAvailable: enhancer !== undefined,
        autoEnhanceAuthorized: hasValidAutoConsent(preference),
        now,
      });
    }

    if (
      result.status === "enhanced-cached" ||
      result.status === "enhanced-ready"
    ) {
      const candidatesById = new Map(
        [...candidates, ...remoteCandidates].map((candidate) => [
          candidate.id,
          candidate,
        ]),
      );
      const selectedIds = new Set(result.lines.map((line) => line.candidateId));
      const mandatory = rankCandidates(candidates, candidates.length).filter(
        (candidate) => candidate.mandatory === true,
      );
      const modelSelected = result.lines
        .map((line) => candidatesById.get(line.candidateId))
        .filter(
          (candidate): candidate is NonNullable<typeof candidate> =>
            candidate !== undefined && candidate.mandatory !== true,
        );
      const fallback = rankCandidates(candidates, candidates.length).filter(
        (candidate) =>
          candidate.mandatory !== true && !selectedIds.has(candidate.id),
      );
      const ordered = [...mandatory, ...modelSelected, ...fallback].slice(
        0,
        maxLines,
      );

      const lines: InsightEnvelopeLine[] = ordered.map((candidate) => {
        const match = result.lines.find(
          (item) => item.candidateId === candidate.id,
        );
        const analysis =
          match?.analysis !== undefined &&
          isInsightAnalysisUseful(
            resolveFactText(locale, candidate),
            match.analysis,
          )
            ? match.analysis.trim()
            : undefined;
        const action =
          analysis !== undefined &&
          match?.actionId !== undefined &&
          isInsightActionId(match.actionId) &&
          candidate.allowedActionIds.includes(match.actionId)
            ? {
                id: match.actionId,
                labelKey: INSIGHT_ACTIONS[match.actionId].labelKey,
              }
            : candidate.actionId !== undefined
              ? {
                  id: candidate.actionId,
                  labelKey: INSIGHT_ACTIONS[candidate.actionId].labelKey,
                }
              : undefined;
        return {
          id: candidate.id,
          severity: candidate.severity,
          key: candidate.factKey,
          params: formatInsightFactParams(
            locale,
            candidate.factKey,
            candidate.factParams,
          ),
          source: analysis === undefined ? "rules" : "enhanced",
          ...(analysis !== undefined ? { analysis } : {}),
          ...(action !== undefined ? { action } : {}),
        };
      });
      const hasUsefulEnhancement = lines.some(
        (line) => line.source === "enhanced",
      );
      return {
        ...base,
        status: hasUsefulEnhancement ? result.status : "invalid-output",
        source: hasUsefulEnhancement ? "enhanced" : "rules",
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
