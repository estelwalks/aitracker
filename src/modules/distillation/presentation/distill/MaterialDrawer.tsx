import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../../components/ui/sheet";
import { Dot, EmptyState, TTButton } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import type { DistillationSessionItem } from "../index.ts";

const MAX_SELECTION = 8;

/**
 * Session-level material picker. Per the privacy boundary the module exposes
 * only sanitised session metadata — individual message content is never read,
 * so the picker selects whole sessions rather than message segments (the
 * prototype's segment-level selection is explicitly not supported here).
 */
export function MaterialDrawer({
  sessions,
  selected,
  onToggle,
  onClose,
}: {
  sessions: readonly DistillationSessionItem[];
  selected: ReadonlySet<string>;
  onToggle: (item: DistillationSessionItem) => void;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return sessions;
    return sessions.filter(
      (item) =>
        item.title.toLocaleLowerCase().includes(needle) ||
        item.source.toLocaleLowerCase().includes(needle) ||
        item.projectKey.toLocaleLowerCase().includes(needle),
    );
  }, [sessions, query]);

  const keyOf = (item: { source: string; sessionId: string }) =>
    `${item.source}:${item.sessionId}`;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="px-5 pt-5">
          <SheetTitle>
            {t("common.distillation.materialDrawerTitle")}
          </SheetTitle>
          <SheetDescription>
            {t("common.distillation.materialSegmentUnavailable")}
          </SheetDescription>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("common.distillation.selectSessions", {
                max: MAX_SELECTION,
              })}
              aria-label={t("common.distillation.selectSessions", {
                max: MAX_SELECTION,
              })}
              className="h-9 w-full rounded-lg bg-surface-2/70 pr-3 pl-8 text-[13px] outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {filtered.length === 0 ? (
            <EmptyState
              title={t("common.distillation.noSessions")}
              desc={t("common.distillation.noSessionsDesc")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((item) => {
                const key = keyOf(item);
                const checked = selected.has(key);
                const disabled = !checked && selected.size >= MAX_SELECTION;
                return (
                  <li key={key} className="py-2.5">
                    <label
                      className={`flex items-start gap-3 cursor-pointer ${disabled ? "opacity-40" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => onToggle(item)}
                        className="mt-1 size-3.5 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {item.title}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-muted-foreground">
                          <Dot className="bg-primary" />
                          <span>
                            {item.source}:{item.sessionId}
                          </span>
                          <span>
                            {t("common.distillation.selectedTurns", {
                              count: item.turns,
                            })}
                          </span>
                          <span>
                            {format.formatDateTime(item.startedAt, false)}
                          </span>
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span className="text-[11px] text-muted-foreground">
            {t("common.distillation.selected", { count: selected.size })}
          </span>
          <TTButton variant="primary" onClick={onClose}>
            {t("common.close")}
          </TTButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
