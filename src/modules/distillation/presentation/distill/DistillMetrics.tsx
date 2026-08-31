import { useI18n } from "../../../../lib/i18n/context";

/**
 * Four workbench metrics aligned with the prototype (lines 762-777):
 * Selected materials (~tokens) / Material Token (estimated input this time) / Distillation times (accumulated / in progress...)
 * / Already stored (saved as Skill). Runs and committed both aggregate the persisted
 * totals plus this page session's increments — the same caliber, so a reload
 * shows the persisted count instead of resetting one card and keeping the
 * other.
 *
 * The token figure is a documented heuristic estimate derived from the
 * selected sessions' real turn counts — the privacy-safe renderer projection
 * deliberately omits raw token totals, so it is presented as an estimate
 * (sub-line "This input estimate"), never as a measured value.
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
  // Prototype indicator bar: The selected material sub always displays "~{tokens} tokens", and the material Token always displays the value.
  // (Appears only if it is not empty, without "-"; the estimated value itself has "~" semantics, see E-200).
  const cards = [
    {
      k: t("distill.metricMaterial"),
      v: `${selectedCount}`,
      s: `~${format.formatTokens(estTokens)} tokens`,
      c: "var(--chart-1)",
    },
    {
      k: t("distill.metricTokens"),
      v: format.formatTokens(estTokens),
      s: t("distill.metricTokensSub"),
      c: "var(--chart-4)",
    },
    {
      k: t("distill.metricRuns"),
      v: `${runs}`,
      s: busy ? t("distill.metricRunsBusy") : t("distill.metricRunsIdle"),
      c: "var(--chart-2)",
    },
    {
      k: t("distill.metricSaved"),
      v: `${approved}`,
      s: t("distill.metricSavedSub"),
      c: "var(--chart-3)",
    },
  ];
  return (
    <section className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((m) => (
        <div
          key={m.k}
          className="min-w-0 overflow-hidden rounded-xl bg-card p-4"
        >
          <div className="truncate text-[11px] leading-4 text-muted-foreground">
            {m.k}
          </div>
          <div
            className="aitracker-num aitracker-text-metric mt-1.5 min-w-0 truncate font-mono leading-none font-bold"
            style={{ color: m.c }}
          >
            {m.v}
          </div>
          <div className="mt-1.5 truncate font-mono text-[10px] leading-4 text-muted-foreground">
            {m.s}
          </div>
        </div>
      ))}
    </section>
  );
}
