import { useMemo } from "react";
import { Boxes, Flame, FolderKanban, MessagesSquare } from "lucide-react";

import { JarvisInsight } from "../../../components/JarvisInsight";
import { MetricGrid } from "../../../components/tt";
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
  const { boards, totals } = initial;

  const metrics = useMemo(
    () => [
      {
        icon: Flame,
        label: t("tracker.metric.tokens"),
        v: format.formatTokens(totals.tokens),
        sub: t("tracker.desc"),
      },
      {
        icon: FolderKanban,
        label: t("tracker.metric.projects"),
        v: format.formatNumber(boards.project.rows.length),
        sub: t("tracker.metric.sortedBy"),
      },
      {
        icon: Boxes,
        label: t("tracker.metric.skills"),
        v: format.formatNumber(boards.skill.rows.length),
        sub: t("tracker.metric.sortedBy"),
      },
      {
        icon: MessagesSquare,
        label: t("tracker.metric.sessions"),
        v: format.formatNumber(boards.session.rows.length),
        sub: t("tracker.metric.sortedBy"),
      },
    ],
    [t, format, boards, totals],
  );
  const insightLines = useMemo(
    () => resolveInsightLines(t, composeTrackerInsights(initial, locale)),
    [t, initial, locale],
  );

  return (
    <div className="space-y-4 pb-12">
      <JarvisInsight
        title={t("tracker.insightTitle")}
        lines={insightLines}
        rotateLabel={t("insights.rotate")}
        dotsLabel={t("insights.dots")}
      />
      <MetricGrid items={metrics} />
      <RoastBoard boards={boards} />
    </div>
  );
}
