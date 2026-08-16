import { MetricGrid } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";

/** Four workbench metrics computed from the live selection and session data. */
export function DistillMetrics({
  selectedCount,
  selectedTurns,
  runs,
  approved,
}: {
  selectedCount: number;
  selectedTurns: number;
  runs: number;
  approved: number;
}) {
  const { t, format } = useI18n();
  return (
    <MetricGrid
      className="mb-3"
      items={[
        { label: t("common.distillation.metricMaterial"), v: selectedCount },
        {
          label: t("common.distillation.metricTurns"),
          v: format.formatNumber(selectedTurns),
        },
        { label: t("common.distillation.metricRuns"), v: runs },
        { label: t("common.distillation.metricApproved"), v: approved },
      ]}
    />
  );
}
