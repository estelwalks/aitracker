import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { InsightCard } from "../../insights/index.ts";
import { useI18n } from "../../../lib/i18n/context";
import { SECURITY_SCAN_COMPLETED_EVENT } from "../../security-assessment/index";
import { SkillsPage } from "../../skill-catalog/index.ts";
import { getDistillationActivity } from "../../distillation/index.ts";
import type { SkillHubData } from "../query.ts";

export type { SkillHubData, SkillHubSecurityData } from "../query.ts";

/** Real distillation activity surfaced by the composition root. */
export interface SkillsDistillationView {
  readonly approved: number;
  readonly waiting: number;
}

/**
 * Skill management (prototype `/skills`): hero Jarvis insight card over the
 * local skill workspace (card grid + distribution). The market catalog lives
 * on its own `/market` route (security market) since the feature split. All
 * KPI/security figures come from the server-composed loader (canonical
 * security overview + persisted scan history) — one round trip with the rest
 * of the page, identical numbers to the dashboard; a completed scan elsewhere
 * invalidates the route loader so the next read is fresh.
 */
export function SkillHubPage({
  initial,
  initialQuery,
}: {
  initial: SkillHubData;
  initialQuery?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [distillation, setDistillation] =
    useState<SkillsDistillationView | null>(null);

  // A scan can complete while the user is on this page (started here or on
  // /security): invalidate the route loader so the overview and the per-row
  // risk badges refresh through the server model instead of a second client
  // read.
  useEffect(() => {
    const onScanCompleted = () => {
      void router.invalidate().catch(() => undefined);
    };
    window.addEventListener(SECURITY_SCAN_COMPLETED_EVENT, onScanCompleted);
    return () => {
      window.removeEventListener(
        SECURITY_SCAN_COMPLETED_EVENT,
        onScanCompleted,
      );
    };
  }, [router]);

  // Self-heal a pre-`security` route-loader cache (same tab, code updated
  // underneath it): the page renders fine with the fallback, but kick a
  // reload so the canonical numbers replace it without a manual hard refresh.
  useEffect(() => {
    if (initial.security != null) return;
    void router.invalidate().catch(() => undefined);
  }, [initial.security, router]);

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

  // skill name → risk-finding count, server-computed from the latest scan
  // history (the list rows show it next to each skill).
  //
  // `security` was added to the loader payload recently; a route-loader cache
  // from before that change (same tab, code updated underneath it) may still
  // hold the old `{ workspace }` shape until the next navigation/refresh.
  // Tolerate the missing block instead of crashing on first open.
  const securityBlock = initial.security;
  const securityView = {
    byName: new Map(Object.entries(securityBlock?.byRisk ?? {})),
  };
  const securityOverview = securityBlock?.overview ?? null;

  return (
    <div className="space-y-4">
      <InsightCard
        surfaceId="skills"
        variant="hero"
        dotsLabel={t("insights.dots")}
      />

      <SkillsPage
        initial={initial.workspace}
        initialQuery={initialQuery}
        showWorkspace
        showToolOverview={false}
        security={securityView}
        securityOverview={securityOverview}
        distillation={distillation ?? undefined}
      />
    </div>
  );
}
