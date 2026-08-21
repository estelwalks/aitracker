/**
 * `usePageInsight` — the renderer hook for the 「今日洞察双模式」 page insight.
 *
 * First render fetches the surface envelope via `getPageInsight` (with cancel
 * protection), then refreshes the mounted page's evidence every 30 minutes.
 * It also exposes localized display lines, the enhance action (with a 60s
 * cooldown and silent failure), and the raw envelope for status/modelLabel.
 *
 * All heavy reading is delegated to the M3 server fns; this module never
 * touches the enhancer or read models directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../../../lib/i18n/context";
import type { Locale } from "../../../../lib/i18n/locale";
import type { MessageKey } from "../../../../lib/i18n/messages";
import { enhancePageInsight, getPageInsight } from "../server-fns";
import type {
  InsightActionId,
  InsightEnvelope,
  InsightEnvelopeStatus,
  InsightScope,
  InsightSeverity,
  InsightSurfaceId,
} from "../contracts";
import {
  canEnhanceNow,
  composeLineText,
  ENHANCE_COOLDOWN_MS,
  insightActionPath,
  insightFallbackStatusLabel,
  insightStatusLabel,
  type InsightActionPath,
} from "./use-page-insight.pure";

export {
  canEnhanceNow,
  composeLineText,
  ENHANCE_COOLDOWN_MS,
  insightActionPath,
  insightFallbackStatusLabel,
  insightStatusLabel,
};
export type {
  ComposableInsightLine,
  ComposeTranslate,
  InsightActionPath,
} from "./use-page-insight.pure";

/** Evidence and auto-enhancement refresh period for the currently mounted page. */
export const PAGE_INSIGHT_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export interface PageInsightRefreshTimer {
  setInterval(callback: () => void, delayMs: number): number;
  clearInterval(handle: number): void;
}

/**
 * Starts the mounted-page refresh loop and returns its unmount cleanup.
 * Exported so timer cadence and cleanup can be verified without rendering React.
 */
export function startPageInsightRefreshTimer(
  refresh: () => void | Promise<void>,
  timer: PageInsightRefreshTimer = window,
): () => void {
  const handle = timer.setInterval(() => {
    void refresh();
  }, PAGE_INSIGHT_REFRESH_INTERVAL_MS);
  return () => timer.clearInterval(handle);
}

/** One localized, ready-to-render insight line. */
export interface ResolvedInsightLine {
  readonly id: string;
  readonly text: string;
  readonly severity: InsightSeverity;
  readonly action?: { readonly id: InsightActionId; readonly label: string };
}

/** Hook-level status: loading/empty before the envelope arrives, then envelope status. */
export type PageInsightStatus = InsightEnvelopeStatus | "loading" | "idle";

export interface UsePageInsightOptions {
  readonly surfaceId: InsightSurfaceId;
  readonly scope?: InsightScope;
  readonly locale: Locale;
}

export interface UsePageInsightResult {
  readonly envelope: InsightEnvelope | null;
  readonly lines: ResolvedInsightLine[];
  readonly loading: boolean;
  readonly error: boolean;
  readonly canEnhance: boolean;
  readonly enhancing: boolean;
  readonly enhance: (reason?: "manual") => Promise<void>;
  readonly status: PageInsightStatus;
}

/** Neutral severity label key for the shared card's badge. */
export function insightSeverityLabelKey(severity: InsightSeverity): MessageKey {
  switch (severity) {
    case "info":
      return "settings.insight.severity.info";
    case "attention":
      return "settings.insight.severity.attention";
    case "risk":
      return "settings.insight.severity.risk";
  }
}

export function usePageInsight(
  options: UsePageInsightOptions,
): UsePageInsightResult {
  const { surfaceId, scope, locale } = options;
  const { t } = useI18n();

  const range = scope?.range;
  const entityId = scope?.entityId;

  const [envelope, setEnvelope] = useState<InsightEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const lastEnhanceAtRef = useRef<number | null>(null);
  const enhancingRef = useRef(false);

  const scopeData = useMemo(
    () =>
      range || entityId ? ({ range, entityId } as InsightScope) : undefined,
    [range, entityId],
  );

  useEffect(() => {
    let cancelled = false;
    let refreshInFlight = false;

    const refreshEvidence = async (initial: boolean): Promise<void> => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      if (initial) setLoading(true);
      setError(false);
      try {
        const next = await getPageInsight({
          data: {
            surfaceId,
            locale,
            scope: scopeData ?? {},
          },
        });
        if (!cancelled) setEnvelope(next);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        refreshInFlight = false;
        if (!cancelled && initial) setLoading(false);
      }
    };

    void refreshEvidence(true);
    const stopRefreshTimer = startPageInsightRefreshTimer(() =>
      refreshEvidence(false),
    );
    return () => {
      cancelled = true;
      stopRefreshTimer();
    };
  }, [surfaceId, locale, scopeData]);

  useEffect(() => {
    if (envelope?.autoEnhance !== true || envelope.source !== "rules") return;
    if (enhancingRef.current) return;
    // The rules envelope has already rendered. Queue auto enhancement in a
    // separate turn so the provider can never enter the first-paint path.
    const timer = window.setTimeout(() => {
      const now = Date.now();
      if (!canEnhanceNow(lastEnhanceAtRef.current, now)) return;
      lastEnhanceAtRef.current = now;
      enhancingRef.current = true;
      setEnhancing(true);
      void enhancePageInsight({
        data: {
          surfaceId,
          locale,
          scope: scopeData ?? {},
          reason: "auto",
        },
      })
        .then(setEnvelope)
        .catch(() => {})
        .finally(() => {
          enhancingRef.current = false;
          setEnhancing(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [envelope, surfaceId, locale, scopeData]);

  const enhance = useCallback(
    async (reason: "manual" = "manual"): Promise<void> => {
      if (enhancingRef.current) return;
      const now = Date.now();
      if (!canEnhanceNow(lastEnhanceAtRef.current, now)) return;
      lastEnhanceAtRef.current = now;
      enhancingRef.current = true;
      setEnhancing(true);
      try {
        const next = await enhancePageInsight({
          data: {
            surfaceId,
            locale,
            scope: scopeData ?? {},
            reason,
          },
        });
        setEnvelope(next);
      } catch {
        // Silent: keep the previous envelope; the card never errors out.
      } finally {
        enhancingRef.current = false;
        setEnhancing(false);
      }
    },
    [surfaceId, locale, scopeData],
  );

  const lines = useMemo<ResolvedInsightLine[]>(() => {
    if (envelope == null) return [];
    const render = t as unknown as (
      key: string,
      params?: Record<string, string | number>,
    ) => string;
    return envelope.lines.map((line) => ({
      id: line.id,
      text: composeLineText(render, line),
      severity: line.severity,
      ...(line.action
        ? {
            action: {
              id: line.action.id,
              label: render(line.action.labelKey),
            },
          }
        : {}),
    }));
  }, [envelope, t]);

  return {
    envelope,
    lines,
    loading,
    error,
    canEnhance: envelope?.canEnhance === true,
    enhancing,
    enhance,
    status: loading ? "loading" : (envelope?.status ?? "idle"),
  };
}
