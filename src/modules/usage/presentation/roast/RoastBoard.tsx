import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { ChipTabs, EmptyState, Panel } from "../../../../components/tt";
import { BrandIcon } from "../../../../components/BrandIcon";
import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import type {
  RoastDimension,
  RoastRow,
  TrackerBoard,
} from "../../application/tracker.ts";
import { WasteDetail } from "./WasteDetail.tsx";

const DIMENSIONS: RoastDimension[] = ["skill", "project", "session"];

const DIMENSION_KEY: Record<RoastDimension, MessageKey> = {
  skill: "tracker.board.skill",
  project: "tracker.board.project",
  session: "tracker.board.session",
};

const TREND_KEY: Record<NonNullable<RoastRow["trend"]>, MessageKey> = {
  up: "tracker.row.trendUp",
  down: "tracker.row.trendDown",
  flat: "tracker.row.trendFlat",
};

function wasteTone(waste: number): { text: string; bar: string } {
  if (waste >= 60) return { text: "text-danger", bar: "bg-danger/70" };
  if (waste >= 30) return { text: "text-warn", bar: "bg-warn/70" };
  return { text: "text-ok", bar: "bg-ok/70" };
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

/** 3-tab waste board: skill / project / session, ranked by waste index. */
export function RoastBoard({
  boards,
}: {
  boards: Record<RoastDimension, TrackerBoard>;
}) {
  const { t, format } = useI18n();
  const [dimension, setDimension] = useState<RoastDimension>("skill");
  const [selected, setSelected] = useState<RoastRow | null>(null);

  const rows = boards[dimension].rows;
  const options = DIMENSIONS.map((value) => ({
    value,
    label: t(DIMENSION_KEY[value]),
  }));

  return (
    <Panel
      title={t("tracker.title")}
      action={
        <ChipTabs value={dimension} onChange={setDimension} options={options} />
      }
    >
      {rows.length === 0 ? (
        <EmptyState title={t("tracker.empty")} desc={t("tracker.emptyDesc")} />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row, index) => {
            const tone = wasteTone(row.waste);
            return (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  className="relative flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 overflow-hidden px-3 py-3 text-left transition-colors hover:bg-surface-2/60"
                >
                  <span
                    className="absolute inset-y-0 left-0 bg-foreground/[0.04]"
                    style={{ width: `${Math.min(100, row.waste)}%` }}
                    aria-hidden="true"
                  />
                  <span className="tt-num w-6 shrink-0 font-mono text-[13px] font-black text-muted-foreground/60">
                    {index + 1}
                  </span>
                  <BrandIcon
                    name={row.source ?? row.name}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-[120px] flex-1 truncate text-[13px] font-medium">
                    {row.name}
                  </span>
                  <TrendBadge row={row} />
                  <span
                    className={`tt-num w-12 text-right font-mono text-[13px] font-black ${tone.text}`}
                  >
                    {row.waste.toFixed(1)}
                  </span>
                  <span className="tt-num w-24 text-right font-mono text-[11px] text-muted-foreground">
                    {format.formatNumber(row.tokens)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected && (
        <WasteDetail row={selected} onClose={() => setSelected(null)} />
      )}
    </Panel>
  );
}
