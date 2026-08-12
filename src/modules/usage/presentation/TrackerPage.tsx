import { useMemo } from "react";

import { MetricGrid, PageHeader } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import type { TrackerReadModel } from "../contracts.ts";
import { RoastBoard } from "./roast/RoastBoard.tsx";

/**
 * Token burn leaderboard page. All figures come from the server-side read
 * model (real usage events); nothing here is mocked or estimated.
 */
export function TrackerPage({ initial }: { initial: TrackerReadModel }) {
  const { t, format } = useI18n();
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

  return (
    <div>
      <PageHeader title={t("tracker.title")} desc={t("tracker.desc")} />
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
