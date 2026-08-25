import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { Pagination } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import {
  hitDimensionsOf,
  unsafeEntries,
  unsafeVerdictTone,
  type SecurityHistoryView,
} from "../security-view";
import { SecurityCard } from "./SecurityCard";

const PAGE_SIZE = 6;

/**
 * 不安全 Skill 名单：与 V3.0 原型一致的「不安全 Skill 名单」卡片。
 *
 * 仅列出最近一次扫描中明确判定为 block / warn 的 Skill。unknown、失败
 * 和部分完成属于「未能确认」，不能误报成不安全；这些状态仍保留在统计与历史中。
 * 每页 6 项分页；「查看报告」打开该 Skill 的真实扫描报告弹窗。
 */
export function UnsafeSkillList({
  entries,
  onOpenReport,
}: {
  entries: readonly SecurityHistoryView[];
  onOpenReport: (entry: SecurityHistoryView) => void;
}) {
  const { t } = useI18n();
  const rows = unsafeEntries(entries);
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [rows.length]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <SecurityCard
      title={t("security.center.unsafe.title")}
      description={t("security.center.unsafe.desc", { count: rows.length })}
    >
      {rows.length === 0 ? (
        <p className="px-5 pb-10 text-center font-mono text-[12px] text-muted-foreground">
          {t("security.center.unsafe.empty")}
        </p>
      ) : (
        <>
          <div className="border-t border-border/60">
            <table className="tt-table tt-table--clean-head w-full">
              <thead>
                <tr>
                  <th>{t("security.center.result.skill")}</th>
                  <th>{t("security.center.result.verdict")}</th>
                  <th>{t("security.center.result.hitDimensions")}</th>
                  <th style={{ textAlign: "right" }}>
                    {t("security.center.unsafe.report")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((item) => {
                  const danger = unsafeVerdictTone(item) === "danger";
                  const hits = hitDimensionsOf(item);
                  return (
                    <tr key={item.id}>
                      <td className="font-medium">{item.skillName}</td>
                      <td>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] ${
                            danger
                              ? "bg-danger/15 text-danger"
                              : "bg-amber-500/15 text-amber-500"
                          }`}
                        >
                          <ShieldAlert className="size-3" strokeWidth={2} />
                          {t("security.center.unsafe.vulnerable")}
                        </span>
                      </td>
                      <td className="text-muted-foreground">
                        {hits.join(" · ") ||
                          t("security.center.result.multipleAnomalies")}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          disabled={!item.report}
                          onClick={() => onOpenReport(item)}
                          className="font-mono text-[11px] text-primary transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t("security.center.unsafe.report")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={current}
            pageCount={pageCount}
            onChange={setPage}
            rangeLabel={`${(current - 1) * PAGE_SIZE + 1}–${Math.min(
              rows.length,
              current * PAGE_SIZE,
            )} / ${rows.length}`}
          />
        </>
      )}
    </SecurityCard>
  );
}
