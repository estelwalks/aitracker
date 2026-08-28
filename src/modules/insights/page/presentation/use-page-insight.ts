/**
 * `usePageInsight` — the renderer hook for the 「今日洞察双模式」 page insight.
 *
 * First render fetches the surface envelope via `getPageInsight` (with cancel
 * protection), then refreshes the mounted page on the configured period.
 * It also exposes localized display lines, the enhance action (with a 60s
 * cooldown and visible failure status), and the raw envelope for
 * status/modelLabel.
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
import { DEFAULT_INSIGHT_REFRESH_INTERVAL_MS } from "../contracts";
import {
  canEnhanceNow,
  composeLineText,
  ENHANCE_COOLDOWN_MS,
  PAGE_INSIGHT_REFRESH_CHANNEL,
  PAGE_INSIGHT_REFRESH_EVENT,
  insightActionPath,
  insightFallbackStatusLabel,
  insightStatusLabel,
  type InsightActionPath,
} from "./use-page-insight.pure";

export {
  canEnhanceNow,
  composeLineText,
  ENHANCE_COOLDOWN_MS,
  PAGE_INSIGHT_REFRESH_CHANNEL,
  PAGE_INSIGHT_REFRESH_EVENT,
  insightActionPath,
  insightFallbackStatusLabel,
  insightStatusLabel,
};
export type {
  ComposableInsightLine,
  ComposeTranslate,
  InsightActionPath,
} from "./use-page-insight.pure";

/** Fallback refresh period; mounted pages replace it with the saved setting. */
export const PAGE_INSIGHT_REFRESH_INTERVAL_MS =
  DEFAULT_INSIGHT_REFRESH_INTERVAL_MS;

type CachedInsight = {
  readonly envelope: InsightEnvelope;
  readonly cachedAtMs: number;
  readonly refreshIntervalMs: number;
};

const insightCache = new Map<string, CachedInsight>();
const insightReads = new Map<string, Promise<InsightEnvelope>>();
const insightEnhancements = new Map<string, Promise<InsightEnvelope>>();
let insightCacheVersion = 0;

function stableScopeKey(scope: InsightScope | undefined): string {
  return JSON.stringify({
    range: scope?.range ?? null,
    entityId: scope?.entityId ?? null,
  });
}

function insightRequestKey(options: UsePageInsightOptions): string {
  return `${options.surfaceId}|${options.locale}|${stableScopeKey(options.scope)}`;
}

function isCachedInsightFresh(
  entry: CachedInsight,
  nowMs = Date.now(),
): boolean {
  const expiresAtMs =
    entry.envelope.enhancementExpiresAtMs ??
    entry.cachedAtMs + entry.refreshIntervalMs;
  return expiresAtMs > nowMs;
}

function readCachedInsight(key: string): CachedInsight | undefined {
  const entry = insightCache.get(key);
  if (entry === undefined || !isCachedInsightFresh(entry)) return undefined;
  return entry;
}

function cacheInsight(
  key: string,
  envelope: InsightEnvelope,
  refreshIntervalMs: number,
): InsightEnvelope {
  const previous = readCachedInsight(key);
  // A background rules read must never erase a still-valid AI result. This is
  // the client-side counterpart of the server cache's configured expiry.
  if (envelope.source === "rules" && previous?.envelope.source === "enhanced") {
    return previous.envelope;
  }
  insightCache.set(key, {
    envelope,
    cachedAtMs: Date.now(),
    refreshIntervalMs,
  });
  return envelope;
}

function requestPageInsight(
  key: string,
  input: Parameters<typeof getPageInsight>[0],
  refreshIntervalMs: number,
): Promise<InsightEnvelope> {
  const existing = insightReads.get(key);
  if (existing !== undefined) return existing;
  const version = insightCacheVersion;
  const request = getPageInsight(input).then((envelope) => {
    if (version !== insightCacheVersion) return envelope;
    return cacheInsight(
      key,
      envelope,
      envelope.refreshIntervalMs ?? refreshIntervalMs,
    );
  });
  insightReads.set(key, request);
  void request.then(
    () => {
      if (insightReads.get(key) === request) insightReads.delete(key);
    },
    () => {
      if (insightReads.get(key) === request) insightReads.delete(key);
    },
  );
  return request;
}

