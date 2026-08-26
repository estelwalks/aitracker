import { useMemo, useState } from "react";
import { Boxes, Flame, FolderKanban, MessagesSquare } from "lucide-react";

import { MetricGrid } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import { InsightCard } from "../../insights/index.ts";
import type { TrackerReadModel } from "../contracts.ts";
import {
  totalEntriesForBoard,
  tokensForDimension,
  type RoastDimension,
} from "../application/tracker.ts";
import { RoastBoard } from "./roast/RoastBoard.tsx";

/**
 * Token burn leaderboard page. All figures come from the server-side read
 * model (real usage events); nothing here is mocked or estimated.
 */
export function TrackerPage({ initial }: { initial: TrackerReadModel }) {
  const { t, format } = useI18n();
  const { boards } = initial;
  const [dimension, setDimension] = useState<RoastDimension>("project");
  const selectedTokens = tokensForDimension(boards, dimension);

  const metrics = useMemo(
    () => [
      {
        icon: Flame,
        label: t("tracker.metric.tokens"),
        v: format.formatTokens(selectedTokens),
        sub: t("tracker.desc"),
      },
      {
        icon: FolderKanban,
        label: t("tracker.metric.projects"),
        v: format.formatNumber(totalEntriesForBoard(boards.project)),
        sub: t("tracker.metric.sortedBy"),
      },
      {
        icon: Boxes,
        label: t("tracker.metric.skills"),
        v: format.formatNumber(totalEntriesForBoard(boards.skill)),
        sub: t("tracker.metric.sortedBy"),
      },
      {
        icon: MessagesSquare,
        label: t("tracker.metric.sessions"),
        v: format.formatNumber(totalEntriesForBoard(boards.session)),
        sub: t("tracker.metric.sortedBy"),
      },
    ],
    [t, format, boards, selectedTokens],
  );

  return (
    <div className="space-y-4 pb-12">
      <InsightCard
        surfaceId="tracker"
        variant="hero"
        title={t("tracker.insightTitle")}
        dotsLabel={t("insights.dots")}
      />
      <MetricGrid items={metrics} />
      <RoastBoard
        boards={boards}
        dimension={dimension}
        onDimensionChange={setDimension}
      />
    </div>
  );
}
