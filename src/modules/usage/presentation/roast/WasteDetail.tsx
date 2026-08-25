import {
  Activity,
  Coins,
  Database,
  FileOutput,
  Flame,
  Gauge,
  Sparkles,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import type { MessageKey } from "../../../../lib/i18n/messages";
import type { RoastRow } from "../../application/tracker.ts";

const SUGGEST_KEY: Record<RoastRow["suggestion"], MessageKey> = {
  cache: "tracker.suggest.cache",
  output: "tracker.suggest.output",
  volume: "tracker.suggest.volume",
  none: "tracker.suggest.none",
};

const TREND_KEY: Record<Exclude<RoastRow["trend"], null>, MessageKey> = {
  up: "tracker.row.trendUp",
  down: "tracker.row.trendDown",
  flat: "tracker.row.trendFlat",
};

function wasteTone(waste: number): {
  accent: string;
  badge: string;
  soft: string;
} {
  if (waste >= 45) {
    return {
      accent: "var(--danger)",
      badge: "bg-danger/15 text-danger",
      soft: "bg-danger/8 ring-danger/20",
    };
  }
  if (waste >= 28) {
    return {
      accent: "var(--warn)",
      badge: "bg-warn/15 text-warn",
      soft: "bg-warn/8 ring-warn/20",
    };
  }
  return {
    accent: "var(--ok)",
    badge: "bg-ok/15 text-ok",
    soft: "bg-ok/8 ring-ok/20",
  };
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-surface px-3.5 py-3 ring-1 ring-border/50">
      <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground/70 uppercase">
        <Icon className="size-3.5" strokeWidth={1.8} />
        <span className="truncate">{label}</span>
      </div>
      <div className="tt-num mt-2 truncate font-mono text-[17px] leading-none font-black tracking-tight">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** Waste breakdown dialog for a single ranked row. */
export function WasteDetail({
  row,
  onClose,
}: {
  row: RoastRow;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  // 无效消耗与浪费指数同源：tokens × waste/100（见 wasteIndex 公式），
  // 全部来自真实缓存/输出字段，不额外估算。
  const wastedTokens = Math.round((row.tokens * row.waste) / 100);
  const tone = wasteTone(row.waste);
  const cacheRate =
    row.cacheRate == null ? "—" : `${row.cacheRate.toFixed(1)}%`;
  const outputPercent = `${(row.outputRatio * 100).toFixed(2)}%`;
  const cacheLabel = t("tracker.row.cacheRate", { rate: "" }).trim();
  const outputLabel = t("tracker.row.outputRatio", { ratio: "" }).trim();
  const trendLabel = row.trend ? t(TREND_KEY[row.trend]) : null;
  const TrendIcon =
    row.trend === "up"
      ? TrendingUp
      : row.trend === "down"
        ? TrendingDown
        : Activity;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto rounded-2xl bg-card p-0">
        <DialogHeader className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-warn/10 via-card to-card px-5 pb-5 pt-5 text-left">
          <div className="pointer-events-none absolute -top-16 right-0 size-40 rounded-full bg-warn/10 blur-3xl" />
          <div className="relative flex items-start gap-3.5 pr-7">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-warn/15 text-warn ring-1 ring-warn/20">
              <Flame className="size-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground/70 uppercase">
                {t("tracker.title")}
              </div>
              <DialogTitle className="mt-1 truncate text-[18px] tracking-tight">
                {row.name}
              </DialogTitle>
              <DialogDescription className="mt-1.5 max-w-md text-[11.5px] leading-relaxed">
                {t("tracker.detail.wasteExplain")}
              </DialogDescription>
            </div>
            <div className="shrink-0 rounded-xl bg-surface px-3 py-2 text-right ring-1 ring-border/60">
              <div className="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
                {t("tracker.row.waste")}
              </div>
              <div
                className="tt-num mt-1 font-mono text-[24px] leading-none font-black"
                style={{ color: tone.accent }}
              >
                {row.waste.toFixed(1)}%
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3.5 p-5 pt-4">
          <section className={`rounded-xl px-4 py-3.5 ring-1 ${tone.soft}`}>
            <div className="flex items-center gap-2">
              <Gauge className="size-4" style={{ color: tone.accent }} />
              <span className="text-[12px] font-semibold">
                {t("tracker.row.waste")}
              </span>
              <span
                className={`ml-auto rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${tone.badge}`}
              >
                {row.waste.toFixed(1)}%
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[12px]">
              <FormulaChip value="100" />
              <FormulaOperator value="×" />
              <FormulaChip value={`(1 − ${cacheRate})`} />
              <FormulaOperator value="×" />
              <FormulaChip value={outputPercent} />
              <FormulaOperator value="=" />
              <FormulaChip value={`${row.waste.toFixed(1)}%`} emphasized />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("tracker.detail.wasteExplain")}
            </p>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              icon={Coins}
              label={t("tracker.metric.tokens")}
              value={format.formatNumber(row.tokens)}
              hint={t("tracker.row.tokens", {
                count: format.formatTokens(row.tokens),
              })}
            />
            <MetricCard
              icon={Activity}
              label={t("tracker.row.events", { count: "" }).trim()}
              value={format.formatNumber(row.events)}
              hint={t("tracker.row.events", {
                count: format.formatNumber(row.events),
              })}
            />
            <MetricCard
              icon={Database}
              label={cacheLabel}
              value={cacheRate}
              hint={t("tracker.row.cacheRate", {
                rate: row.cacheRate?.toFixed(1) ?? "—",
              })}
            />
            <MetricCard
              icon={FileOutput}
              label={outputLabel}
              value={outputPercent}
              hint={t("tracker.row.outputRatio", {
                ratio: row.outputRatio.toFixed(2),
              })}
            />
          </div>

          {row.previousTokens != null ? (
            <div className="flex items-center gap-2 rounded-xl bg-surface px-3.5 py-3 ring-1 ring-border/50">
              <TrendIcon
                className={`size-4 ${row.trend === "up" ? "text-danger" : row.trend === "down" ? "text-ok" : "text-muted-foreground"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium">
                  {trendLabel ?? t("tracker.row.trendNa")}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {t("tracker.row.tokens", {
                    count: format.formatTokens(row.previousTokens),
                  })}
                </div>
              </div>
              <div className="tt-num font-mono text-[14px] font-bold">
                {format.formatNumber(row.previousTokens)}
              </div>
            </div>
          ) : null}

          <section className="rounded-xl bg-surface px-4 py-3.5 ring-1 ring-border/50">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <span className="text-[12px] font-semibold">
                {t("tracker.row.suggest")}
              </span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {t(SUGGEST_KEY[row.suggestion])}
            </p>
          </section>

          <div className="flex items-baseline justify-between gap-3 border-t border-border/60 pt-3">
            <span className="text-[11px] text-muted-foreground">
              {t("tracker.detail.wastedTotal", {
                tokens: format.formatTokens(wastedTokens),
              })}
            </span>
            <span
              className="tt-num font-mono text-[16px] font-black"
              style={{ color: tone.accent }}
            >
              {format.formatNumber(wastedTokens)}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FormulaChip({
  value,
  emphasized = false,
}: {
  value: string;
  emphasized?: boolean;
}) {
  return (
    <span
      className={`rounded-md px-2 py-1 font-mono text-[11px] font-semibold ${
        emphasized
          ? "bg-card text-foreground ring-1 ring-border/70"
          : "bg-card/70 text-foreground/80"
      }`}
    >
      {value}
    </span>
  );
}

function FormulaOperator({ value }: { value: string }) {
  return (
    <span className="px-0.5 font-mono text-[11px] text-muted-foreground">
      {value}
    </span>
  );
}
