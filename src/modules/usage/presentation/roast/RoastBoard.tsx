import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Flame, Minus } from "lucide-react";

import { BrandIcon } from "../../../../components/BrandIcon";
import { brandColorOf } from "../../../../components/BrandIcon.helpers";
import { ChipTabs, EmptyState, Panel } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import type {
  RoastDimension,
  RoastRow,
  TrackerBoard,
} from "../../application/tracker.ts";
import { WasteDetail } from "./WasteDetail.tsx";

const DIMENSIONS: RoastDimension[] = ["project", "session", "skill"];

const SUGGEST_KEY: Record<RoastRow["suggestion"], MessageKey> = {
  cache: "tracker.suggest.cache",
  output: "tracker.suggest.output",
  volume: "tracker.suggest.volume",
  none: "tracker.suggest.none",
};

const DIMENSION_KEY: Record<RoastDimension, MessageKey> = {
  skill: "tracker.board.skill",
  project: "tracker.board.project",
  session: "tracker.board.session",
};

const DIMENSION_SUB_KEY: Record<RoastDimension, MessageKey> = {
  skill: "tracker.board.skillSub",
  project: "tracker.board.projectSub",
  session: "tracker.board.sessionSub",
};

const TREND_KEY: Record<NonNullable<RoastRow["trend"]>, MessageKey> = {
  up: "tracker.row.trendUp",
  down: "tracker.row.trendDown",
  flat: "tracker.row.trendFlat",
};

/** 浪费指数徽标配色：越高越危险（与原型阈值一致）。 */
function wasteBadge(waste: number): string {
  if (waste >= 45) return "bg-danger/15 text-danger";
  if (waste >= 28) return "bg-warn/15 text-warn";
  return "bg-ok/15 text-ok";
}

function TrendBadge({ row }: { row: RoastRow }) {
  const { t } = useI18n();
  if (row.trend === null) {
    return <Minus className="size-3.5 text-muted-foreground/50" />;
  }
  const Icon =
    row.trend === "up"
      ? ArrowUpRight
      : row.trend === "down"
        ? ArrowDownRight
        : Minus;
  const color =
    row.trend === "up"
      ? "text-danger"
      : row.trend === "down"
        ? "text-ok"
        : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-0.5 ${color}`}>
      <Icon className="size-3.5" />
      <span className="sr-only">{t(TREND_KEY[row.trend])}</span>
    </span>
  );
}

/** 3-tab token board: project / session / skill, ranked by token usage. */
export function RoastBoard({
  boards,
  dimension,
  onDimensionChange,
}: {
  boards: Record<RoastDimension, TrackerBoard>;
  dimension: RoastDimension;
  onDimensionChange: (dimension: RoastDimension) => void;
}) {
  const { t, format } = useI18n();
  const [selected, setSelected] = useState<RoastRow | null>(null);

  useEffect(() => {
    setSelected(null);
  }, [dimension]);

  const rows = boards[dimension].rows;
  const options = DIMENSIONS.map((value) => ({
    value,
    label: t(DIMENSION_KEY[value]),
  }));
  // 用 reduce 代替 Math.max(...) 展开：会话榜行数可能很大，避免栈溢出。
  const maxTok = rows.reduce((max, row) => Math.max(max, row.tokens), 1);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warn/15">
            <Flame className="size-4 text-warn" strokeWidth={2} />
          </span>
          <span className="text-[13px] font-semibold tracking-tight">
            {t(DIMENSION_KEY[dimension])}
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {t(DIMENSION_SUB_KEY[dimension])}
          </span>
        </span>
      }
    >
      <ChipTabs
        value={dimension}
        onChange={onDimensionChange}
        options={options}
        className="mb-3"
      />
      {rows.length === 0 ? (
        <EmptyState title={t("tracker.empty")} desc={t("tracker.emptyDesc")} />
      ) : (
        <ol className="space-y-2">
          {rows.map((row, index) => {
            const top = index < 3;
            const pct = Math.max(6, Math.round((row.tokens / maxTok) * 100));
            const badge = wasteBadge(row.waste);
            const agent = row.source ?? row.name;
            return (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  className={`relative w-full cursor-pointer overflow-hidden rounded-xl px-3.5 py-3 text-left transition-colors ${
                    top ? "bg-surface-2" : "bg-surface"
                  } hover:bg-accent/40`}
                >
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-primary/10 to-transparent"
                    style={{ width: `${pct}%` }}
                    aria-hidden="true"
                  />
                  <div className="relative flex items-center gap-3">
                    <span
                      className={`tt-num w-7 shrink-0 text-center font-mono font-black leading-none ${
                        top
                          ? "text-2xl text-primary"
                          : "text-lg text-muted-foreground/60"
                      }`}
                    >
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-semibold">
                          {row.name}
                        </span>
                        <BrandIcon
                          name={agent}
                          className="size-3 shrink-0"
                          color={brandColorOf(agent)}
                        />
                        {row.source && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {row.source}
                          </span>
                        )}
                        <span
                          className={`ml-1 shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${badge}`}
                        >
                          {row.waste.toFixed(1)}%
                        </span>
                        <TrendBadge row={row} />
                      </div>

                      <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                        {t("tracker.row.calls", { count: row.calls })}
                        {" · "}
                        {t("tracker.row.tokens", {
                          count: format.formatTokens(row.tokens),
                        })}
                        {" · "}
                        {t(SUGGEST_KEY[row.suggestion])}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="tt-num font-mono text-[13px] font-black text-foreground">
                        {format.formatTokens(row.tokens)}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {t("tracker.row.suggest")}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {selected && (
        <WasteDetail row={selected} onClose={() => setSelected(null)} />
      )}
    </Panel>
  );
}
