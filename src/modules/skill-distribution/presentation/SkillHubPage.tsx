import { useEffect, useMemo, useState } from "react";
import { Boxes, Store } from "lucide-react";

import { JarvisInsight } from "../../../components/JarvisInsight";
import { useI18n } from "../../../lib/i18n/context";
import { getBrowserSecurityClient } from "../../security-assessment/query/browser-client";
import { getDesktopSecurityClient } from "../../security-assessment/query/desktop-client";
import type { SecurityHistoryView } from "../../security-assessment/presentation/security-view";
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
 * Skill Hub (prototype `/skills`): hero Jarvis insight card over two real
 * tabs (local card grid + market catalog). All insight/KPI figures are derived
 * from real loader data and a real client-side security-history read — nothing
 * is mocked.
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
  const [securityHistory, setSecurityHistory] = useState<
    readonly SecurityHistoryView[]
  >([]);

  // Keep the active tab in sync when the route's `?tab=` search param changes
  // (e.g. the local empty-state "去市场" link navigates to /skills?tab=market).
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // Real security-detection history from the same Security & Defense client the
  // /security page uses (automatic/monitor scans included). Client-side only;
  // SSR returns [] until hydrate.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const client =
          getDesktopSecurityClient() ?? (await getBrowserSecurityClient());
        if (client == null || cancelled) return;
        const history = await client.getHistory();
        if (!cancelled) setSecurityHistory(history);
      } catch {
        // Security client unavailable — keep the KPI empty rather than invent
        // numbers.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = initial.workspace.workspace.summary;
  const localSkillNames = useMemo(
    () => new Set(initial.workspace.snapshot.skills.map((skill) => skill.name)),
    [initial.workspace.snapshot.skills],
  );

  /**
   * skill name → risk-finding count from the latest completed scan of each
   * locally present skill (mirrors the /security page's history, deduped to the
   * most recent scan so a skill is never counted twice).
   */
  const securityView = useMemo(() => {
    const byName = new Map<string, number>();
    const latestFinishedAt = new Map<string, string>();
    for (const entry of securityHistory) {
      if (!localSkillNames.has(entry.skillName)) continue;
      if (!entry.report) continue; // failed/skipped scans have no findings.
      const previous = latestFinishedAt.get(entry.skillName);
      if (previous && Date.parse(previous) >= Date.parse(entry.finishedAt)) {
        continue;
      }
      latestFinishedAt.set(entry.skillName, entry.finishedAt);
      byName.set(entry.skillName, entry.report.findings.length);
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

  const TABS = [
    {
      id: "local",
      label: t("skills.agentOverview.workspaceTitle"),
      icon: Boxes,
    },
    { id: "market", label: t("market.pageHeader"), icon: Store },
  ] as const;

  return (
    <div className="space-y-4">
      <JarvisInsight
        title={t("insights.title")}
        lines={jarvisLines}
        rotateLabel={t("insights.rotate")}
        dotsLabel={t("insights.dots")}
      />

      {/* Prototype pill tab bar */}
      <div className="flex items-center gap-1 rounded-xl bg-surface-2/60 p-1">
        {TABS.map((tabItem) => {
          const on = tab === tabItem.id;
          const Icon = tabItem.icon;
          return (
            <button
              key={tabItem.id}
              type="button"
              onClick={() => setTab(tabItem.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                on
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{tabItem.label}</span>
            </button>
          );
        })}
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
