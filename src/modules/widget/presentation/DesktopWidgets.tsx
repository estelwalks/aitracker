import {
  BookHeart,
  Brain,
  Gauge,
  MessagesSquare,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "../../../lib/i18n/context";
import { useWidgetPrefs } from "./widget-prefs";
import { WidgetThemeScope } from "./widget-theme";
import { useWidgetMood } from "./widget-data";
import { useWidgetData } from "./widget-data";

function Shell({ size, children }: { size: "sm" | "md"; children: ReactNode }) {
  return (
    <WidgetThemeScope>
      <div
        className={`${size === "sm" ? "size-[168px]" : "h-[168px] w-[360px]"} shrink-0 overflow-hidden rounded-[var(--radius)] border border-border bg-card p-3.5`}
      >
        {children}
      </div>
    </WidgetThemeScope>
  );
}

function NoData({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center font-mono text-[10.5px] text-muted-foreground">
      {text}
    </div>
  );
}

/** 工具状态行：真实今日消耗 Top（运行中/空闲 无观测信号，仅展示消耗）。 */
function ToolRows({
  tools,
  limit = 4,
}: {
  tools: readonly {
    id: string;
    name: string;
    tokens: number;
  }[];
  limit?: number;
}) {
  const { format } = useI18n();
  return (
    <div className="space-y-1">
      {tools.slice(0, limit).map((tool) => (
        <div
          key={tool.id}
          className="flex items-center gap-1.5 font-mono text-[10.5px]"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-ok" />
          <span className="min-w-0 flex-1 truncate text-foreground/80">
            {tool.name}
          </span>
          <span className="tt-num shrink-0 text-muted-foreground">
            {format.formatTokens(tool.tokens)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 情绪球：颜色随小组件整体状态变化，呼吸动画。 */
function MoodOrb() {
  const mood = useWidgetMood();
  const colors: Record<string, string> = {
    idle: "bg-muted-foreground/50",
    live: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
  };
  return (
    <span className="relative grid size-14 place-items-center">
      <span
        className={`absolute inset-0 rounded-full ${colors[mood]} opacity-20 tt-breathe`}
      />
      <span
        className={`relative size-7 rounded-full ${colors[mood]} shadow-[0_0_18px_var(--color-ok)]`}
      />
    </span>
  );
}

/** 小号 168：情绪球+活跃数 或 安全状态。 */
export function SmallWidget() {
  const { t, format } = useI18n();
  const { prefs } = useWidgetPrefs();
  const { today, security, hasData } = useWidgetData();
  const danger = security.summary?.dangerousCount ?? 0;
  const scanned = security.coverage;

  return (
    <Shell size="sm">
      {!hasData ? (
        <NoData text={t("widget.noData")} />
      ) : prefs.smallContent === "orb" ? (
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-center justify-between font-mono text-[9.5px] tracking-[0.16em] text-muted-foreground/70 uppercase">
            <span>{t("widget.dwTools")}</span>
            <span className="font-mono text-[10px] normal-case text-muted-foreground/70">
              {t("widget.dwActive", { count: today.activeTools })}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <MoodOrb />
            <div className="tt-num mt-1 font-mono text-[16px] leading-none font-semibold">
              {format.formatTokens(today.tokens)}
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
              {t("widget.todayTokens", {
                tokens: format.formatTokens(today.tokens),
              })}
            </div>
          </div>
          <div className="tt-num font-mono text-[10px] text-muted-foreground/70">
            {today.sessions == null
              ? t("widget.noData")
              : `${format.formatNumber(today.sessions)} ${t("widget.sessionCount")}`}
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.14em] text-muted-foreground/70 uppercase">
            {danger > 0 ? (
              <ShieldAlert
                className="size-3.5 text-danger"
                strokeWidth={1.75}
              />
            ) : (
              <ShieldCheck className="size-3.5 text-ok" strokeWidth={1.75} />
            )}
            {t("widget.dwSecurity")}
          </div>
          <div>
            <div
              className={`tt-num font-mono text-[30px] leading-none font-semibold ${
                danger > 0 ? "text-danger" : "text-ok"
              }`}
            >
              {danger}
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
              {t("widget.dwHighRisk")} ·{" "}
              {t("widget.dwScanned", { count: scanned })}
            </div>
          </div>
          <div className="tt-num font-mono text-[10px] text-muted-foreground/70">
            {security.summary == null
              ? t("widget.noData")
              : t("widget.securityRuns", { count: security.runCount })}
          </div>
        </div>
      )}
    </Shell>
  );
}

/** 播报一句话：随语气与真实数据变化；tone=off 返回空串。 */
function useWidgetHeadline(): string {
  const { t, format } = useI18n();
  const { prefs } = useWidgetPrefs();
  const { today, security } = useWidgetData();
  if (prefs.tone === "off") return "";
  const casual = prefs.tone !== "concise";
  const danger = security.summary?.dangerousCount ?? 0;
  const suspicious = security.summary?.suspiciousCount ?? 0;
  const scanned = security.coverage;
  const top = today.topTools[0];
  if (danger > 0)
    return t(casual ? "widget.jarvisDanger" : "widget.jarvisDangerConcise", {
      count: danger,
    });
  if (suspicious > 0)
    return t(
      casual ? "widget.jarvisSuspicious" : "widget.jarvisSuspiciousConcise",
      { count: suspicious },
    );
  if (top)
    return t(casual ? "widget.jarvisTopTool" : "widget.jarvisTopToolConcise", {
      name: top.name,
      tokens: format.formatTokens(top.tokens),
    });
  if (scanned > 0)
    return t(
      casual ? "widget.jarvisAllClear" : "widget.jarvisAllClearConcise",
      { count: scanned },
    );
  return t(casual ? "widget.jarvisIdle" : "widget.jarvisIdleConcise");
}

function TrendBars({
  values,
  className = "",
}: {
  values: readonly number[];
  className?: string;
}) {
  const max = Math.max(...values, 1);
  return (
    <div className={`flex items-end gap-[3px] ${className}`}>
      {values.map((value, index) => (
        <span
          key={index}
          className="flex-1 rounded-[1px] bg-ok/50"
          style={{ height: `${Math.max(10, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="tt-num font-mono text-[17px] leading-none font-semibold">
        {value}
      </div>
      <div className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/** 中号 360×168：播报+沉淀 / 今日产出 / 浪费榜 / 安全。 */
export function MediumWidget() {
  const { t, format } = useI18n();
  const { prefs } = useWidgetPrefs();
  const { today, week, outputs, security, hasData } = useWidgetData();
  const headline = useWidgetHeadline();
  const danger = security.summary?.dangerousCount ?? 0;
  const safe = security.summary?.cleanCount ?? 0;
  const suspicious = security.summary?.suspiciousCount ?? 0;
  const scanned = security.coverage;
  const trend = week.trend.map((point) => point.tokens);

  return (
    <Shell size="md">
      {!hasData ? (
        <NoData text={t("widget.noData")} />
      ) : prefs.mediumContent === "brief" ? (
        <div className="flex h-full gap-3.5">
          <div className="flex min-w-0 flex-1 flex-col justify-between">
            <div className="font-mono text-[9.5px] tracking-[0.16em] text-muted-foreground/70 uppercase">
              {t("widget.dwJarvis")}
            </div>
            <p className="line-clamp-3 text-[12.5px] leading-relaxed text-foreground/90">
              {headline || t("widget.dwBriefOff")}
            </p>
            <div className="flex items-end gap-5">
              <div>
                <div className="tt-num font-mono text-[18px] leading-none font-semibold">
                  {outputs.memory ?? "—"}
                </div>
                <div className="mt-1 flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
                  <BookHeart className="size-3" strokeWidth={1.75} />
                  {t("widget.dwMemory")}
                </div>
              </div>
              <div>
                <div className="tt-num font-mono text-[18px] leading-none font-semibold">
                  {today.sessions == null
                    ? "—"
                    : format.formatNumber(today.sessions)}
                </div>
                <div className="mt-1 flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
                  <Brain className="size-3" strokeWidth={1.75} />
                  {t("widget.sessionCount")}
                </div>
              </div>
            </div>
          </div>
          <div className="w-[132px] shrink-0 border-l border-border/60 pl-3">
            <div className="mb-1.5 font-mono text-[9.5px] tracking-[0.14em] text-muted-foreground/70 uppercase">
              {t("widget.dwTools")}
            </div>
            <ToolRows tools={today.topTools} limit={4} />
          </div>
        </div>
      ) : prefs.mediumContent === "today" ? (
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-center gap-2 font-mono text-[9.5px] tracking-[0.14em] text-muted-foreground/70 uppercase">
            <MessagesSquare className="size-3.5 text-ok" strokeWidth={1.75} />
            {t("widget.dwToday")}
            <span className="ml-auto normal-case text-muted-foreground">
              {t("widget.dwLast7d", { count: week.sessions ?? 0 })}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <MiniStat
              value={format.formatNumber(today.topTools.length)}
              label={t("widget.toolCount")}
            />
            <MiniStat
              value={
                today.sessions == null
                  ? "—"
                  : format.formatNumber(today.sessions)
              }
              label={t("widget.sessionCount")}
            />
            <MiniStat
              value={format.formatTokens(today.tokens)}
              label={t("widget.tokenCount")}
            />
            <MiniStat
              value={
                today.costUsd == null ? "—" : format.formatUsd(today.costUsd)
              }
              label={t("widget.estimatedCost")}
            />
          </div>
          <TrendBars values={trend} className="h-5" />
        </div>
      ) : prefs.mediumContent === "waste" ? (
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.14em] text-muted-foreground/70 uppercase">
            <Gauge className="size-3.5" strokeWidth={1.75} />{" "}
            {t("widget.dwWasteTop")}
          </div>
          <div className="space-y-1">
            {today.topTools.slice(0, 3).map((tool) => (
              <div
                key={tool.id}
                className="flex items-center gap-2 text-[11.5px]"
              >
                <span className="min-w-0 flex-1 truncate">{tool.name}</span>
                <span className="tt-num shrink-0 font-mono text-ok">
                  {format.formatTokens(tool.tokens)}
                </span>
                <span className="w-[38%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                  {tool.costUsd == null ? "—" : format.formatUsd(tool.costUsd)}
                </span>
              </div>
            ))}
          </div>
          <div className="tt-num font-mono text-[10.5px] text-muted-foreground">
            {t("widget.totalTokens")} {format.formatTokens(today.tokens)} ·{" "}
            {t("widget.dwActive", { count: today.activeTools })}
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col justify-between">
          <div className="tt-num flex flex-wrap items-baseline gap-x-2 font-mono text-[11.5px]">
            <span className="text-[15px] font-semibold">{scanned}</span>
            <span className="text-muted-foreground">Skill</span>
            <span className="text-ok">
              {t("widget.safeCount", { count: safe })}
            </span>
            <span className="text-muted-foreground">
              {t("widget.suspiciousCount", { count: suspicious })}
            </span>
            <span className="font-semibold text-foreground">
              {t("widget.dangerCount", { count: danger })}
            </span>
          </div>
          <p className="line-clamp-3 text-[12px] leading-relaxed text-foreground/90">
            {headline || t("widget.dwBriefOff")}
          </p>
          <div className="font-mono text-[10.5px] text-muted-foreground">
            {security.summary == null
              ? t("widget.noData")
              : t("widget.lastScan", {
                  time: format.formatDateTime(
                    security.summary.assessedAt,
                    false,
                  ),
                })}
          </div>
        </div>
      )}
    </Shell>
  );
}

/** 大号 360×360：安全 / 用量 / 今日 三段信号。 */
export function LargeWidget() {
  const { t, format } = useI18n();
  const { today, week, outputs, security, hasData } = useWidgetData();
  const headline = useWidgetHeadline();
  const danger = security.summary?.dangerousCount ?? 0;
  const scanned = security.coverage;
  const trend = week.trend.map((point) => point.tokens);

  return (
    <WidgetThemeScope>
      <div className="h-[360px] w-[360px] shrink-0 overflow-hidden rounded-[var(--radius)] border border-border bg-card p-3.5">
        {!hasData ? (
          <NoData text={t("widget.noData")} />
        ) : (
          <div className="flex h-full flex-col gap-3">
            <p className="line-clamp-2 min-h-[34px] text-[12.5px] leading-relaxed text-foreground/90">
              {headline || t("widget.dwBriefOff")}
            </p>

            <div className="h-px bg-border/70" />

            <div className="font-mono text-[9.5px] tracking-[0.14em] text-muted-foreground/70 uppercase">
              {t("widget.dwSecurity")}
            </div>
            <div className="flex items-center gap-2 font-mono text-[11.5px]">
              {danger > 0 ? (
                <ShieldAlert
                  className="size-3.5 shrink-0 text-danger"
                  strokeWidth={1.75}
                />
              ) : (
                <ShieldCheck
                  className="size-3.5 shrink-0 text-ok"
                  strokeWidth={1.75}
                />
              )}
              <span
                className={`tt-num text-[17px] font-semibold ${
                  danger > 0 ? "text-danger" : "text-ok"
                }`}
              >
                {danger}
              </span>
              <span className="text-muted-foreground">
                {t("widget.dwHighRisk")}
              </span>
              <span className="ml-auto text-muted-foreground">
                {t("widget.dwScanned", { count: scanned })}
                {security.summary != null &&
                  ` · ${t("widget.lastScan", {
                    time: format.formatDateTime(
                      security.summary.assessedAt,
                      false,
                    ),
                  })}`}
              </span>
            </div>

            <div className="h-px bg-border/70" />

            <div className="font-mono text-[9.5px] tracking-[0.14em] text-muted-foreground/70 uppercase">
              {t("widget.dwEfficiency")}
            </div>
            <div className="space-y-1">
              {today.topTools.slice(0, 3).map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center gap-2 text-[11.5px]"
                >
                  <span className="min-w-0 flex-1 truncate">{tool.name}</span>
                  <span className="tt-num shrink-0 font-mono text-ok">
                    {format.formatTokens(tool.tokens)}
                  </span>
                  <span className="w-[36%] shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                    {tool.costUsd == null
                      ? "—"
                      : format.formatUsd(tool.costUsd)}
                  </span>
                </div>
              ))}
            </div>
            <div className="font-mono text-[10.5px] text-muted-foreground">
              {today.costUsd == null
                ? t("widget.totalTokens") +
                  " " +
                  format.formatTokens(today.tokens)
                : t("widget.dwCost", { cost: format.formatUsd(today.costUsd) })}
            </div>

            <div className="h-px bg-border/70" />

            <div className="flex items-center gap-2 font-mono text-[9.5px] tracking-[0.14em] text-muted-foreground/70 uppercase">
              {t("widget.dwToday")}
              <span className="ml-auto normal-case">
                {t("widget.dwLast7d", { count: week.sessions ?? 0 })}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <MiniStat
                value={format.formatNumber(today.topTools.length)}
                label={t("widget.toolCount")}
              />
              <MiniStat
                value={
                  today.sessions == null
                    ? "—"
                    : format.formatNumber(today.sessions)
                }
                label={t("widget.sessionCount")}
              />
              <MiniStat
                value={format.formatTokens(today.tokens)}
                label={t("widget.tokenCount")}
              />
              <MiniStat
                value={
                  outputs.distilled == null
                    ? "—"
                    : format.formatNumber(outputs.distilled)
                }
                label={t("widget.dwDistillable")}
              />
            </div>
            <TrendBars values={trend} className="mt-auto h-6" />
          </div>
        )}
      </div>
    </WidgetThemeScope>
  );
}
