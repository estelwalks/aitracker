import { useEffect, useState } from "react";

import { Segmented } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import { SkillsPage } from "../../skill-catalog/index.ts";
import type { SkillWorkspaceSnapshot } from "../../skill-catalog/index.ts";
import type { DashboardReadModel } from "../../dashboard/contracts.ts";
import type { MarketListResult } from "../query.ts";
import { MarketPanel } from "./MarketPanel.tsx";

export type SkillHubTab = "local" | "market";

export interface SkillHubData {
  readonly workspace: SkillWorkspaceSnapshot;
  readonly usage: DashboardReadModel;
  readonly market: MarketListResult;
}

/** Skill Hub (prototype `/skills`): local management + market, two real tabs. */
export function SkillHubPage({
  initial,
  initialTab = "local",
}: {
  initial: SkillHubData;
  initialTab?: SkillHubTab;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SkillHubTab>(initialTab);

  // Keep the active tab in sync when the route's `?tab=` search param changes
  // (e.g. the local empty-state "去市场" link navigates to /skills?tab=market).
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "local", label: t("skills.agentOverview.workspaceTitle") },
            { value: "market", label: t("market.pageHeader") },
          ]}
        />
      </div>
      {tab === "local" ? (
        <SkillsPage
          initial={initial.workspace}
          usage={initial.usage}
          showWorkspace
        />
      ) : (
        <MarketPanel initial={initial.market} />
      )}
    </div>
  );
}
