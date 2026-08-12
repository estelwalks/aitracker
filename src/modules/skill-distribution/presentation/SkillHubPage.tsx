import { useEffect, useMemo, useState } from "react";

import { PageBar, Segmented } from "../../../components/tt";
import { JarvisInsight } from "../../../components/JarvisInsight";
import { useI18n } from "../../../lib/i18n/context";
import { loadSecurityHistory } from "../../../lib/security/history";
import type { SecurityReport } from "../../../lib/security/scanner";
import { SkillsPage } from "../../skill-catalog/index.ts";
import type { SkillWorkspaceSnapshot } from "../../skill-catalog/index.ts";
import type { DashboardReadModel } from "../../dashboard/contracts.ts";
import type { MarketListResult } from "../query.ts";
import { MarketPanel } from "./MarketPanel.tsx";

export type SkillHubTab = "local" | "market";

/** Real distillation activity surfaced by the composition root. */
export interface SkillsDistillationView {
  readonly approved: number;
  readonly waiting: number;
}

export interface SkillHubData {
  readonly workspace: SkillWorkspaceSnapshot;
  readonly usage: DashboardReadModel;
  readonly market: MarketListResult;
  /** Real distillation counters; null when the workbench is unavailable. */
  readonly distillation: SkillsDistillationView | null;
}

/**
 * Skill Hub (prototype `/skills`): PageBar + shared Jarvis insight card over
 * two real tabs. All insight/KPI figures are derived from real loader data and
 * a real client-side security-history read — nothing is mocked.
 */
export function SkillHubPage({
  initial,
  initialTab = "local",
}: {
  initial: SkillHubData;
  initialTab?: SkillHubTab;
}) {
  const { t, format } = useI18n();
  const [tab, setTab] = useState<SkillHubTab>(initialTab);
  const [securityHistory, setSecurityHistory] = useState<SecurityReport[]>([]);

  // Keep the active tab in sync when the route's `?tab=` search param changes
  // (e.g. the local empty-state "去市场" link navigates to /skills?tab=market).
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // Real security-detection history (client-side; SSR returns [] until hydrate).
  useEffect(() => {
    let cancelled = false;
    void loadSecurityHistory()
      .then((history) => {
        if (!cancelled) setSecurityHistory(history);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = initial.workspace.workspace.summary;
  const localSkillNames = useMemo(
    () => new Set(initial.workspace.snapshot.skills.map((skill) => skill.name)),
    [initial.workspace.snapshot.skills],
  );

  /** skill name → risk-finding count, restricted to locally present skills. */
  const securityView = useMemo(() => {
    const byName = new Map<string, number>();
    for (const report of securityHistory) {
      if (!localSkillNames.has(report.targetName)) continue;
      byName.set(
        report.targetName,
        (byName.get(report.targetName) ?? 0) + report.risks.length,
      );
    }
    return { byName };
  }, [securityHistory, localSkillNames]);

  // Jarvis lines — every number comes from real loader data / real reads.
  const jarvisLines = useMemo(() => {
    const lines: string[] = [];
    lines.push(
      t("skills.jarvis.localSkills", {
        count: format.formatNumber(summary.skillCount),
        agents: format.formatNumber(summary.activeAgentCount),
        installs: format.formatNumber(summary.installationCount),
      }),
    );
    if (securityView.byName.size > 0) {
      const riskCount = [...securityView.byName.values()].reduce(
        (total, count) => total + count,
        0,
      );
      lines.push(
        t("skills.jarvis.securityDetected", {
          count: format.formatNumber(securityView.byName.size),
          risk: format.formatNumber(riskCount),
        }),
      );
    }
    const stats = initial.market.stats;
    if (stats) {
      lines.push(
        t("skills.jarvis.marketAvailable", {
          total: format.formatNumber(stats.totalSkills),
          official: format.formatNumber(stats.officialCount),
        }),
      );
      if (stats.installedCount > 0) {
        lines.push(
          t("skills.jarvis.marketInstalled", {
            count: format.formatNumber(stats.installedCount),
          }),
        );
      }
    }
    return lines;
  }, [t, format, summary, securityView, initial.market.stats]);

  return (
    <div>
      <PageBar
        title={t("skills.hub.title")}
        summary={t("skills.hub.summary", {
          count: format.formatNumber(summary.skillCount),
        })}
      />

      <div className="mt-4">
        <JarvisInsight
          title={t("insights.title")}
          lines={jarvisLines}
          rotateLabel={t("insights.rotate")}
          dotsLabel={t("insights.dots")}
        />
      </div>

      <div className="mt-4 mb-4">
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
          showToolOverview={false}
          security={securityView}
          distillation={initial.distillation ?? undefined}
        />
      ) : (
        <MarketPanel initial={initial.market} />
      )}
    </div>
  );
}
