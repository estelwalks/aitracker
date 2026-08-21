import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, History, X } from "lucide-react";
import { useState } from "react";

import { useI18n } from "../../../../lib/i18n/context";
import type { CandidateOutput } from "../../contracts";
import type { DistillationSessionItem } from "../index.ts";
import type { DistillConfigModelOption } from "./DistillConfig.tsx";
import { kindMeta } from "./out-types.ts";
import { resolveCandidateSource } from "./source-resolve.ts";

/** 解析候选的执行模型为可读名称。找不到的 opaque 配置引用(m-xxx)不显示，避免
 * 把无意义的模型 id 泄漏到历史列表。 */
function modelLabelOf(
  candidate: CandidateOutput,
  options: readonly DistillConfigModelOption[],
): string | null {
  const id = candidate.execution.modelId;
  if (!id) return candidate.mode;
  const option = options.find((o) => o.id === id);
  if (option) return option.label;
  if (/^m-[A-Za-z0-9-]+$/i.test(id)) return null;
  return id;
}

/**
 * 蒸馏历史弹窗,对齐原型(壳 1351-1398 + DistillHistoryCard 2231-2360):
 * 「本次会话结果」区(本页新产生的候选,各带「查看」)+ 持久历史卡(全部候选,
 * 可展开、5 条/页分页)。头部带「去 Skill 管理」链接。空历史时省略持久区。
 */
