import { Boxes, Layers, RotateCcw, ShieldCheck, ShieldX } from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import {
  securityHistoryEntryIsSafe,
  summarizeReports,
  type SecurityHistoryView,
  type SecurityScanMode,
} from "../security-view";
import { SecurityCard } from "./SecurityCard";

/**
 * 检测结果摘要：与 V3.0 原型一致的四格指标 + 风险项表格。
 *
 * 仅在最近一次扫描产生条目后渲染。表格行 = 该次扫描的全部 Skill，
 * 结论列对每条单独给出「安全 / 不安全」徽标；命中维度列出该 Skill
 * 报告中去重后的风险维度名，无命名命中时不安全项回退为「多项异常」。
 * 顶部「重新检测」按钮按最近条目的 mode + skillRef 触发单 Skill 重扫。
 */
export function SecurityResultsSummary({
  entries,
  dimensions,
  onRescan,
}: {
  entries: readonly SecurityHistoryView[];
  dimensions: number;
  onRescan: (mode: SecurityScanMode, skillRef: string) => void;
}) {
  const { t } = useI18n();
  const totals = summarizeReports(entries);
  const unsafe = entries.filter((item) => !securityHistoryEntryIsSafe(item));
  const latest = [...entries].sort(
    (left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt),
  )[0];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          icon={Boxes}
          label={t("security.center.metrics.scannedSkills")}
          value={totals.total}
        />
        <Metric
          icon={ShieldCheck}
          label={t("security.center.metrics.safe")}
          value={totals.safe}
          color="var(--ok)"
        />
        <Metric
          icon={ShieldX}
          label={t("security.center.metrics.unsafe")}
          value={totals.warn + totals.danger + totals.unknown}
          color={
            totals.warn + totals.danger + totals.unknown
              ? "var(--danger)"
              : undefined
          }
        />
        <Metric
          icon={Layers}
          label={t("security.center.metrics.dimensions")}
          value={dimensions}
        />
      </div>

      <SecurityCard
        title={t("security.center.result.title")}
        description={t("security.center.result.description", {
          skills: entries.length,
          findings: totals.findings,
        })}
        action={
          latest ? (
            <button
              type="button"
              onClick={() => onRescan(latest.mode, latest.skillRef)}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.99]"
            >
              <RotateCcw className="size-3.5" />
              {t("security.center.result.rescan")}
            </button>
          ) : undefined
        }
      >
        {unsafe.length === 0 ? (
          <p className="px-5 pb-10 text-center font-mono text-[12px] text-ok">
            {t("security.center.result.allPassed", {
              skills: entries.length,
              dimensions,
            })}
          </p>
        ) : (
          <div className="border-t border-border/60">
            <table className="tt-table w-full">
              <thead>
                <tr>
                  <th>{t("security.center.result.skill")}</th>
                  <th>{t("security.center.result.verdict")}</th>
                  <th>{t("security.center.result.hitDimensions")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((item) => {
                  const safe = securityHistoryEntryIsSafe(item);
                  const kinds = [
                    ...new Set(
                      item.report?.findings.map(
                        (finding) => finding.kindDisplay,
                      ) ?? [],
                    ),
                  ];
                  const hitDimensions =
                    kinds.join(" · ") ||
                    (safe
                      ? "—"
                      : t("security.center.result.multipleAnomalies"));
                  return (
                    <tr key={item.id}>
                      <td className="font-medium">{item.skillName}</td>
                      <td>
                        {safe ? (
                          <span className="rounded-full bg-ok/15 px-2 py-0.5 font-mono text-[10px] text-ok">
                            {t("security.center.metrics.safe")}
                          </span>
                        ) : (
                          <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] text-danger">
                            {t("security.center.result.unsafe")}
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground">{hitDimensions}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SecurityCard>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Boxes;
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 shadow-[var(--elev-1)]">
      <div className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3" />
        {label}
      </div>
      <div
        className="tt-num mt-1.5 text-xl font-black"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
