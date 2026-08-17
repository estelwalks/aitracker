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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("tracker.detail.wasteDetail", { waste: row.waste.toFixed(1) })}
          </DialogTitle>
          <DialogDescription>
            <span className="tt-num font-mono text-[13px] text-muted-foreground">
              {row.name}
            </span>
            {" · "}
            {t("tracker.detail.wasteExplain")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-[13px]">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <dt className="text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                {t("tracker.row.tokens", { count: row.tokens })}
              </dt>
              <dd className="tt-num mt-0.5 font-mono font-bold">
                {format.formatNumber(row.tokens)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                {t("tracker.row.events", { count: row.events })}
              </dt>
              <dd className="tt-num mt-0.5 font-mono font-bold">
                {format.formatNumber(row.events)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                {t("tracker.row.waste")}
              </dt>
              <dd className="tt-num mt-0.5 font-mono font-bold">
                {row.waste.toFixed(1)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                {t("tracker.row.cacheRate", {
                  rate: row.cacheRate?.toFixed(1) ?? "—",
                })}
              </dt>
              <dd className="tt-num mt-0.5 font-mono font-bold">
                {row.cacheRate == null ? "—" : `${row.cacheRate.toFixed(1)}%`}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                {t("tracker.row.outputRatio", {
                  ratio: row.outputRatio.toFixed(2),
                })}
              </dt>
              <dd className="tt-num mt-0.5 font-mono font-bold">
                {(row.outputRatio * 100).toFixed(0)}%
              </dd>
            </div>
            {row.previousTokens != null && (
              <div>
                <dt className="text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                  {t("tracker.row.trendNa")}
                </dt>
                <dd className="tt-num mt-0.5 font-mono font-bold">
                  {format.formatNumber(row.previousTokens)}
                </dd>
              </div>
            )}
          </dl>

          <p className="rounded-lg bg-surface-2/70 px-3 py-2.5 font-mono text-[12.5px] text-muted-foreground">
            {t("tracker.detail.wastedTotal", {
              tokens: format.formatTokens(wastedTokens),
            })}
          </p>

          <div className="rounded-lg bg-surface-2/70 px-3 py-2.5 text-[12.5px] text-muted-foreground">
            {t(SUGGEST_KEY[row.suggestion])}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
