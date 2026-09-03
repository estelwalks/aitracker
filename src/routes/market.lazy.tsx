import { createLazyFileRoute } from "@tanstack/react-router";

import { useI18n } from "../lib/i18n/context";
import { InsightCard } from "../modules/insights/index.ts";
import { MarketPanel } from "../modules/skill-distribution/presentation/MarketPanel";

export const Route = createLazyFileRoute("/market")({
  component: MarketRoute,
});

function MarketRoute() {
  const { t } = useI18n();
  const initial = Route.useLoaderData();

  return (
    <div className="space-y-4">
      <InsightCard
        surfaceId="market"
        variant="hero"
        title={t("insights.title")}
        dotsLabel={t("insights.dots")}
      />
      <MarketPanel
        initial={initial}
        initialLoadFailed={initial.loadFailed ?? false}
      />
    </div>
  );
}
