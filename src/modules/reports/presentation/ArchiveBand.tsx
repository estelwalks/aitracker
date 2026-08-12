import { ChevronLeft, ChevronRight } from "lucide-react";

import { SearchInput, Segmented } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import type { PeriodGranularity } from "../period.ts";

export interface ArchiveBlock {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly archived: boolean;
}

/**
 * 吸顶历史归档带 (sticky history archive band). Day/week/month segmented +
 * search + a horizontal timeline strip of period blocks driven by real data:
 * each block shows the period label, the session density ("n 场") and a green
 * dot when a report is archived in that period. Arrows page the timeline
 * window; clicking a block selects that period for the report body.
 */
export function ArchiveBand({
  granularity,
  onGranularity,
  search,
  onSearch,
  blocks,
  selectedKey,
  onSelect,
  onPrev,
  onNext,
}: {
  granularity: PeriodGranularity;
  onGranularity: (granularity: PeriodGranularity) => void;
  search: string;
  onSearch: (search: string) => void;
  blocks: readonly ArchiveBlock[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  return (
    <section
      aria-label={t("reports.archive.title")}
      className="sticky top-14 z-30 -mx-4 border-b border-border/60 bg-background px-4 py-3 md:-mx-8 md:px-8"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<PeriodGranularity>
          value={granularity}
          onChange={onGranularity}
          options={[
            { value: "day", label: t("reports.archive.day") },
            { value: "week", label: t("reports.archive.week") },
            { value: "month", label: t("reports.archive.month") },
          ]}
        />
        <SearchInput
          value={search}
          onChange={onSearch}
          placeholder={t("reports.archive.search")}
          ariaLabel={t("reports.archive.search")}
          className="ml-auto w-full sm:w-64"
        />
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPrev}
          aria-label={t("reports.archive.prev")}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="tt-xscroll flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
          {blocks.map((block) => {
            const active = block.key === selectedKey;
            return (
              <button
                key={block.key}
                type="button"
                onClick={() => onSelect(block.key)}
                aria-pressed={active}
                title={`${block.label} · ${t("reports.archive.sessions", {
                  count: block.count,
                })}`}
                className={`group flex min-w-0 shrink-0 flex-col items-start gap-1 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                  active
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/60 bg-surface-2/40 hover:bg-surface-2"
                }`}
              >
                <span className="flex w-full items-center justify-between gap-1.5">
                  <span
                    className={`truncate text-[11px] font-medium ${
                      active ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {block.label}
                  </span>
                  {block.archived && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-ok"
                      title={t("reports.archive.archived")}
                      aria-label={t("reports.archive.archived")}
                    />
                  )}
                </span>
                <span className="tt-num text-[10px] text-muted-foreground">
                  {block.count > 0
                    ? t("reports.archive.sessions", { count: block.count })
                    : t("reports.archive.empty")}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onNext}
          aria-label={t("reports.archive.next")}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </section>
  );
}
