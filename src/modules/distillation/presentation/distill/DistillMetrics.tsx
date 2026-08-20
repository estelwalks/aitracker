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
  const cards = [
    {
      k: t("distill.metricMaterial"),
      v: `${selectedCount}`,
      s: hasMaterial ? `~${format.formatTokens(estTokens)} tokens` : "—",
      c: "var(--chart-1)",
    },
    {
      k: t("distill.metricTokens"),
      v: tokenValue,
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
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((m) => (
        <div key={m.k} className="rounded-xl bg-card p-4">
          <div className="truncate text-[11px] leading-4 text-muted-foreground">
            {m.k}
          </div>
          <div
            className="tt-num mt-1.5 font-mono text-[20px] leading-none font-bold"
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
