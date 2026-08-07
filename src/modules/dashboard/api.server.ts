import type { DashboardModuleContract, DashboardReadModel } from "./contracts";
import { createEmptyUsageSnapshot } from "../../lib/local-usage/presentation.ts";
import { getLocalUsageSnapshot } from "../../lib/local-usage/get-local-usage.ts";
import { getLocalSkills } from "../../lib/local-skills/server-fns.ts";
import { getPricingSnapshot } from "../../lib/pricing/server-fns.ts";
import { catalogs, getMessage } from "../../lib/i18n/messages.ts";
import { brandParams } from "../../lib/app-config.ts";
import { createDashboardApplication } from "./application/index.ts";
import type { Locale } from "../../lib/i18n/locale.ts";
import { createProjectUsageReadModel } from "../projects/index.ts";
import { createInsightsApplication } from "../insights/index.ts";
import { estimateEventCost } from "../../lib/pricing/index.ts";

export type DashboardApiResponse = DashboardModuleContract;

/** Server-only query adapter. No scanner, pricing rules, or filesystem details cross this boundary. */
export async function loadDashboardReadModel(
  locale: Locale,
): Promise<DashboardReadModel> {
  const usageResult = await Promise.resolve(getLocalUsageSnapshot()).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason) => ({ status: "rejected" as const, reason }),
  );
  const snapshot =
    usageResult.status === "fulfilled"
      ? usageResult.value
      : createEmptyUsageSnapshot();
  const [skillsResult, pricingResult] = await Promise.allSettled([
    getLocalSkills(),
    getPricingSnapshot({
      data: [...new Set(snapshot.details.map((event) => event.model))],
    }),
  ]);
  const projectModel = createProjectUsageReadModel(
    { events: snapshot.details },
    { estimateEventCost },
  );
  const insightSnapshot = createInsightsApplication().buildSnapshot({
    usage: {
      observedAt: snapshot.generatedAt,
      events: snapshot.events,
      totalTokens: snapshot.totals.totalTokens,
    },
  });
  return createDashboardApplication().read({
    snapshot,
    error:
      usageResult.status === "rejected"
        ? usageResult.reason instanceof Error
          ? usageResult.reason.message
          : getMessage(
              catalogs[locale],
              "dashboard.onboarding.localReadFailed",
              brandParams,
            )
        : null,
    skills: skillsResult.status === "fulfilled" ? skillsResult.value : null,
    pricing: pricingResult.status === "fulfilled" ? pricingResult.value : null,
    locale,
    projectCount: projectModel.projects.length,
    activeInsightCount: insightSnapshot.insights.filter(
      (insight) => insight.status === "active",
    ).length,
  });
}
