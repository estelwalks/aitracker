import { useEffect, useMemo, useState } from "react";

import { JarvisInsight } from "../../../components/JarvisInsight";
import { useI18n } from "../../../lib/i18n/context";
import {
  getBrowserSecurityClient,
  getDesktopSecurityClient,
  type SecurityHistoryView,
} from "../../security-assessment/index";
import { SkillsPage } from "../../skill-catalog/index.ts";
import type { SkillWorkspaceSnapshot } from "../../skill-catalog/index.ts";
import type { AgentUsageOverviewReadModel } from "../../skill-catalog/index.ts";

/** Real distillation activity surfaced by the composition root. */
export interface SkillsDistillationView {
  readonly approved: number;
  readonly waiting: number;
}

export interface SkillHubData {
  readonly workspace: SkillWorkspaceSnapshot;
  /** Compact agent-overview projection; never raw events (P1-T1-07). */
  readonly usage: AgentUsageOverviewReadModel;
  /** Real distillation counters; null when the workbench is unavailable. */
  readonly distillation: SkillsDistillationView | null;
}

/**
 * Skill 管理（prototype `/skills`）：hero Jarvis insight card over the local
 * skill workspace (card grid + distribution). The market catalog lives on its
 * own `/market` route (安全市场) since the V3.0 split. All insight/KPI figures
 * are derived from real loader data and a real client-side security-history
 * read — nothing is mocked.
 */
export function SkillHubPage({ initial }: { initial: SkillHubData }) {
  const { t, format } = useI18n();
  const [securityHistory, setSecurityHistory] = useState<
    readonly SecurityHistoryView[]
  >([]);

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
    } else if (localSkillNames.size > 0) {
      lines.push(t("skills.jarvis.securityClean"));
    }
    return lines;
  }, [t, format, summary, securityView, localSkillNames]);

  return (
    <div className="space-y-4">
      <JarvisInsight
        title={t("insights.title")}
        lines={jarvisLines}
        rotateLabel={t("insights.rotate")}
        dotsLabel={t("insights.dots")}
      />

      <SkillsPage
        initial={initial.workspace}
        usage={initial.usage}
        showWorkspace
        showToolOverview={false}
        security={securityView}
        distillation={initial.distillation ?? undefined}
      />
    </div>
  );
}
