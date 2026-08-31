import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { Pagination } from "../../../../components/aitracker";
import { useI18n } from "../../../../lib/i18n/context";
import { STANDARD_PAGE_SIZE } from "../../../../lib/pagination";
import {
  hitDimensionsOf,
  unsafeEntries,
  type SecurityHistoryView,
  type SecuritySkillView,
} from "../security-view";
import { SecurityCard } from "./SecurityCard";

/**
 * Unsafe Skill list card aligned with the reference design.
 *
 * Only list existing Skills with an explicit warn/block conclusion from the most recent scan. Detection failed
 * and outstanding results remain in the scan history and must not be disguised as confirmed security risks.
 * There are 10 pagination items per page; "View Report" opens the real scan report pop-up window of this Skill.
 */
export function UnsafeSkillList({
  entries,
  skills,
  onOpenReport,
}: {
  entries: readonly SecurityHistoryView[];
  skills: readonly SecuritySkillView[];
  onOpenReport: (entry: SecurityHistoryView) => void;
}) {
  const { t } = useI18n();
  const rows = unsafeEntries(entries);
  const skillByRef = new Map(skills.map((skill) => [skill.skillRef, skill]));
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [rows.length]);

  const pageCount = Math.max(1, Math.ceil(rows.length / STANDARD_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const pageRows = rows.slice(
    (current - 1) * STANDARD_PAGE_SIZE,
    current * STANDARD_PAGE_SIZE,
  );

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
            <table className="aitracker-table aitracker-table--clean-head w-full">
              <thead>
                <tr>
                  <th>{t("security.center.result.skill")}</th>
                  <th>{t("skills.detail.installedPos")}</th>
                  <th>{t("security.center.result.verdict")}</th>
                  <th>{t("security.center.result.hitDimensions")}</th>
                  <th style={{ textAlign: "right" }}>
                    {t("security.center.unsafe.report")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((item) => {
                  const hits = hitDimensionsOf(item);
                  const target = skillByRef.get(item.skillRef);
                  return (
                    <tr key={item.id}>
                      <td className="font-medium">{item.skillName}</td>
                      <td className="text-muted-foreground">
                        {target
                          ? `${target.agents.join(" · ")} / ${target.name}`
                          : "—"}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] text-danger">
                          <ShieldAlert className="size-3" strokeWidth={2} />
                          {t("security.center.unsafe.vulnerable")}
                        </span>
                      </td>
                      <td className="text-muted-foreground">
                        {hits.join(" · ") ||
                          item.report?.summary ||
                          t("security.center.history.noReport")}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => onOpenReport(item)}
                          className="font-mono text-[11px] text-primary transition-opacity hover:opacity-85"
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
            rangeLabel={`${(current - 1) * STANDARD_PAGE_SIZE + 1}–${Math.min(
              rows.length,
              current * STANDARD_PAGE_SIZE,
            )} / ${rows.length}`}
          />
        </>
      )}
    </SecurityCard>
  );
}
