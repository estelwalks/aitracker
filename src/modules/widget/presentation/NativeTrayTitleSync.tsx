import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useI18n } from "../../../lib/i18n/context";
import { getWidgetReadModel, getWidgetStatusReadModel } from "../read-model";
import {
  readCachedWidgetReadModel,
  writeCachedWidgetReadModel,
} from "../read-model-cache";
import { useNativeTrayTitleSync } from "./native-tray-title-sync";
import { useWidgetPrefs } from "./widget-prefs";

const TRAY_SUMMARY_INTERVAL_MS = 60_000;

/**
 * Headless main-window owner for the native macOS Tray title.
 * It deliberately reads only the usage projection needed by the title.
 */
export function NativeTrayTitleSync() {
  const { locale, t, format } = useI18n();
  const { prefs, hydrated } = useWidgetPrefs();
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

  useNativeTrayTitleSync(
    {
      dynamic: prefs.menuBarEnabled,
      tokens: format.formatTokens(today?.tokens ?? 0),
      tool: top?.name ?? t("widget.noData"),
      detail,
    },
    desktopAvailable && hydrated && today != null,
  );

  return null;
}