export function DistillHistoryDialog({
  candidates,
  sessions,
  sessionIds,
  modelOptions,
  onClose,
  onView,
}: {
  candidates: readonly CandidateOutput[];
  sessions: readonly DistillationSessionItem[];
  /** 本页面会话内新产生的候选 id(「本次会话结果」区)。 */
  sessionIds: ReadonlySet<string>;
  /** 模型选项(profile id → 可读名称)，用于把 m-xxx 转成模型名。 */
  modelOptions: readonly DistillConfigModelOption[];
  onClose: () => void;
  onView: (candidateId: string) => void;
}) {
  const { t } = useI18n();
  const sessionCandidates = candidates.filter((c) =>
    sessionIds.has(c.candidateId),
  );
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div
        className="tt-overlay absolute inset-0 backdrop-blur-md"
        onClick={onClose}
      />
      <section className="relative flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl shadow-black/60">
        <header className="flex items-center gap-2 px-5 py-4">
          <History className="size-4 text-muted-foreground" />
          <h2 className="text-[14px] font-semibold tracking-tight">
            {t("distill.historyTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="ml-auto rounded-lg p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="tt-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {sessionCandidates.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-xl bg-surface-2/60">
              <div className="px-4 py-2 font-mono text-[11px] text-muted-foreground">
                {t("distill.histThisSession")}
              </div>
              <div className="divide-y divide-border/40">
                {sessionCandidates.map((candidate) => {
                  const badge = kindMeta(candidate.kind);
                  const resolved = resolveCandidateSource(candidate, sessions);
                  return (
                    <div
                      key={candidate.candidateId}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="block truncate text-[12.5px] font-medium">
                          {t(badge.labelKey)} · {candidate.title}
                        </span>
                        <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                          {candidate.selectedSessionRefs.length} 段 ·{" "}
                          {resolved.projectKeys.join(" / ") ||
                            resolved.sources.join(" / ")}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onView(candidate.candidateId)}
                        className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] transition-colors hover:text-foreground"
                      >
                        {t("distill.historyView")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <DistillHistoryCard
            runs={candidates}
            sessions={sessions}
            modelOptions={modelOptions}
          />
        </div>
      </section>
    </div>
  );
}

/** 持久历史卡:可展开行 + 5 条/页分页(原型 DistillHistoryCard 2231-2360)。 */
function DistillHistoryCard({
  runs,
  sessions,
  modelOptions,
}: {
  runs: readonly CandidateOutput[];
  sessions: readonly DistillationSessionItem[];
  modelOptions: readonly DistillConfigModelOption[];
}) {
  const { t, format } = useI18n();
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const size = 5;
  if (runs.length === 0) return null;
  const pages = Math.max(1, Math.ceil(runs.length / size));
  const cur = Math.min(page, pages);
  const rows = runs.slice((cur - 1) * size, cur * size);
  const savedCount = runs.filter((r) => r.approvalState === "approved").length;

  return (
    <section className="mb-3 overflow-hidden rounded-xl bg-card">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <History className="size-3.5 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold tracking-tight">
          {t("distill.historyTitle")}
        </h2>
        <span className="font-mono text-[11px] text-muted-foreground">
          {t("distill.resultsSummary", {
            count: runs.length,
            approved: savedCount,
          })}
        </span>
        <Link
          to="/skills"
          className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
        >
          {t("distill.savedGuideGo")} <ArrowRight className="size-3" />
        </Link>
      </header>
      <div className="divide-y divide-border/40">
        {rows.map((candidate) => {
          const badge = kindMeta(candidate.kind);
          const saved = candidate.approvalState === "approved";
          const model = modelLabelOf(candidate, modelOptions);
          const resolved = resolveCandidateSource(candidate, sessions);
          return (
            <div key={candidate.candidateId} className="px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-x-3">
                <button
                  type="button"
                  onClick={() =>
                    setOpenId(
                      openId === candidate.candidateId
                        ? null
                        : candidate.candidateId,
                    )
                  }
                  aria-label={t("distill.histExpand")}
                  className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronRight
                    className={`size-3.5 transition-transform ${
                      openId === candidate.candidateId ? "rotate-90" : ""
                    }`}
                  />
                </button>
                <span className="tt-num w-[112px] shrink-0 font-mono text-[11px] text-muted-foreground">
                  {format.formatDateTime(candidate.generatedAt, false)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setOpenId(
                      openId === candidate.candidateId
                        ? null
                        : candidate.candidateId,
                    )
                  }
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium hover:underline"
                >
                  {candidate.title}
                </button>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]"
                  style={
                    saved
                      ? {
                          background:
                            "color-mix(in oklab, var(--chart-1) 16%, transparent)",
                          color: "var(--chart-1)",
                        }
                      : {
                          background: "var(--surface-2)",
                          color: "var(--color-muted-foreground)",
                        }
                  }
                >
                  {saved ? t("distill.histSaved") : t("distill.histUnsaved")}
                </span>
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-x-2 pl-7 font-mono text-[10.5px] text-muted-foreground">
                <span className="shrink-0">
                  {t("distill.histSegments", {
                    count: candidate.selectedSessionRefs.length,
                  })}
                </span>
                {model ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{model}</span>
                  </>
                ) : null}
                {resolved.projectKeys.length > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">
                      {resolved.projectKeys.join(" / ")}
                    </span>
                  </>
                ) : null}
              </div>
              {openId === candidate.candidateId && (
                <div className="mt-2 space-y-2 rounded-lg bg-surface-2/60 p-3">
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                    <span>{t("distill.histMaterial")}</span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5">
                      {t(badge.labelKey)}
                    </span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5">
                      {model}
                    </span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5">
                      {t("distill.histSegments", {
                        count: candidate.selectedSessionRefs.length,
                      })}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {resolved.sources.map((sname) => (
                      <span
                        key={sname}
                        className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10.5px]"
                      >
                        {sname}
                      </span>
                    ))}
                    {resolved.projectKeys.map((project) => (
                      <span
                        key={project}
                        className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10.5px]"
                      >
                        项目 · {project}
                      </span>
                    ))}
                  </div>
                  {candidate.selectedSessionRefs.length > 0 ? (
                    <ul className="tt-scroll max-h-40 space-y-1 overflow-y-auto">
                      {candidate.selectedSessionRefs.map((ref, i) => (
                        <li
                          key={`${ref.source}-${ref.sessionId}-${i}`}
                          className="flex items-center gap-2 text-[12px]"
                        >
                          <span className="tt-num w-6 shrink-0 font-mono text-[10.5px] text-muted-foreground">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]">
                            {resolved.sessionTitles[i] ?? ref.sessionId}
                          </span>
                          <span className="max-w-[45%] truncate font-mono text-[10.5px] text-muted-foreground">
                            {ref.source}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="font-mono text-[10.5px] text-muted-foreground">
                      {t("distill.histPickedNone")}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="tt-num font-mono text-[10.5px] text-muted-foreground">
            {cur} / {pages}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, cur - 1))}
              disabled={cur <= 1}
              className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] disabled:opacity-35"
            >
              {t("distill.histPrev")}
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(pages, cur + 1))}
              disabled={cur >= pages}
              className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] disabled:opacity-35"
            >
              {t("distill.histNext")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
