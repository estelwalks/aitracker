import {
  AlertTriangle,
  RadarIcon,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../../../../lib/i18n/context";
import type { SecurityScanPhase, SecurityTotals } from "../security-view";

const TYPE_INTERVAL_MS = 18;
const ROTATE_AFTER_MS = 8000;

/**
 * 安全播报：与 V3.0 原型一致的安全 hero 卡片。
 * 左侧雷达 orb（tone 呼吸光晕）+ 打字机式安全结论 + 状态徽标 + 「换一条」，
 * 右侧健康度 SVG 圆环 + 单个「开始全局检测」CTA。
 * 不再使用共享 JarvisInsight 模板，也不再渲染任何 dev-mode 提示。
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
  const { t } = useI18n();
  const risky = totals.warn + totals.danger + totals.unknown + totals.failed;
  const suspicious = totals.warn + totals.unknown + totals.failed;
  const health = totals.total
    ? Math.round((totals.safe / totals.total) * 100)
    : 0;
  const tone =
    totals.danger > 0
      ? "var(--danger)"
      : risky > 0
        ? "var(--warn)"
        : "var(--ok)";

  const lines = useMemo(() => {
    const first =
      totals.total === 0
        ? t("security.center.briefing.noReportLine")
        : risky > 0
          ? t("security.center.briefing.riskyLine", {
              total: totals.total,
              risky,
              danger: totals.danger,
              warn: suspicious,
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
  }, [dimensions, latestStatus, risky, suspicious, t, totals]);

  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");

  useEffect(() => setIndex(0), [lines]);

  useEffect(() => {
    const line = lines[index % lines.length] ?? "";
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
  }, [index, lines]);

  const R = 42;
  const C = 2 * Math.PI * R;

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
              className="tt-breathe absolute inset-0 rounded-full blur-md"
              style={{ background: tone, opacity: 0.45 }}
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
              <button
                type="button"
                onClick={() => setIndex((v) => (v + 1) % lines.length)}
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className="size-3" strokeWidth={2} />
                {t("security.center.briefing.refresh")}
              </button>
            </div>

            <p
              className="mt-2.5 min-h-[54px] text-[15px] leading-relaxed font-medium text-foreground/90 md:text-[16px]"
              aria-label={typed}
            >
              {typed}
              <span className="tt-breathe ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-foreground/60" />
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip
                icon={ShieldX}
                label={t("security.center.briefing.highRisk", {
                  count: totals.danger,
                })}
                color="var(--danger)"
              />
              <Chip
                icon={AlertTriangle}
                label={t("security.center.briefing.suspicious", {
                  count: suspicious,
                })}
                color="var(--warn)"
              />
              <Chip
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

        <div className="flex items-center gap-5 md:flex-col md:items-end">
          <div className="relative grid size-[104px] shrink-0 place-items-center">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90">
              <circle
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke="var(--surface-2)"
                strokeWidth="7"
              />
              <circle
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={tone}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - health / 100)}
                style={{ transition: "stroke-dashoffset 1s ease" }}
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span
                className="tt-num text-[26px] leading-none font-bold"
                style={{ color: tone }}
              >
                {health}%
              </span>
              <span className="mt-1 font-mono text-[9.5px] text-muted-foreground">
                {t("security.center.briefing.health")}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onScan}
            disabled={scanning}
            className="group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ScanLine
              className="size-4 transition-transform group-hover:rotate-6"
              strokeWidth={2}
            />
            {t("security.center.briefing.startGlobalScan")}
          </button>
        </div>
      </div>
    </section>
  );
}

function Chip({
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
