import { MetricGrid } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";

/**
 * Four workbench metrics aligned with the prototype (lines 762-777):
 * 已选素材 (~tokens) / 素材 Token (本次输入预估) / 蒸馏次数 (本次会话 / 进行中…)
 * / 已入库 (保存为 Skill). All numbers come from real state: the live
 * selection, this session's successful runs and the persisted approved count.
 *
 * The token figure is a documented heuristic estimate derived from the
 * selected sessions' real turn counts — the privacy-safe renderer projection
 * deliberately omits raw token totals, so it is presented as an estimate
 * (sub-line "本次输入预估"), never as a measured value.
 */
export function DistillMetrics({
  selectedCount,
  estTokens,
  runs,
  approved,
  busy,
}: {
  selectedCount: number;
  /** Heuristic token estimate for the selected material (0 when none). */
  estTokens: number;
  /** Successful distillation runs in this page session (prototype semantics). */
  runs: number;
  /** Persisted approved candidates. */
  approved: number;
  /** True while a distillation run is in flight. */
  busy: boolean;
}) {
  const { t, format } = useI18n();
  const hasMaterial = selectedCount > 0;
  const tokenValue = hasMaterial ? `~${format.formatTokens(estTokens)}` : "—";
  return (
    <MetricGrid
      className="mb-3"
      items={[
        {
          label: t("distill.metricMaterial"),
          v: selectedCount,
          sub: hasMaterial ? `~${format.formatTokens(estTokens)} tokens` : "—",
          color: "var(--chart-1)",
        },
        {
          label: t("distill.metricTokens"),
          v: tokenValue,
          sub: t("distill.metricTokensSub"),
          color: "var(--chart-4)",
        },
        {
          label: t("distill.metricRuns"),
          v: runs,
          sub: busy ? t("distill.metricRunsBusy") : t("distill.metricRunsIdle"),
          color: "var(--chart-2)",
        },
        {
          label: t("distill.metricSaved"),
          v: approved,
          sub: t("distill.metricSavedSub"),
          color: "var(--chart-3)",
        },
      ]}
    />
  );
}
