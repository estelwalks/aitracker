import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Boxes, Flame, FolderKanban, MessagesSquare } from "lucide-react";

import { MetricGrid } from "../../../components/aitracker";
import { useI18n } from "../../../lib/i18n/context";
import { InsightCard } from "../../insights/index.ts";
import type { TrackerReadModel } from "../contracts.ts";
import {
  totalEntriesForBoard,
  tokensForDimension,
  type RoastDimension,
} from "../application/tracker.ts";
import { RoastBoard } from "./roast/RoastBoard.tsx";
import { mergeProjectIdentitiesQuery } from "../query.ts";

/**
 * Token burn leaderboard page. All figures come from the server-side read
 * model (real usage events); nothing here is mocked or estimated.
 */
export function TrackerPage({ initial }: { initial: TrackerReadModel }) {
  const router = useRouter();
  const { t, format } = useI18n();
  const { boards } = initial;
  const [dimension, setDimension] = useState<RoastDimension>("project");
  const selectedTokens = tokensForDimension(boards, dimension);

  const mergeProjects = async (
    source: { key: string; name: string },
    target: { key: string; name: string },
  ): Promise<boolean> => {
    if (
      !window.confirm(
        t("tracker.merge.confirm", {
          source: source.name,
          target: target.name,
        }),
      )
    ) {
      return false;
    }
    try {
      await mergeProjectIdentitiesQuery({
        data: {
          sourceIdentity: source.key,
          targetIdentity: target.key,
        },
      });
      toast.success(t("tracker.merge.success"));
      await router.invalidate();
      return true;
    } catch {
      toast.error(t("tracker.merge.failed"));
      return false;
    }
  };

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
        onProjectMerge={mergeProjects}
      />
    </div>
  );
}
