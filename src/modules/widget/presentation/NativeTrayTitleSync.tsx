import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useI18n } from "../../../lib/i18n/context";
import { getWidgetReadModel, getWidgetStatusReadModel } from "../read-model";
import {
  readCachedWidgetReadModel,
  writeCachedWidgetReadModel,
} from "../read-model-cache";
import {
  startNativeTrayInsightRotation,
  useNativeTrayTitleSync,
} from "./native-tray-title-sync";
import { buildMenuBarInsights } from "./menu-bar-display";
import { useWidgetPrefs } from "./widget-prefs";

const TRAY_SUMMARY_INTERVAL_MS = 60_000;

/**
 * Headless main-window owner for the native macOS Tray title.
 * It deliberately reads only the usage projection needed by the title.
 */
export function NativeTrayTitleSync() {
  const { locale, t, format } = useI18n();
  const { prefs, hydrated } = useWidgetPrefs();
  const [insightIndex, setInsightIndex] = useState(0);
  const queryClient = useQueryClient();
  const desktopAvailable =
    typeof window !== "undefined" && window.desktopApi != null;
  const cachedModel = readCachedWidgetReadModel(locale);
  const statusQuery = useQuery({
    queryKey: ["widget-status", locale],
    queryFn: () => getWidgetStatusReadModel({ data: locale }),
    enabled: desktopAvailable,
    refetchInterval: TRAY_SUMMARY_INTERVAL_MS,
    refetchIntervalInBackground: true,
    staleTime: TRAY_SUMMARY_INTERVAL_MS - 5_000,
  });
  const summaryQuery = useQuery({
    // Share the compact query with the Widget renderer in the same window;
    // separate Electron windows additionally share the localStorage cache.
    queryKey: ["widget-model", locale, null],
    queryFn: () => getWidgetReadModel({ data: locale }),
    enabled: desktopAvailable,
    initialData: cachedModel,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
  });
  useEffect(() => {
    const statusRevision = statusQuery.data?.revision;
    const modelRevision = summaryQuery.data?.revision;
    if (
      statusRevision != null &&
      modelRevision != null &&
      statusRevision !== modelRevision
    ) {
      void queryClient.invalidateQueries({
        queryKey: ["widget-model", locale, null],
      });
    }
  }, [
    locale,
    queryClient,
    statusQuery.data?.revision,
    summaryQuery.data?.revision,
  ]);
  useEffect(() => {
    if (summaryQuery.data)
      writeCachedWidgetReadModel(locale, summaryQuery.data);
  }, [locale, summaryQuery.data]);
  const today = summaryQuery.data?.today;
  const top = today?.topTools[0];
  const detail =
    today?.cacheRate == null
      ? `${format.formatNumber(today?.events ?? 0)} ${t("widget.events")}`
      : t("widget.cacheRate", {
          percent: Math.round(today.cacheRate),
        });
  const hasData = summaryQuery.data?.hasData === true;
  const insights = useMemo(() => {
    if (!hasData) return buildMenuBarInsights([t("widget.noData")]);
    return buildMenuBarInsights([
      top?.name,
      detail,
      today?.sessions == null
        ? null
        : t("widget.jarvisSessionsConcise", { count: today.sessions }),
    ]);
  }, [detail, hasData, t, today?.sessions, top]);

  useEffect(() => {
    setInsightIndex(0);
  }, [insights]);

  useEffect(() => {
    if (!prefs.menuBarEnabled || insights.length <= 1) return undefined;
    return startNativeTrayInsightRotation(
      prefs.rotate,
      insights.length,
      () =>
        setInsightIndex(
          (current) => (current + 1) % Math.max(insights.length, 1),
        ),
      window,
    );
  }, [insights.length, prefs.menuBarEnabled, prefs.rotate]);

  const insight = insights[insightIndex % Math.max(insights.length, 1)];

  useNativeTrayTitleSync(
    {
      dynamic: prefs.menuBarEnabled,
      tokens: format.formatTokens(today?.tokens ?? 0),
      tool: top?.name ?? t("widget.noData"),
      detail,
      insight,
    },
    desktopAvailable && hydrated && today != null,
  );

  return null;
}