function requestEnhancement(
  key: string,
  input: Parameters<typeof enhancePageInsight>[0],
  refreshIntervalMs: number,
): Promise<InsightEnvelope> {
  const existing = insightEnhancements.get(key);
  if (existing !== undefined) return existing;
  const version = insightCacheVersion;
  const request = enhancePageInsight(input).then((envelope) => {
    if (version !== insightCacheVersion) return envelope;
    return cacheInsight(
      key,
      envelope,
      envelope.refreshIntervalMs ?? refreshIntervalMs,
    );
  });
  insightEnhancements.set(key, request);
  void request.then(
    () => {
      if (insightEnhancements.get(key) === request) {
        insightEnhancements.delete(key);
      }
    },
    () => {
      if (insightEnhancements.get(key) === request) {
        insightEnhancements.delete(key);
      }
    },
  );
  return request;
}

/** Clears renderer caches after settings/model changes or an explicit refresh. */
export function clearPageInsightClientCache(): void {
  insightCacheVersion += 1;
  insightCache.clear();
  insightReads.clear();
  insightEnhancements.clear();
}

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
  refreshIntervalMs = PAGE_INSIGHT_REFRESH_INTERVAL_MS,
): () => void {
  const handle = timer.setInterval(() => {
    void refresh();
  }, refreshIntervalMs);
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
  const requestKey = useMemo(
    () => insightRequestKey({ surfaceId, scope: scopeData, locale }),
    [surfaceId, scopeData, locale],
  );

  useEffect(() => {
    let cancelled = false;
    let refreshInFlight = false;
    let stopRefreshTimer = () => {};

    const refreshEvidence = async (
      initial: boolean,
      showLoading = false,
    ): Promise<void> => {
      if (refreshInFlight) return;
      if (!showLoading) {
        const cached = readCachedInsight(requestKey);
        if (cached !== undefined) {
          setEnvelope(cached.envelope);
          setLoading(false);
          return;
        }
      }
      refreshInFlight = true;
      if (initial || showLoading) setLoading(true);
      setError(false);
      const requestVersion = insightCacheVersion;
      try {
        const refreshIntervalMs = PAGE_INSIGHT_REFRESH_INTERVAL_MS;
        const next = await requestPageInsight(
          requestKey,
          {
            data: {
              surfaceId,
              locale,
              scope: scopeData ?? {},
            },
          },
          refreshIntervalMs,
        );
        if (!cancelled && requestVersion === insightCacheVersion) {
          const resolved = cacheInsight(
            requestKey,
            next,
            next.refreshIntervalMs ?? refreshIntervalMs,
          );
          setEnvelope(resolved);
          stopRefreshTimer();
          stopRefreshTimer = startPageInsightRefreshTimer(
            () => refreshEvidence(false),
            window,
            resolved.refreshIntervalMs ?? refreshIntervalMs,
          );
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        refreshInFlight = false;
        if (!cancelled && (initial || showLoading)) setLoading(false);
      }
    };

    const cached = readCachedInsight(requestKey);
    if (cached !== undefined) {
      setEnvelope(cached.envelope);
      setLoading(false);
      stopRefreshTimer = startPageInsightRefreshTimer(
        () => refreshEvidence(false),
        window,
        cached.envelope.refreshIntervalMs ?? cached.refreshIntervalMs,
      );
    } else {
      void refreshEvidence(true);
    }
    const onModelProfileChanged = () => {
      clearPageInsightClientCache();
      // A manual cache refresh must be allowed to retry immediately.
      lastEnhanceAtRef.current = null;
      stopRefreshTimer();
      stopRefreshTimer = () => {};
      void refreshEvidence(false, true);
    };
    const refreshChannel =
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel(PAGE_INSIGHT_REFRESH_CHANNEL)
        : null;
    refreshChannel?.addEventListener("message", onModelProfileChanged);
    window.addEventListener(PAGE_INSIGHT_REFRESH_EVENT, onModelProfileChanged);
    return () => {
      cancelled = true;
      stopRefreshTimer();
      window.removeEventListener(
        PAGE_INSIGHT_REFRESH_EVENT,
        onModelProfileChanged,
      );
      refreshChannel?.removeEventListener("message", onModelProfileChanged);
      refreshChannel?.close();
    };
  }, [surfaceId, locale, scopeData, requestKey]);

  useEffect(() => {
    // `status === "rules"` excludes "pending": a caller that lost a
    // reservation to the batch must not re-fire its own enhance (the batch
    // writes the cache when it finishes).
    if (
      envelope?.autoEnhance !== true ||
      envelope.source !== "rules" ||
      envelope.status !== "rules"
    ) {
      return;
    }
    if (enhancingRef.current) return;
    // The rules envelope has already rendered. Queue auto enhancement in a
    // separate turn so the provider can never enter the first-paint path.
    const timer = window.setTimeout(() => {
      const now = Date.now();
      if (!canEnhanceNow(lastEnhanceAtRef.current, now)) return;
      lastEnhanceAtRef.current = now;
      enhancingRef.current = true;
      setEnhancing(true);
      const requestVersion = insightCacheVersion;
      void requestEnhancement(
        requestKey,
        {
          data: {
            surfaceId,
            locale,
            scope: scopeData ?? {},
            reason: "auto",
          },
        },
        envelope.refreshIntervalMs ?? PAGE_INSIGHT_REFRESH_INTERVAL_MS,
      )
        .then((next) => {
          if (requestVersion !== insightCacheVersion) return;
          setEnvelope((previous) =>
            previous?.source === "enhanced" && next.source === "rules"
              ? previous
              : next,
          );
        })
        .catch(() => {
          if (requestVersion !== insightCacheVersion) return;
          // Keep the rule lines visible, but expose a stable fallback status
          // when the browser cannot receive the server's failure envelope.
          setEnvelope((previous) =>
            previous == null || previous.source === "enhanced"
              ? previous
              : { ...previous, status: "enhancer-failed", source: "rules" },
          );
        })
        .finally(() => {
          enhancingRef.current = false;
          setEnhancing(false);
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [envelope, surfaceId, locale, scopeData, requestKey]);

  const enhance = useCallback(
    async (reason: "manual" = "manual"): Promise<void> => {
      if (enhancingRef.current) return;
      const now = Date.now();
      if (!canEnhanceNow(lastEnhanceAtRef.current, now)) return;
      lastEnhanceAtRef.current = now;
      enhancingRef.current = true;
      setEnhancing(true);
      try {
        const next = await requestEnhancement(
          requestKey,
          {
            data: {
              surfaceId,
              locale,
              scope: scopeData ?? {},
              reason,
            },
          },
          envelope?.refreshIntervalMs ?? PAGE_INSIGHT_REFRESH_INTERVAL_MS,
        );
        setEnvelope((previous) =>
          previous?.source === "enhanced" && next.source === "rules"
            ? previous
            : next,
        );
      } catch {
        // Keep the deterministic rules output, but make a failed request
        // visible instead of silently looking like enhancement was disabled.
        setEnvelope((previous) =>
          previous == null || previous.source === "enhanced"
            ? previous
            : { ...previous, status: "enhancer-failed", source: "rules" },
        );
      } finally {
        enhancingRef.current = false;
        setEnhancing(false);
      }
    },
    [surfaceId, locale, scopeData, requestKey, envelope],
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
