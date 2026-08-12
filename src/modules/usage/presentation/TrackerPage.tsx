import { useMemo } from "react";

import { JarvisInsight } from "../../../components/JarvisInsight";
import { MetricGrid, PageHeader } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import {
  composeTrackerInsights,
  resolveInsightLines,
} from "../../../lib/page-insights";
import type { TrackerReadModel } from "../contracts.ts";
import { RoastBoard } from "./roast/RoastBoard.tsx";

/**
 * Token burn leaderboard page. All figures come from the server-side read
 * model (real usage events); nothing here is mocked or estimated.
 */
export function TrackerPage({ initial }: { initial: TrackerReadModel }) {
  const { t, format, locale } = useI18n();
  const { boards, totals, generatedAt } = initial;

  const metrics = useMemo(
    () => [
      {
        label: t("tracker.metric.tokens"),
        v: format.formatTokens(totals.tokens),
      },
      {
        label: t("tracker.metric.events"),
        v: format.formatNumber(totals.events),
      },
      {
        label: t("tracker.metric.entries"),
        v: format.formatNumber(totals.entries),
      },
    ],
    [t, format, totals],
  );
  const insightLines = useMemo(
    () => resolveInsightLines(t, composeTrackerInsights(initial, locale)),
    [t, initial, locale],
  );

  return (
    <div>
      <PageHeader title={t("tracker.title")} desc={t("tracker.desc")} />
      <JarvisInsight
        title={t("insights.title")}
        lines={insightLines}
        rotateLabel={t("insights.rotate")}
        dotsLabel={t("insights.dots")}
      />
      <MetricGrid items={metrics} className="mb-3" />
      <p className="mb-3 text-[11px] text-muted-foreground">
        {generatedAt
          ? `updated ${format.formatDateTime(generatedAt, false)}`
          : ""}
      </p>
      <RoastBoard boards={boards} />
    </div>
  );
}
