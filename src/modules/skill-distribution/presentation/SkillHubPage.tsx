import { useEffect, useMemo, useState } from "react";

import { InsightCard } from "../../insights/index.ts";
import { useI18n } from "../../../lib/i18n/context";
import {
  getBrowserSecurityClient,
  getDesktopSecurityClient,
  type SecurityHistoryView,
} from "../../security-assessment/index";
import {
  SkillsPage,
  type SkillWorkspaceSnapshot,
} from "../../skill-catalog/index.ts";
import { getDistillationActivity } from "../../distillation/index.ts";

/** Real distillation activity surfaced by the composition root. */
export interface SkillsDistillationView {
  readonly approved: number;
  readonly waiting: number;
}

export interface SkillHubData {
  readonly workspace: SkillWorkspaceSnapshot;
}

/**
 * Skill 管理（prototype `/skills`）：hero Jarvis insight card over the local
 * skill workspace (card grid + distribution). The market catalog lives on its
 * own `/market` route (安全市场) since the V3.0 split. All insight/KPI figures
 * are derived from real loader data and a real client-side security-history
 * read — nothing is mocked.
 */
export function SkillHubPage({ initial }: { initial: SkillHubData }) {
  const { t } = useI18n();
  const [distillation, setDistillation] =
    useState<SkillsDistillationView | null>(null);
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

  // This KPI is useful but must not make the file-backed Skill workspace wait
  // on a separate distillation read path. It fills in after first paint.
  useEffect(() => {
    let cancelled = false;
    void getDistillationActivity()
      .then((activity) => {
        if (!cancelled) setDistillation(activity);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <div className="space-y-4">
      <InsightCard
        surfaceId="skills"
        variant="hero"
        dotsLabel={t("insights.dots")}
      />

      <SkillsPage
        initial={initial.workspace}
        showWorkspace
        showToolOverview={false}
        security={securityView}
        distillation={distillation ?? undefined}
      />
    </div>
  );
}
