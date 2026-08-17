import { Link } from "@tanstack/react-router";
import { LayoutDashboard, Settings } from "lucide-react";

import { useI18n } from "../../../lib/i18n/context";
import { WidgetThemeScope } from "./widget-theme";
import { useWidgetData } from "./widget-data";

type Cell = { label: string; value: string; sub: string };

/**
 * 托盘迷你形态（macOS 菜单栏弹窗 420px）：
 * 今日 / 7 天 / 30 天 / 总计 四个 Token 指标 + 今日工具 Top + 底部操作。
 * 全部来自真实数据源，无 mock 回退。
 */
export function TrayWidget({ className = "" }: { className?: string }) {
  const { t, format } = useI18n();
  const { today, week, month, total, hasData, loading } = useWidgetData();

  const cells: Cell[] = [
    {
      label: t("widget.trayToday"),
      value: format.formatTokens(today.tokens),
      sub: today.costUsd == null ? "—" : format.formatUsd(today.costUsd),
    },
    {
      label: t("widget.trayWeek"),
      value: format.formatTokens(week.tokens),
      sub: t("widget.trayPerDay", {
        tokens: format.formatTokens(Math.round(week.tokens / 7)),
      }),
    },
    {
      label: t("widget.trayMonth"),
      value: format.formatTokens(month.tokens),
      sub: t("widget.trayPerDay", {
        tokens: format.formatTokens(Math.round(month.tokens / 30)),
      }),
    },
    {
      label: t("widget.trayTotal"),
      value: format.formatTokens(total.tokens),
      sub: total.costUsd == null ? "—" : format.formatUsd(total.costUsd),
    },
  ];

  return (
    <WidgetThemeScope>
      <div
        className={`w-[420px] shrink-0 overflow-hidden rounded-[var(--radius)] border border-border bg-card ${className}`}
      >
        {/* 头部 */}
        <header className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-foreground font-mono text-[10px] font-black text-background">
              TT
            </span>
            <span className="truncate text-[13px] font-semibold tracking-tight">
              {t("widget.title")}
            </span>
          </div>
          <Link
            to="/settings"
            title={t("widget.openSettings")}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Settings className="size-3.5" strokeWidth={1.75} />
          </Link>
        </header>

        {/* 指标 */}
        {!hasData && !loading ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <p className="text-[13px] font-medium">{t("widget.noData")}</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {t("widget.noDataDesc")}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-px bg-border/40 px-px py-px">
              {cells.map((cell) => (
                <div key={cell.label} className="bg-card px-3 py-3">
                  <div className="font-mono text-[9.5px] tracking-[0.12em] text-muted-foreground/70 uppercase">
                    {cell.label}
                  </div>
                  <div className="tt-num mt-1.5 font-mono text-[17px] leading-none font-semibold tracking-tight">
                    {cell.value}
                  </div>
                  <div className="tt-num mt-1.5 font-mono text-[10.5px] text-muted-foreground">
                    {cell.sub}
                  </div>
                </div>
              ))}
            </div>

            {/* 今日工具 Top */}
            <section className="border-t border-border/50 px-4 pt-3 pb-3.5">
              <div className="font-mono text-[9.5px] tracking-[0.16em] text-muted-foreground/70 uppercase">
                {t("widget.dwToolTop", { count: 3 })}
              </div>
              <div className="mt-2.5 space-y-2">
                {today.topTools.length === 0 ? (
                  <div className="py-2 font-mono text-[11px] text-muted-foreground">
                    {t("widget.noData")}
                  </div>
                ) : (
                  today.topTools.slice(0, 3).map((tool) => (
                    <div key={tool.id}>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                          {tool.name}
                        </span>
                        <span className="tt-num font-mono text-[11px] text-muted-foreground">
                          {format.formatTokens(tool.tokens)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="tt-num w-16 shrink-0 font-mono text-[10px] text-muted-foreground/70">
                          {format.formatNumber(tool.events)}{" "}
                          {t("widget.events")}
                        </span>
                        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full bg-foreground/40"
                            style={{
                              width: `${Math.max(
                                4,
                                Math.round(
                                  (tool.tokens /
                                    Math.max(
                                      today.topTools[0]?.tokens ?? 1,
                                      1,
                                    )) *
                                    100,
                                ),
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="tt-num w-16 shrink-0 text-right font-mono text-[10px] text-muted-foreground/70">
                          {tool.costUsd == null
                            ? "—"
                            : format.formatUsd(tool.costUsd)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}

        {/* 底部 */}
        <footer className="flex items-center justify-between border-t border-border/50 px-4 py-2.5">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-[12px] text-foreground transition-colors hover:text-muted-foreground"
          >
            <LayoutDashboard className="size-3.5" strokeWidth={1.75} />
            {t("widget.trayOpen")}
          </Link>
          <Link
            to="/settings"
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-danger"
          >
            <Settings className="size-3.5" strokeWidth={1.75} />
            {t("widget.openSettings")}
          </Link>
        </footer>
      </div>
    </WidgetThemeScope>
  );
}
