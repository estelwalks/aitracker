import { useMemo, useState } from "react";
import {
  AlertTriangle,
  FolderOpen,
  RadarIcon,
  RefreshCw,
  ScanLine,
  Settings2,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import type {
  SecurityRuntimeCapabilityView,
  SecurityScanPhase,
  SecurityTotals,
} from "../security-view";

export function SecurityBriefing({
  totals,
  dimensions,
  lastScan,
  latestStatus,
  runtime,
  scanning,
  canSelectDirectory,
  devMode,
  onScan,
  onFullScan,
  onSelectDirectory,
}: {
  totals: SecurityTotals;
  dimensions: number;
  lastScan: string;
  latestStatus: SecurityScanPhase | null;
  runtime: SecurityRuntimeCapabilityView | null;
  scanning: boolean;
  canSelectDirectory: boolean;
  devMode: boolean;
  onScan: () => void;
  onFullScan: () => void;
  onSelectDirectory: () => void;
}) {
  const { t } = useI18n();
  const risky = totals.warn + totals.danger + totals.unknown + totals.failed;
  const health = totals.total
    ? Math.round((totals.safe / totals.total) * 100)
    : null;
  const tone =
    totals.danger > 0
      ? "var(--danger)"
      : risky > 0 || totals.findings > 0
        ? "var(--warn)"
        : totals.total > 0
          ? "var(--ok)"
          : "var(--muted-foreground)";
  const lines = useMemo(() => {
    const first =
      totals.total === 0
        ? t("security.center.briefing.noReportLine")
        : risky > 0
          ? t("security.center.briefing.riskyLine", {
              total: totals.total,
              risky,
              danger: totals.danger,
              warn: totals.warn + totals.unknown + totals.failed,
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
    return [
      first,
      latestStatus === "partial"
        ? t("security.center.briefing.partialLine")
        : t("security.center.briefing.boundaryLine"),
    ];
  }, [dimensions, latestStatus, risky, t, totals]);
  const [lineIndex, setLineIndex] = useState(0);
  const line = lines[lineIndex % lines.length];
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  return (
    <section className="relative overflow-hidden rounded-3xl bg-card p-6 shadow-[var(--elev-1)] md:p-7">
      <span
        className="pointer-events-none absolute -top-28 -right-16 size-80 rounded-full opacity-[0.14] blur-3xl"
        style={{ background: tone }}
      />
      <span className="pointer-events-none absolute -bottom-28 -left-16 size-72 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <span className="relative mt-0.5 shrink-0">
            <span
              className="tt-breathe absolute inset-0 rounded-full opacity-45 blur-md"
              style={{ background: tone }}
            />
            <span className="relative grid size-12 place-items-center rounded-full bg-surface-2">
              <RadarIcon
                className="size-6"
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
              <span
                className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px]"
                style={{ color: tone }}
              >
                <ShieldCheck className="size-3" strokeWidth={2} />
                {risky > 0
                  ? t("security.center.briefing.needsAttention", {
                      count: risky,
                    })
                  : totals.findings > 0
                    ? t("security.center.briefing.findingsDetected", {
                        count: totals.findings,
                      })
                    : t("security.center.briefing.allPassed")}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground" />
                {runtime?.capability === "detection-only"
                  ? t("security.center.briefing.detectionOnly")
                  : t("security.center.briefing.monitorUnavailable")}
              </span>
              {devMode && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-warn">
                  <span className="size-1.5 rounded-full bg-warn" />
                  {t("security.center.briefing.devOnly")}
                </span>
              )}
              <button
                type="button"
                onClick={() => setLineIndex((value) => value + 1)}
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className="size-3" strokeWidth={2} />
                {t("security.center.briefing.refresh")}
              </button>
            </div>

            <p
              key={lineIndex}
              className="tt-security-line mt-2.5 min-h-[54px] text-[15px] leading-relaxed font-medium text-foreground/90 md:text-[16px]"
            >
              {line}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <BriefingChip
                icon={ShieldX}
                label={t("security.center.briefing.blocked", {
                  count: totals.danger,
                })}
                color="var(--danger)"
              />
              <BriefingChip
                icon={AlertTriangle}
                label={t("security.center.briefing.warned", {
                  count: totals.warn + totals.unknown + totals.failed,
                })}
                color="var(--warn)"
              />
              <BriefingChip
                icon={ShieldCheck}
                label={t("security.center.briefing.passed", {
                  count: totals.safe,
                })}
                color="var(--ok)"
              />
              <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground">
                {t("security.center.briefing.lastScan", {
                  dimensions,
                  time: lastScan,
                })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 md:w-[230px] md:flex-col md:items-end">
          <div className="relative grid size-[104px] shrink-0 place-items-center">
            <svg
              viewBox="0 0 100 100"
              className="size-full -rotate-90"
              aria-hidden="true"
            >
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
                strokeDashoffset={
                  circumference * (1 - Math.max(0, health ?? 0) / 100)
                }
                className="transition-[stroke-dashoffset] duration-700"
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span
                className="tt-num text-[25px] leading-none font-bold"
                style={{ color: tone }}
              >
                {health == null ? "—" : `${health}%`}
              </span>
              <span className="mt-1 font-mono text-[9.5px] text-muted-foreground">
                {t("security.center.briefing.health")}
              </span>
            </div>
          </div>

          <div className="grid w-full grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onScan}
              disabled={scanning}
              className="group col-span-2 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ScanLine className="size-4" strokeWidth={2} />
              {t("security.center.briefing.startGlobalScan")}
            </button>
            <button
              type="button"
              onClick={onFullScan}
              disabled={scanning}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-surface-2 px-3 py-2 text-[11px] hover:bg-accent disabled:opacity-40"
            >
              <Settings2 className="size-3.5" />
              {t("security.center.briefing.fullScan")}
            </button>
            <button
              type="button"
              onClick={onSelectDirectory}
              disabled={scanning || !canSelectDirectory}
              title={
                canSelectDirectory
                  ? undefined
                  : t("security.center.briefing.directoryPickerUnavailable")
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-surface-2 px-3 py-2 text-[11px] hover:bg-accent disabled:opacity-40"
            >
              <FolderOpen className="size-3.5" />
              {t("security.center.briefing.selectDirectory")}
            </button>
          </div>
          {!canSelectDirectory && (
            <p className="max-w-[230px] text-right text-[9.5px] leading-relaxed text-muted-foreground">
              {t("security.center.briefing.directoryPickerUnavailable")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function BriefingChip({
  icon: Icon,
  label,
  color,
}: {
  icon: typeof ShieldCheck;
  label: string;
  color: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px]"
      style={{ color }}
    >
      <Icon className="size-3" strokeWidth={2} />
      {label}
    </span>
  );
}
