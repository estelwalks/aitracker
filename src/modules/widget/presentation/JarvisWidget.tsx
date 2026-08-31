import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  FileText,
  LayoutDashboard,
  RefreshCw,
  ScanLine,
  Settings2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { useI18n } from "../../../lib/i18n/context";
import { usePageInsight } from "../../insights/index.ts";
import { setWidgetPref, useWidgetPrefs, type WidgetTab } from "./widget-prefs";
import { WidgetThemeScope } from "./widget-theme";
import { WidgetConfigPanel } from "./WidgetConfigPanel";
import { useWidgetData, useWidgetMood } from "./widget-data";

type Mood = "idle" | "live" | "warn" | "danger";

/** Neutral status markers: shield icon + status point (breathing animation is turned off by orbAnim). */
function SoulPulse({ mood, anim }: { mood: Mood; anim: boolean }) {
  const active = mood !== "idle";
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2">
      <ShieldCheck
        className={`size-4 ${active ? "text-foreground" : "text-muted-foreground"}`}
        strokeWidth={1.75}
      />
      <span
        className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-card ${
          active ? "bg-ok" : "bg-muted-foreground"
        } ${anim && active ? "aitracker-breathe" : ""}`}
      />
    </span>
  );
}

/** Typewriter rotates word by word; manual switch when rotate=0. */
function JarvisText({ lines, rotate }: { lines: string[]; rotate: number }) {
  const { t } = useI18n();
  const [idx, setIdx] = useState(0);
  const [n, setN] = useState(0);

  useEffect(() => {
    setIdx(0);
    setN(0);
  }, [lines]);

  const text = lines[idx % lines.length] ?? "";

  useEffect(() => {
    if (n < text.length) {
      const timer = setTimeout(() => setN((value) => value + 1), 34);
      return () => clearTimeout(timer);
    }
    return;
  }, [n, text]);

  useEffect(() => {
    if (rotate <= 0) return;
    const timer = setTimeout(() => {
      setIdx((value) => value + 1);
      setN(0);
    }, rotate * 1000);
    return () => clearTimeout(timer);
  }, [rotate, idx]);

  return (
    <div className="flex items-start gap-2">
      <p className="min-h-[38px] flex-1 text-[12.5px] leading-relaxed text-foreground/90">
        {text.slice(0, n)}
        <span className="ml-0.5 inline-block h-3 w-[2px] translate-y-[1px] bg-ok align-middle aitracker-breathe" />
      </p>
      {rotate <= 0 && (
        <button
          type="button"
          title={t("widget.nextLine")}
          onClick={() => {
            setIdx((value) => value + 1);
            setN(0);
          }}
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-surface-2/50 px-3 py-3">
      <div className="font-mono text-[9.5px] tracking-[0.14em] text-muted-foreground/70 uppercase">
        {title}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return (
    <div className="flex h-14 items-center justify-center font-mono text-[11px] text-muted-foreground">
      {text}
    </div>
  );
}

function Row({
  name,
  value,
  sub,
  ratio,
}: {
  name: string;
  value: string;
  sub?: string;
  ratio: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[92px] shrink-0 truncate text-[12px]">{name}</span>
      <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
        <span
          className="block h-full rounded-full bg-foreground/45"
          style={{ width: `${Math.max(4, Math.round(ratio * 100))}%` }}
        />
      </span>
      <span className="aitracker-num shrink-0 font-mono text-[11px]">
        {value}
      </span>
      {sub && (
        <span className="aitracker-num w-9 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
          {sub}
        </span>
      )}
    </div>
  );
}

/** Security Tab: Overview of real security scans. */
function SafetyCards() {
  const { t, format } = useI18n();
  const { security } = useWidgetData();
  const summary = security.summary;

  return (
    <div className="space-y-3">
      <Card title={t("widget.securityTitle")}>
        {summary == null ? (
          <EmptyText text={t("widget.noData")} />
        ) : (
          <>
            <div className="aitracker-num flex flex-wrap items-baseline gap-x-2 font-mono text-[12px]">
              <span className="text-[15px] font-semibold">
                {security.coverage}
              </span>
              <span className="text-muted-foreground">
                {t("widget.scannedSkills", { count: security.coverage })}
              </span>
              <span className="opacity-30">·</span>
              <span className="text-ok">
                {t("widget.safeCount", { count: summary.cleanCount })}
              </span>
              <span className="opacity-30">·</span>
              <span className="text-muted-foreground">
                {t("widget.suspiciousCount", {
                  count: summary.suspiciousCount,
                })}
              </span>
              <span className="opacity-30">·</span>
              <span className="font-semibold text-foreground">
                {t("widget.dangerCount", { count: summary.dangerousCount })}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">
              {t("widget.lastScan", {
                time: format.formatDateTime(summary.assessedAt, false),
              })}{" "}
              · {t("widget.securityRuns", { count: security.runCount })}
            </div>
          </>
        )}
      </Card>

      <Link
        to="/security"
        className="flex items-center justify-between rounded-xl bg-surface-2/50 px-3 py-2.5 transition-colors hover:bg-surface-2"
      >
        <span className="flex items-center gap-2 text-[12px]">
          <ScanLine
            className="size-3.5 text-muted-foreground"
            strokeWidth={1.75}
          />
          {t("widget.scanNow")}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {t("widget.goScan")} →
        </span>
      </Link>
    </div>
  );
}

/** Usage Tab: Today’s Token / Cost / Session + Tool Usage. */
function UsageCards() {
  const { t, format } = useI18n();
  const { today, total } = useWidgetData();
  const top = today.topTools;
  const max = top[0]?.tokens || 1;

  const cells: [string, string][] = [
    [format.formatTokens(today.tokens), t("widget.totalTokens")],
    [
      today.costUsd == null ? "—" : format.formatUsd(today.costUsd),
      t("widget.estimatedCost"),
    ],
    [
      today.sessions == null ? "—" : format.formatNumber(today.sessions),
      t("widget.sessions"),
    ],
  ];

  return (
    <div className="space-y-3">
      <Card title={t("widget.usageTitle")}>
        <div className="grid grid-cols-3 gap-2">
          {cells.map(([value, label]) => (
            <div key={label}>
              <div className="aitracker-num font-mono text-[16px] leading-none font-semibold">
                {value}
              </div>
              <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                {label}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 font-mono text-[10.5px] text-muted-foreground">
          {t("widget.todayTokens", {
            tokens: format.formatTokens(total.tokens),
          })}
        </div>
      </Card>

      <Card title={t("widget.toolsUsage")}>
        {top.length === 0 ? (
          <EmptyText text={t("widget.noData")} />
        ) : (
          <div className="space-y-2">
            {top.slice(0, 4).map((tool) => (
              <Row
                key={tool.id}
                name={tool.name}
                value={format.formatTokens(tool.tokens)}
                sub={`${format.formatNumber(tool.events)}`}
                ratio={tool.tokens / max}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** Today's Tab: Tool/Session/Token Summary + 7-Day Trend + Today's Tool Distribution. */
function TodayCards() {
  const { t, format } = useI18n();
  const { today, week } = useWidgetData();
  const trend = week.trend;
  const max = Math.max(...trend.map((point) => point.tokens), 1);

  const cells: [string, string][] = [
    [format.formatNumber(today.topTools.length), t("widget.toolCount")],
    [
      today.sessions == null ? "—" : format.formatNumber(today.sessions),
      t("widget.sessionCount"),
    ],
    [format.formatTokens(today.tokens), t("widget.tokenCount")],
    [format.formatNumber(today.events), t("widget.events")],
  ];

  return (
    <div className="space-y-3">
      <Card title={t("widget.todaySummary")}>
        <div className="grid grid-cols-4 gap-2">
          {cells.map(([value, label]) => (
            <div key={label} className="min-w-0">
              <div className="aitracker-num font-mono text-[16px] leading-none font-semibold">
                {value}
              </div>
              <div className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">
                {label}
              </div>
            </div>
          ))}
        </div>
        {trend.length > 0 && (
          <div className="mt-2.5 flex items-end gap-2">
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {t("widget.last7d")}
            </span>
            <div className="flex h-6 flex-1 items-end gap-[3px]">
              {trend.map((point, index) => (
                <span
                  key={point.date}
                  className={`flex-1 rounded-[1px] ${
                    index === trend.length - 1
                      ? "bg-foreground/70"
                      : "bg-foreground/25"
                  }`}
                  style={{
                    height: `${Math.max(8, (point.tokens / max) * 100)}%`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </Card>

      {today.topTools.length > 0 && (
        <Card title={t("widget.todayByTool")}>
          <div className="space-y-2">
            {today.topTools.slice(0, 3).map((tool) => (
              <Row
                key={tool.id}
                name={tool.name}
                value={format.formatTokens(tool.tokens)}
                sub={format.formatNumber(tool.events)}
                ratio={tool.tokens / (today.topTools[0]?.tokens || 1)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Broadcast copy: changes with the current Tab and tone (casual/concise); returns an empty array when off. */
function useJarvisLines(tab: WidgetTab): string[] {
  const { t, format } = useI18n();
  const { prefs } = useWidgetPrefs();
  const { today, total, security } = useWidgetData();

  if (prefs.tone === "off") return [];
  const casual = prefs.tone !== "concise";
  const danger = security.summary?.dangerousCount ?? 0;
  const suspicious = security.summary?.suspiciousCount ?? 0;
  const scanned = security.coverage;
  const top = today.topTools[0];
  const sessions = today.sessions;

  if (tab === "safety") {
    if (danger > 0) {
      return [
        t(casual ? "widget.jarvisDanger" : "widget.jarvisDangerConcise", {
          count: danger,
        }),
        t(
          casual ? "widget.jarvisSuspicious" : "widget.jarvisSuspiciousConcise",
          { count: suspicious },
        ),
      ];
    }
    if (scanned > 0) {
      return [
        t(casual ? "widget.jarvisAllClear" : "widget.jarvisAllClearConcise", {
          count: scanned,
        }),
        t(casual ? "widget.jarvisIdle" : "widget.jarvisIdleConcise"),
      ];
    }
    return [t(casual ? "widget.jarvisIdle" : "widget.jarvisIdleConcise")];
  }

  const lines: string[] = [];
  if (top) {
    lines.push(
      t(casual ? "widget.jarvisTopTool" : "widget.jarvisTopToolConcise", {
        name: top.name,
        tokens: format.formatTokens(top.tokens),
      }),
    );
  }
  if (sessions != null) {
    lines.push(
      t(casual ? "widget.jarvisSessionsLine" : "widget.jarvisSessionsConcise", {
        count: sessions,
      }),
    );
  }
  lines.push(
    t(casual ? "widget.jarvisTotal" : "widget.jarvisTotalConcise", {
      tokens: format.formatTokens(today.tokens || total.tokens),
    }),
  );
  return lines;
}

/** Floating window 420px: Jarvis broadcast + security/usage/today three tabs + permanent at the bottom. */
export function JarvisWidget({
  className = "",
  onOpenSettings,
}: {
  className?: string;
  onOpenSettings?: () => void;
}) {
  const { t, format, locale } = useI18n();
  const { prefs } = useWidgetPrefs();
  const { today, total, security, hasData, loading, generatedAt, refresh } =
    useWidgetData();
  const { lines: widgetInsightLines } = usePageInsight({
    surfaceId: "widget",
    locale,
  });
  const [tab, setTab] = useState<WidgetTab>(
    prefs.defaultTab === "last" ? prefs.lastTab : prefs.defaultTab,
  );
  const [cfgOpen, setCfgOpen] = useState(false);
  const mood = useWidgetMood();

  useEffect(() => {
    if (prefs.defaultTab !== "last") setTab(prefs.defaultTab);
  }, [prefs.defaultTab]);

  const pick = (next: WidgetTab) => {
    setTab(next);
    setWidgetPref("lastTab", next);
  };

  const localLines = useJarvisLines(tab);
  const lines = widgetInsightLines.length
    ? widgetInsightLines.map((line) => line.text)
    : localLines;
  const danger = security.summary?.dangerousCount ?? 0;
  const stamp = loading
    ? t("common.loading")
    : generatedAt == null
      ? t("widget.noData")
      : t("widget.updatedAt", {
          time: format.formatDateTime(generatedAt, false),
        });

  const tabBadges: [WidgetTab, string][] = [
    ["today", format.formatTokens(today.tokens)],
    ["usage", format.formatTokens(total.tokens)],
    ["safety", danger > 0 ? format.formatNumber(danger) : "✓"],
  ];

  return (
    <WidgetThemeScope>
      <div
        className={`w-[420px] shrink-0 overflow-hidden rounded-[var(--radius)] border border-border bg-card ${className}`}
      >
        {/* 头部：标题 · 更新时间 · 刷新 / 设置 */}
        <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
          <SoulPulse mood={mood} anim />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold tracking-tight">
              {t("widget.title")}
            </div>
            <div className="font-mono text-[10.5px] text-muted-foreground">
              {stamp}
            </div>
          </div>
          <button
            type="button"
            title={t("widget.refresh")}
            onClick={refresh}
            className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title={t("widget.widgetSettings")}
            onClick={() =>
              onOpenSettings ? onOpenSettings() : setCfgOpen((value) => !value)
            }
            className={`flex size-7 items-center justify-center rounded-full bg-surface-2 transition-colors ${
              cfgOpen
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Settings2 className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>

        {cfgOpen ? (
          <div className="aitracker-scroll max-h-[460px] overflow-y-auto px-4 py-3">
            <WidgetConfigPanel sections={["bar", "panel"]} />
            <button
              type="button"
              onClick={() => setCfgOpen(false)}
              className="mt-3 w-full rounded-[10px] bg-surface-2 py-2 text-[12px] transition-colors hover:bg-surface-2/70"
            >
              {t("widget.backToPanel")}
            </button>
          </div>
        ) : (
          <div className="aitracker-scroll max-h-[560px] space-y-3 overflow-y-auto px-4 py-3">
            {!hasData && !loading ? (
              <div className="flex flex-col items-center justify-center rounded-xl bg-surface-2/50 px-4 py-10 text-center">
                <p className="text-[13px] font-medium">{t("widget.noData")}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {t("widget.noDataDesc")}
                </p>
              </div>
            ) : (
              <>
                {prefs.tone === "off" ? (
                  <p className="font-mono text-[11.5px] text-muted-foreground">
                    {t("widget.todayTokens", {
                      tokens: format.formatTokens(today.tokens),
                    })}{" "}
                    ·{" "}
                    {danger > 0
                      ? t("widget.riskCount", { count: danger })
                      : t("widget.safe")}
                  </p>
                ) : (
                  <JarvisText lines={lines} rotate={prefs.rotate} />
                )}

                {/* 三条价值主线：今日 / 用量 / 安全 */}
                <div className="grid grid-cols-3 gap-1 rounded-[10px] border border-border/60 bg-surface-2 p-1">
                  {tabBadges.map(([key, badge]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pick(key)}
                      className={`flex items-center justify-center gap-1.5 rounded-[8px] py-1.5 text-[12px] transition-colors ${
                        tab === key
                          ? "border border-border bg-background text-foreground"
                          : "border border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t(
                        key === "safety"
                          ? "widget.tabSecurity"
                          : key === "usage"
                            ? "widget.tabUsage"
                            : "widget.tabToday",
                      )}
                      {key !== "safety" && (
                        <span
                          className={`aitracker-num font-mono text-[10.5px] ${
                            tab === key
                              ? "text-foreground/70"
                              : "text-muted-foreground/70"
                          }`}
                        >
                          {badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {tab === "today" && <TodayCards />}
                {tab === "usage" && <UsageCards />}
                {tab === "safety" && <SafetyCards />}
              </>
            )}
          </div>
        )}

        {/* 底部常驻 */}
        <div className="border-t border-border/50">
          <div className="flex items-center gap-3 px-4 py-2.5 font-mono text-[11px]">
            <span className="aitracker-num">
              <span className="text-[13px] font-semibold">
                {today.activeTools}
              </span>
              <span className="ml-1 text-muted-foreground">
                {t("widget.dwActive", { count: today.activeTools })}
              </span>
            </span>
            <span className="opacity-30">·</span>
            <span className="aitracker-num">
              {format.formatTokens(total.tokens)}
            </span>
            <span className="opacity-30">·</span>
            <span className="inline-flex items-center gap-1 text-muted-foreground/70">
              {danger > 0 ? (
                <ShieldAlert
                  className="size-3.5 text-danger"
                  strokeWidth={1.75}
                />
              ) : (
                <ShieldCheck className="size-3.5 text-ok" strokeWidth={1.75} />
              )}
              <span className="aitracker-num text-[10.5px]">
                {danger > 0
                  ? t("widget.riskCount", { count: danger })
                  : t("widget.safe")}
              </span>
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-border/50 px-3 py-2.5">
            <Link
              to="/security"
              className="flex items-center justify-center gap-1.5 rounded-[10px] border border-border bg-surface-2 py-2 text-[12px] text-foreground transition-colors hover:bg-surface-2/70"
            >
              <ScanLine className="size-3.5" strokeWidth={1.75} />
              {t("widget.scanNow")}
            </Link>
            <Link
              to="/reports"
              className="flex items-center justify-center gap-1.5 rounded-[10px] border border-border py-2 text-[12px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <FileText className="size-3.5" strokeWidth={1.75} />
              {t("widget.generateReport")}
            </Link>
            <Link
              to="/"
              className="flex items-center justify-center gap-1.5 rounded-[10px] border border-border py-2 text-[12px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <LayoutDashboard className="size-3.5" strokeWidth={1.75} />
              {t("widget.openDashboard")}
            </Link>
          </div>
        </div>
      </div>
    </WidgetThemeScope>
  );
}
