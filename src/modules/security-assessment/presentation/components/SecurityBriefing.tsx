import { RadarIcon, RefreshCw, ScanLine } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { useI18n } from "../../../../lib/i18n/context";
import {
  insightFallbackStatusLabel,
  insightSeverityLabelKey,
  usePageInsight,
} from "../../../insights/page/presentation/use-page-insight";
import {
  detectedRiskCount,
  unresolvedScanCount,
  type SecurityScanPhase,
  type SecurityTotals,
} from "../security-view";

const TYPE_INTERVAL_MS = 18;
const ROTATE_AFTER_MS = 8000;

/**
 * V3.0 prototype security briefing, fitted into the existing hero footprint.
 * The card keeps the current outer dimensions while restoring the prototype's
 * radar orb, typewriter carousel, health ring and single global-scan CTA.
 */
export function SecurityBriefing({
  totals,
  dimensions,
  lastScan,
  latestStatus,
  scanning,
  onScan,
}: {
  totals: SecurityTotals;
  dimensions: number;
  lastScan: string;
  latestStatus: SecurityScanPhase | null;
  scanning: boolean;
  onScan: () => void;
}) {
  const { locale, t } = useI18n();
  const {
    lines: sharedInsightLines,
    envelope,
    loading: insightLoading,
  } = usePageInsight({ surfaceId: "security", locale });
  const risky = detectedRiskCount(totals);
  const unresolved = unresolvedScanCount(totals);
  const health = totals.total
    ? Math.round((totals.safe / totals.total) * 100)
    : 0;
  const tone =
    totals.danger > 0
      ? "var(--danger)"
      : risky > 0 || unresolved > 0
        ? "var(--warn)"
        : "var(--ok)";

  const localLines = useMemo(() => {
    const first =
      totals.total === 0
        ? t("security.center.briefing.noReportLine")
        : risky > 0
          ? t("security.center.briefing.riskyLine", {
              total: totals.total,
              risky,
              danger: totals.danger,
              warn: totals.warn,
            })
          : unresolved > 0
            ? t("security.center.briefing.unresolvedLine", {
                total: totals.total,
                unresolved,
              })
            : totals.findings > 0
              ? t("security.center.briefing.findingLine", {
                  total: totals.total,
                  findings: totals.findings,
                })
              : t("security.center.briefing.cleanLine", {
                  dimensions,
                  total: totals.total,
                });
    const status =
      latestStatus === "partial"
        ? t("security.center.briefing.partialLine")
        : `${t("security.center.briefing.lastScan", {
            dimensions,
            time: lastScan,
          })} · ${health}% ${t("security.center.briefing.health")}`;
    return [first, status, t("security.center.briefing.boundaryLine")];
  }, [
    dimensions,
    health,
    lastScan,
    latestStatus,
    risky,
    unresolved,
    t,
    totals,
  ]);

  // The security briefing keeps its bespoke radar/health presentation, while
  // its rotating copy comes from the same evidence envelope as every page.
  // During the initial read (or when no envelope lines are available), the
  // existing security totals remain the honest local fallback.
  const useLocalLines = insightLoading || sharedInsightLines.length === 0;
  const lines = useLocalLines
    ? localLines
    : sharedInsightLines.map((insight) => insight.text);
  const topInsight = sharedInsightLines[0];
  const fallbackStatusKey = envelope
    ? insightFallbackStatusLabel(envelope.status)
    : null;
  const renderMessage = t as unknown as (key: string) => string;
  const fallbackStatus =
    envelope?.status === "enhancer-unavailable" && fallbackStatusKey ? (
      <Link
        to="/settings"
        search={{ section: "model" }}
        className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[9px] tracking-[0.04em] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        {renderMessage(fallbackStatusKey)}
      </Link>
    ) : fallbackStatusKey ? (
      <span
        role="status"
        className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[9px] tracking-[0.04em] text-muted-foreground"
      >
        {renderMessage(fallbackStatusKey)}
      </span>
    ) : null;
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const activeIndex = index % lines.length;
  const line = lines[activeIndex] ?? "";
  const rotateNext = () => setIndex((current) => (current + 1) % lines.length);

  useEffect(() => setIndex(0), [lines]);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setTyped(line);
      return;
    }
    setTyped("");
    let cursor = 0;
    const typer = window.setInterval(() => {
      cursor += 2;
      setTyped(line.slice(0, cursor));
      if (cursor >= line.length) window.clearInterval(typer);
    }, TYPE_INTERVAL_MS);
    const rotate = window.setTimeout(
      () => setIndex((current) => (current + 1) % lines.length),
      ROTATE_AFTER_MS,
    );
    return () => {
      window.clearInterval(typer);
      window.clearTimeout(rotate);
    };
  }, [line, lines.length]);

  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  return (
    <section
      className="dashboard-insight-hero security-briefing-card"
      style={{ "--briefing-tone": tone } as CSSProperties}
      aria-label={t("security.center.briefing.title")}
    >
      <div className="relative grid h-full gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <span className="relative mt-0.5 shrink-0">
            <span
              className="tt-breathe absolute inset-0 rounded-full blur-md"
              style={{ background: tone, opacity: 0.45 }}
            />
            <span className="relative grid size-10 place-items-center rounded-full bg-surface-2">
              <RadarIcon
                className="size-5"
                style={{ color: tone }}
                strokeWidth={1.7}
              />
            </span>
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight">
                {t("security.center.briefing.title")}
              </h2>
              {topInsight?.severity ? (
                <span
                  className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-[9px] tracking-[0.08em] text-muted-foreground"
                  title={topInsight.severity}
                  aria-label={t(insightSeverityLabelKey(topInsight.severity))}
                >
                  <span className="size-1.5 rounded-full bg-muted-foreground/60" />
                  {t(insightSeverityLabelKey(topInsight.severity))}
                </span>
              ) : null}
              {envelope?.source === "enhanced" ? (
                <span className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[9px] tracking-[0.08em] text-muted-foreground">
                  {t("settings.insight.enhanced")}
                </span>
              ) : null}
              {fallbackStatus}
              <button
                type="button"
                onClick={rotateNext}
                className="dashboard-hero-refresh ml-auto"
              >
                <RefreshCw className="size-3" strokeWidth={2} />
                {t("security.center.briefing.refresh")}
              </button>
            </div>

            <p
              className="mt-2 min-h-[46px] text-[15px] leading-relaxed font-medium text-foreground/90 md:text-[16px]"
              aria-label={line}
            >
              {typed}
              <span className="tt-breathe ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-foreground/60" />
            </p>

            <div
              className="mt-2.5 flex items-center gap-1.5"
              role="tablist"
              aria-label={t("security.center.briefing.title")}
            >
              {lines.map((item, itemIndex) => (
                <button
                  key={`${itemIndex}-${item}`}
                  type="button"
                  role="tab"
                  aria-selected={itemIndex === activeIndex}
                  aria-label={`${itemIndex + 1}`}
                  onClick={() => setIndex(itemIndex)}
                  className={`h-1 rounded-full transition-all duration-500 ${
                    itemIndex === activeIndex
                      ? "w-9 bg-foreground/70"
                      : "w-2.5 bg-foreground/15"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 md:flex-col md:items-center md:gap-1.5">
          <div
            className="relative grid size-[72px] shrink-0 place-items-center"
            title={`${t("security.center.briefing.health")} ${health}%`}
            aria-label={`${t("security.center.briefing.health")} ${health}%`}
          >
            <svg viewBox="0 0 100 100" className="size-full -rotate-90">
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="var(--surface-2)"
                strokeWidth="7"
              />
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={tone}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - health / 100)}
                style={{ transition: "stroke-dashoffset 1s ease" }}
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span
                className="tt-num text-[17px] leading-none font-bold"
                style={{ color: tone }}
              >
                {health}%
              </span>
              <span className="mt-0.5 font-mono text-[8px] text-muted-foreground">
                {t("security.center.briefing.health")}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onScan}
            disabled={scanning}
            className="group inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[11px] font-medium whitespace-nowrap text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ScanLine
              className="size-3.5 transition-transform group-hover:rotate-6"
              strokeWidth={2}
            />
            {t("security.center.briefing.startGlobalScan")}
          </button>
        </div>
      </div>
    </section>
  );
}
