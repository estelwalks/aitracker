import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  FileText,
  LayoutDashboard,
  RefreshCw,
  ScanLine,
} from "lucide-react";

import { BrandIcon } from "../../../components/BrandIcon";
import { APP_NAME } from "../../../lib/app-config";
import { useI18n } from "../../../lib/i18n/context";
import {
  formatWidgetTrendDate,
  formatWidgetTrendTokens,
  normalizeWidgetTrend,
} from "./widget-trend";
import { resolveWidgetMood, useWidgetData } from "./widget-data";
import "./glass-overview-widget.css";

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="tt-glass-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="tt-glass-section-title">{children}</h3>;
}

export function GlassOverviewWidget({
  className = "",
}: {
  className?: string;
}) {
  const { t, format } = useI18n();
  const navigate = useNavigate();
  const {
    today,
    week,
    outputs,
    security,
    hasData,
    loading,
    generatedAt,
    refresh,
  } = useWidgetData();
  const mood = resolveWidgetMood(hasData, security);

  const topTools = [...today.topTools]
    .filter((tool) => tool.tokens > 0 || tool.events > 0)
    .sort(
      (left, right) =>
        right.tokens - left.tokens ||
        right.events - left.events ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 3);
  const agentSlots = Array.from(
    { length: 3 },
    (_, index) => topTools[index] ?? null,
  );
  const maxToolTokens = Math.max(...topTools.map((tool) => tool.tokens), 1);
  const trend = normalizeWidgetTrend(week.trend);
  const maxTrendTokens = Math.max(...trend.map((point) => point.tokens), 1);
  const [hoveredTrendDate, setHoveredTrendDate] = useState<string | null>(null);
  const hoveredTrendPoint = trend.find(
    (point) => point.date === hoveredTrendDate,
  );
  const trendSummary = hoveredTrendPoint
    ? t("widget.trendPoint", {
        date: formatWidgetTrendDate(hoveredTrendPoint.date, format.formatDate),
        tokens: formatWidgetTrendTokens(
          hoveredTrendPoint.tokens,
          format.formatTokens,
        ),
      })
    : t("widget.todayTokens", {
        tokens: formatWidgetTrendTokens(today.tokens, format.formatTokens),
      });
  const summary = security.summary;
  const danger = summary?.dangerousCount ?? 0;
  const suspicious = summary?.suspiciousCount ?? 0;
  const safe = summary?.cleanCount ?? 0;
  const riskTotal = summary?.discoveredAssetCount ?? security.coverage;
  const updated =
    generatedAt == null
      ? t("widget.noData")
      : t("widget.updatedAt", {
          time: format.formatDateTime(generatedAt, false),
        });
  const openAppRoute = (route: "/" | "/security" | "/reports") => {
    const desktop =
      typeof window === "undefined" ? undefined : window.desktopApi;
    if (desktop) {
      void desktop.openWindowRoute(route);
      return;
    }
    void navigate({ to: route });
  };

  return (
    <article
      className={`tt-glass-overview backdrop-blur-3xl backdrop-saturate-150 ${className}`}
      aria-label={t("widget.floatPanel")}
    >
      <div className="tt-glass-feather" aria-hidden="true" />

      <header className="tt-glass-header">
        <div className="min-w-0">
          <div className="tt-glass-brand">
            <span>{APP_NAME}</span>
            <i className={`tt-glass-status tt-glass-status--${mood}`} />
          </div>
          <p>
            {t("widget.localRunning")} <i aria-hidden="true">·</i>{" "}
            {t("widget.dataNotUploaded")}
          </p>
        </div>
        <div className="tt-glass-header-actions">
          <button type="button" title={t("widget.refresh")} onClick={refresh}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </header>

      <main className="tt-glass-content">
        <section className="tt-glass-section tt-glass-overview-summary">
          <SectionTitle>{t("widget.todayOverview")}</SectionTitle>
          <div className="tt-glass-overview-grid">
            <div className="tt-glass-token-total">
              <strong>{format.formatTokens(today.tokens)}</strong>
              <span>{t("widget.tokenCount")}</span>
            </div>
            <Metric
              value={
                today.sessions == null
                  ? "—"
                  : format.formatNumber(today.sessions)
              }
              label={t("widget.sessions")}
            />
            <Metric
              value={format.formatNumber(today.events)}
              label={t("widget.events")}
            />
            <Metric
              value={format.formatNumber(today.activeTools)}
              label={t("widget.agentCount")}
            />
          </div>
          {!hasData && !loading && (
            <p className="tt-glass-empty">{t("widget.noDataDesc")}</p>
          )}
        </section>

        <section className="tt-glass-section">
          <SectionTitle>{t("widget.agentDistribution")}</SectionTitle>
          <div className="tt-glass-agent-list">
            {agentSlots.map((tool, index) => {
              if (tool == null) {
                return (
                  <div
                    className="tt-glass-agent-row tt-glass-agent-row--placeholder"
                    data-testid="widget-agent-slot"
                    data-empty="true"
                    key={`empty-agent-${index}`}
                    aria-hidden="true"
                  >
                    <span className="tt-glass-agent-placeholder-icon" />
                    <span className="tt-glass-agent-placeholder-name" />
                    <span className="tt-glass-agent-placeholder-track" />
                  </div>
                );
              }

              const percent = Math.round(
                (tool.tokens / Math.max(today.tokens, tool.tokens, 1)) * 100,
              );
              return (
                <div
                  className="tt-glass-agent-row"
                  data-testid="widget-agent-slot"
                  data-empty="false"
                  key={tool.id}
                >
                  <span className="tt-glass-agent-icon">
                    <BrandIcon name={tool.name} className="size-4" />
                  </span>
                  <span className="tt-glass-agent-name">{tool.name}</span>
                  <span className="tt-glass-agent-track">
                    <i
                      style={{
                        width: `${Math.max(
                          8,
                          Math.round((tool.tokens / maxToolTokens) * 100),
                        )}%`,
                      }}
                    />
                  </span>
                  <span className="tt-glass-agent-value">
                    {format.formatTokens(tool.tokens)}
                  </span>
                  <span className="tt-glass-agent-percent">{percent}%</span>
                  <span className="tt-glass-agent-events">
                    {format.formatNumber(tool.events)} {t("widget.rounds")}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="tt-glass-section">
          <SectionTitle>{t("widget.contextMemory")}</SectionTitle>
          <div className="tt-glass-memory-grid">
            <Metric
              value={
                today.sessions == null
                  ? "—"
                  : format.formatNumber(today.sessions)
              }
              label={t("widget.sessions")}
            />
            <Metric
              value={
                outputs.distilled == null
                  ? "—"
                  : format.formatNumber(outputs.distilled)
              }
              label={t("widget.dwDistilled")}
            />
            <Metric
              value={
                outputs.memory == null
                  ? "—"
                  : format.formatNumber(outputs.memory)
              }
              label={t("widget.dwMemory")}
            />
            <div className="tt-glass-health">
              <strong>
                <i className={`tt-glass-status tt-glass-status--${mood}`} />
                {danger > 0
                  ? t("widget.riskCount", { count: danger })
                  : t("widget.healthy")}
              </strong>
              <span>{t("widget.status")}</span>
            </div>
          </div>
        </section>

        <section className="tt-glass-section">
          <div className="tt-glass-section-heading-row">
            <SectionTitle>{t("widget.tokenTrend7d")}</SectionTitle>
            <span data-testid="widget-token-trend-summary">{trendSummary}</span>
          </div>
          <div
            className="tt-glass-chart"
            aria-label={t("widget.tokenTrend7d")}
            onMouseLeave={() => setHoveredTrendDate(null)}
          >
            {trend.map((point, index) => {
              const isSelected = hoveredTrendDate === point.date;
              const pointSummary = t("widget.trendPoint", {
                date: formatWidgetTrendDate(point.date, format.formatDate),
                tokens: formatWidgetTrendTokens(
                  point.tokens,
                  format.formatTokens,
                ),
              });
              return (
                <div
                  className="tt-glass-bar-column"
                  data-testid={`widget-token-trend-${point.date}`}
                  key={point.date}
                  tabIndex={0}
                  aria-label={pointSummary}
                  onFocus={() => setHoveredTrendDate(point.date)}
                  onBlur={() => setHoveredTrendDate(null)}
                  onMouseOver={() => setHoveredTrendDate(point.date)}
                >
                  <i
                    className={[
                      index === trend.length - 1 ? "is-current" : "",
                      isSelected ? "is-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{
                      height: `${Math.max(
                        8,
                        Math.round((point.tokens / maxTrendTokens) * 100),
                      )}%`,
                    }}
                  />
                  <span>{point.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <button
          type="button"
          className="tt-glass-section tt-glass-security"
          onClick={() => openAppRoute("/security")}
        >
          <div>
            <SectionTitle>{t("widget.securityRisk")}</SectionTitle>
            <div className="tt-glass-security-grid">
              <Metric
                value={format.formatNumber(riskTotal)}
                label={t("widget.riskItems")}
              />
              <Metric
                value={format.formatNumber(danger)}
                label={t("widget.highRisk")}
              />
              <Metric
                value={format.formatNumber(suspicious)}
                label={t("widget.mediumRisk")}
              />
              <Metric
                value={format.formatNumber(safe)}
                label={t("widget.safeItems")}
              />
            </div>
          </div>
          <ChevronRight />
        </button>
      </main>

      <footer className="tt-glass-footer">
        <div className="tt-glass-activity">
          <span>
            <i className="tt-glass-status tt-glass-status--live" />
            {t("widget.activeAgents", { count: today.activeTools })}
          </span>
          <span>{updated}</span>
        </div>
        <nav>
          <button type="button" onClick={() => openAppRoute("/security")}>
            <ScanLine />
            {t("widget.scanNow")}
          </button>
          <button type="button" onClick={() => openAppRoute("/reports")}>
            <FileText />
            {t("widget.generateReport")}
          </button>
          <button type="button" onClick={() => openAppRoute("/")}>
            <LayoutDashboard />
            {t("widget.openDashboardFull")}
          </button>
        </nav>
      </footer>
    </article>
  );
}
