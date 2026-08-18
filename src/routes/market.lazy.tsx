import { createLazyFileRoute } from "@tanstack/react-router";

import { JarvisInsight } from "../components/JarvisInsight";
import { useI18n } from "../lib/i18n/context";
import { MarketPanel } from "../modules/skill-distribution/presentation/MarketPanel";

export const Route = createLazyFileRoute("/market")({
  component: MarketRoute,
});

function MarketRoute() {
  const { t, format } = useI18n();
  const initial = Route.useLoaderData();

  const lines = [
    t("market.jarvis.available", {
      total: format.formatNumber(initial.stats?.totalSkills ?? 0),
      official: format.formatNumber(initial.stats?.officialCount ?? 0),
    }),
  ];
  if ((initial.stats?.installedCount ?? 0) > 0) {
    lines.push(
      t("market.jarvis.installed", {
        count: format.formatNumber(initial.stats?.installedCount ?? 0),
      }),
    );
  }

  return (
    <div className="space-y-4">
      <JarvisInsight
        title={t("insights.title")}
        lines={lines}
        rotateLabel={t("insights.rotate")}
        dotsLabel={t("insights.dots")}
      />
      <MarketPanel initial={initial} />
    </div>
  );
}
