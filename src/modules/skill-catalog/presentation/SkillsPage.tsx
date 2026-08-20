import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ShieldBan,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { BrandIcon } from "../../../components/BrandIcon";
import {
  EmptyState,
  Pagination,
  SearchInput,
  Stat,
  TTButton,
} from "../../../components/tt";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import type { AgentUsageOverviewReadModel } from "../usage-overview-contracts";
import {
  getLocalSkills,
  requestApprovedBatchUninstall,
  requestApprovedSkillUninstall,
  updateSkillBlacklist,
  type LocalSkill,
  type SkillAgent,
  type SkillSnapshot,
  type SkillWorkspaceSnapshot,
} from "../query";
import {
  buildSkillWorkspace,
  querySkillAssets,
  type AssetSourceFilter,
  type SkillAssetView,
} from "../application";
import { type SkillCardSecurity, SkillListRow } from "./SkillListRow.tsx";
import { SkillDetailModal } from "./SkillDetailModal.tsx";
import { SkillSecurityModal } from "./SkillSecurityModal.tsx";
import { SyncTargetModal } from "./SyncTargetModal.tsx";
import { ToolOverview } from "./ToolOverview";

export type SkillsPageProps = {
  initial: SkillWorkspaceSnapshot;
  /** Compact agent-overview projection; never raw events (P1-T1-06/07). */
  usage: AgentUsageOverviewReadModel;
  showWorkspace?: boolean;
  showToolOverview?: boolean;
  /** Real security-detection summary (skill name → risk-finding count). */
  security?: SkillsSecurityView;
  /** Real distillation activity for the KPI row + banner. */
  distillation?: SkillsDistillationView;
};

export interface SkillsSecurityView {
  readonly byName: ReadonlyMap<string, number>;
}

export interface SkillsDistillationView {
  readonly approved: number;
  readonly waiting: number;
}

const PAGE_SIZE = 12;

type SyncTargetState = { title: string; skills: LocalSkill[] };
type RemoveTargetState = { title: string; skills: LocalSkill[] };

export function SkillsPage({
  initial,
  usage,
  showWorkspace = true,
  showToolOverview = true,
  security,
  distillation,
}: SkillsPageProps) {
  const { t, format } = useI18n();
  const [snapshot, setSnapshot] = useState<SkillSnapshot>(initial.snapshot);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState<"all" | SkillAgent>("all");
  const [source, setSource] = useState<AssetSourceFilter>("all");
  const [sourceLabel, setSourceLabel] = useState("all");
  const [page, setPage] = useState(1);
  /** Agent 筛选行分页游标（原型第2行，一屏 9 个 + 全部）。 */
  const [agentPage, setAgentPage] = useState(0);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [syncTarget, setSyncTarget] = useState<SyncTargetState | null>(null);
  const [securityTarget, setSecurityTarget] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTargetState | null>(
    null,
  );
  const [blacklistTarget, setBlacklistTarget] = useState<LocalSkill | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const refresh = useCallback(async (message?: string) => {
    const next = await getLocalSkills();
    snapshotRef.current = next;
    setSnapshot(next);
    setWorkspace(buildSkillWorkspace(next));
    if (message) toast.success(message);
  }, []);

  const rescan = async () => {
    setBusy(true);
    busyRef.current = true;
    try {
      const next = await getLocalSkills();
      snapshotRef.current = next;
      setSnapshot(next);
      setWorkspace(buildSkillWorkspace(next));
      toast.success(t("skills.toast.rescanned"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    busyRef.current = true;
    try {
      await action();
      await refresh(success);
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  // Reset to first page when filters change.
  useEffect(() => {
    setPage(1);
  }, [query, agent, source, sourceLabel]);

  // --- Derived data ---

  const detectedAgents = useMemo(
    () =>
      new Set(
        workspace.coverage
          .filter((item) => item.installed)
          .map((item) => item.agent),
      ),
    [workspace.coverage],
  );
  const detectedAgentList = useMemo(
    () =>
      workspace.coverage
        .filter((item) => item.installed)
        .map((item) => item.agent) as SkillAgent[],
    [workspace.coverage],
  );

  // 原型第2行 Agent 筛选：仅展示本地已探测到客户端的 Agent，一屏 9 个 +
  // 「全部Agent」，超出用左右浮动圆钮翻页。各 Agent 计数来自工作台预投影的
  // facets.agents（该 skill 已安装到对应 Agent 的安装副本数）。
  const AGENT_PAGE_SIZE = 9;
  const agentCounts = useMemo(
    () =>
      new Map(
        workspace.facets.agents.map((facet) => [facet.value, facet.count]),
      ),
    [workspace.facets.agents],
  );
  const agentPages = Math.max(
    1,
    Math.ceil(detectedAgentList.length / AGENT_PAGE_SIZE),
  );
  const agentPageIndex = Math.min(agentPage, agentPages - 1);
  const shownAgents = detectedAgentList.slice(
    agentPageIndex * AGENT_PAGE_SIZE,
    agentPageIndex * AGENT_PAGE_SIZE + AGENT_PAGE_SIZE,
  );

  const summary = workspace.summary;

  // 原型对齐：origin 分段 tab 计数（全部/蒸馏/外部/其他）。蒸馏 = 无 source
  // 元数据的 skill（saveCandidateAsSkill 只写 name/description frontmatter），
  // 外部 = market，其他 = frontmatter（与原型 all - distilled - external 一致）。
  const originCounts = useMemo(() => {
    const map = new Map(
      workspace.facets.sources.map((facet) => [facet.value, facet.count]),
    );
    const distilled = map.get("unknown") ?? 0;
    const external = map.get("market") ?? 0;
    const total = workspace.summary.skillCount;
    return {
      total,
      distilled,
      external,
      other: Math.max(0, total - distilled - external),
    };
  }, [workspace]);

  const securitySummary = security
    ? {
        scannedCount: security.byName.size,
        riskCount: [...security.byName.values()].reduce(
          (total, count) => total + count,
          0,
        ),
      }
    : null;
  const securityCoveragePct =
    summary.skillCount > 0
      ? Math.round(
          ((securitySummary?.scannedCount ?? 0) / summary.skillCount) * 100,
        )
      : 0;
  const hasDistillActivity =
    distillation != null &&
    (distillation.approved > 0 || distillation.waiting > 0);

  const assets = useMemo(() => {
    const filtered = querySkillAssets(snapshot, {
      text: query,
      agent,
      source,
      updateStatus: "all",
      sort: "name",
      direction: "asc",
    });
    if (sourceLabel === "all") return filtered;
    return filtered.filter((skill) =>
      skill.installations.some(
        (installation) => installation.source?.label === sourceLabel,
      ),
    );
  }, [agent, query, snapshot, source, sourceLabel]);

  // Distinct source labels for the fine-grained source dropdown.
  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of snapshot.skills) {
      const labels = new Set(
        skill.installations.flatMap((installation) =>
          installation.source?.label ? [installation.source.label] : [],
        ),
      );
      for (const label of labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [snapshot.skills]);

  // All skills (unfiltered) for the "补齐 N" quick-sync pill.
  const allAssets = useMemo(
    () =>
      querySkillAssets(snapshot, {
        text: "",
        agent: "all",
        source: "all",
        updateStatus: "all",
        sort: "name",
        direction: "asc",
      }),
    [snapshot],
  );

  const partialSkills = useMemo(
    () =>
      allAssets.filter((skill) =>
        detectedAgents.size > 0
          ? [...detectedAgents].some((a) => !skill.installedAgents.includes(a))
          : false,
      ),
    [allAssets, detectedAgents],
  );

  const totalPages = Math.max(1, Math.ceil(assets.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => assets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [assets, currentPage],
  );

  const detailSkill = detailSkillId
    ? snapshot.skills.find((s) => s.id === detailSkillId)
    : undefined;
  const isBlocked = detailSkill
    ? snapshot.blacklist.includes(detailSkill.name)
    : false;

  // --- Selection helpers ---

  const pagedIds = useMemo(() => new Set(paged.map((s) => s.id)), [paged]);
  const checkedPaged = paged.filter((s) => checkedIds.has(s.id));
  const allPagedChecked =
    paged.length > 0 && checkedPaged.length === paged.length;
  const checkedSkills = snapshot.skills.filter((s) => checkedIds.has(s.id));

  const toggleAllPaged = () => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (allPagedChecked) {
        for (const id of pagedIds) next.delete(id);
      } else {
        for (const id of pagedIds) next.add(id);
      }
      return next;
    });
  };

  const toggleChecked = (skillId: string, checked: boolean) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(skillId);
      else next.delete(skillId);
      return next;
    });
  };

  const clearSelection = () => setCheckedIds(new Set());

  // --- Uninstall ---

  const openUninstall = (skill: LocalSkill) =>
    setRemoveTarget({ title: skill.name, skills: [skill] });

  const openBatchUninstall = () => {
    if (checkedSkills.length === 0) return;
    setRemoveTarget({
      title: t("skills.batch.selectedCount", {
        count: format.formatNumber(checkedSkills.length),
      }),
      skills: checkedSkills,
    });
  };

  const confirmUninstall = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    setBusy(true);
    busyRef.current = true;
    try {
      if (target.skills.length === 1) {
        for (const installation of target.skills[0].installations) {
          await requestApprovedSkillUninstall({
            data: {
              confirmed: true,
              installationRef: installation.installationRef,
            },
          });
        }
        await refresh(
          t("skills.toast.deleted", { name: target.skills[0].name }),
        );
      } else {
        const installationRefs = [
          ...new Set(
            target.skills.flatMap((s) =>
              s.installations.map((i) => i.installationRef),
            ),
          ),
        ];
        if (installationRefs.length === 0) {
          toast.success(t("skills.toast.nothingToUninstall"));
        } else {
          const result = await requestApprovedBatchUninstall({
            data: { confirmed: true, installationRefs },
          });
          setCheckedIds(new Set());
          await refresh();
          if (result.succeeded.length > 0) {
            toast.success(
              t("skills.toast.uninstalledCopies", {
                count: format.formatNumber(result.succeeded.length),
              }),
            );
          }
          if (result.failed.length > 0) {
            toast.error(
              t("skills.toast.uninstallFailed", {
                count: format.formatNumber(result.failed.length),
                details: result.failed
                  .map((f) =>
                    t("skills.toast.uninstallFailedItem", {
                      path: f.installationRef,
                      error: t(f.errorCode ?? "errors.generic", f.errorParams),
                    }),
                  )
                  .join(t("skills.toast.uninstallFailedSeparator")),
              }),
            );
          }
        }
      }
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  // --- Card helpers ---

  const securityOf = (name: string): SkillCardSecurity | undefined => {
    if (security == null) return undefined;
    return {
      riskCount: security.byName.get(name) ?? 0,
      hasHistory: security.byName.has(name),
    };
  };

  const rangeStart =
    assets.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, assets.length);

  return (
    <div className="space-y-4">
      {showToolOverview && usage ? <ToolOverview usage={usage} /> : null}

      {showWorkspace ? (
        <>
          {/* KPI strip */}
          <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t("skills.kpi.localSkills")}
              value={format.formatNumber(summary.skillCount)}
              hint={t("skills.kpi.localSkillsHint", {
                count: format.formatNumber(summary.installationCount),
              })}
            />
            <Stat
              label={t("skills.kpi.distilled")}
              value={
                distillation == null
                  ? "—"
                  : format.formatNumber(distillation.approved)
              }
              hint={t("skills.kpi.distilledHint")}
            />
            <Stat
              label={t("skills.kpi.detected")}
              value={
                securitySummary == null
                  ? "—"
                  : format.formatNumber(securitySummary.scannedCount)
              }
              hint={t("skills.kpi.detectedHint", {
                pct: format.formatNumber(securityCoveragePct),
              })}
            />
            <Stat
              label={t("skills.kpi.risks")}
              value={
                securitySummary == null
                  ? "—"
                  : format.formatNumber(securitySummary.riskCount)
              }
              hint={
                securitySummary != null && securitySummary.riskCount > 0
                  ? t("skills.kpi.risksHint")
                  : t("skills.kpi.risksHintClean")
              }
            />
          </div>

          {/* Distillation activity banner (real counters) */}
          {distillation != null && hasDistillActivity ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3">
              <div className="min-w-0 flex-1 text-[13px] text-foreground">
                {t("skills.banner.distillActive", {
                  approved: format.formatNumber(distillation.approved),
                  waiting: format.formatNumber(distillation.waiting),
                })}
              </div>
              <Link to="/distill">
                <TTButton size="sm">{t("skills.banner.goDistill")}</TTButton>
              </Link>
            </div>
          ) : null}

          {/* Filter bar */}
          <section className="space-y-2">
            <div className="tt-panel flex flex-wrap items-center gap-2 p-2">
              <SearchInput
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setPage(1);
                }}
                placeholder={t("skills.searchPlaceholder")}
                ariaLabel={t("skills.searchPlaceholder")}
                className="min-w-0 flex-1"
              />
              <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-surface-2/70 p-0.5">
                {(
                  [
                    {
                      v: "all",
                      label: `${t("skills.origin.all")} ${originCounts.total}`,
                    },
                    {
                      v: "unknown",
                      label: `${t("skills.origin.distilled")} ${originCounts.distilled}`,
                    },
                    {
                      v: "market",
                      label: `${t("skills.origin.external")} ${originCounts.external}`,
                    },
                    {
                      v: "frontmatter",
                      label: `${t("skills.origin.other")} ${originCounts.other}`,
                    },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.v}
                    type="button"
                    onClick={() => {
                      setSource(option.v);
                      setPage(1);
                    }}
                    className={`rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap transition-colors ${
                      source === option.v
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {(query ||
                agent !== "all" ||
                source !== "all" ||
                sourceLabel !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setAgent("all");
                    setSource("all");
                    setSourceLabel("all");
                    setPage(1);
                  }}
                  className="shrink-0 rounded-full px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t("skills.filter.reset")}
                </button>
              )}
            </div>
          </section>

          {/* Agent 筛选行（原型第2行）：一屏 9 个 + 全部，超出用浮动圆钮翻页 */}
          {detectedAgentList.length > 0 && (
            <div className="relative">
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setAgent("all");
                    setPage(1);
                  }}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] whitespace-nowrap transition-colors ${
                    agent === "all"
                      ? "bg-primary/15 text-primary"
                      : "bg-surface-2 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("skills.agent.all")}
                  <span className="tt-num opacity-60">{allAssets.length}</span>
                </button>
                {shownAgents.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setAgent(item);
                      setPage(1);
                    }}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] whitespace-nowrap transition-colors ${
                      agent === item
                        ? "bg-primary/15 text-primary"
                        : "bg-surface-2 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <BrandIcon name={item} className="size-3.5" />
                    {item}
                    <span className="tt-num opacity-60">
                      {agentCounts.get(item) ?? 0}
                    </span>
                  </button>
                ))}
              </div>

              {agentPages > 1 && (
                <>
                  {agentPageIndex > 0 && (
                    <>
                      <span className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-background to-transparent" />
                      <button
                        type="button"
                        aria-label={t("skills.agent.prevGroup")}
                        title={t("skills.agent.prevGroup")}
                        onClick={() =>
                          setAgentPage((p) => (p - 1 + agentPages) % agentPages)
                        }
                        className="absolute top-1/2 left-1 z-20 grid size-6 -translate-y-1/2 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                      >
                        <ChevronLeft className="size-3.5" />
                      </button>
                    </>
                  )}
                  {agentPageIndex < agentPages - 1 && (
                    <>
                      <span className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-background to-transparent" />
                      <button
                        type="button"
                        aria-label={t("skills.agent.nextGroup")}
                        title={t("skills.agent.nextGroup")}
                        onClick={() =>
                          setAgentPage((p) => (p + 1) % agentPages)
                        }
                        className="absolute top-1/2 right-1 z-20 grid size-6 -translate-y-1/2 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                      >
                        <ChevronRight className="size-3.5" />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {assets.length === 0 ? (
            <EmptyState
              title={t("skills.empty.title")}
              desc={t("skills.empty.desc")}
              actions={
                <>
                  <Link to="/settings">
                    <TTButton>{t("skills.actions.addMonitorDir")}</TTButton>
                  </Link>
                  <Link to="/market">
                    <TTButton>{t("skills.actions.goMarket")}</TTButton>
                  </Link>
                </>
              }
            />
          ) : (
            <>
              {/* Selection bar */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleAllPaged}
                  className="inline-flex items-center gap-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span
                    className={`flex size-4 items-center justify-center rounded-full ${
                      allPagedChecked
                        ? "bg-foreground text-background"
                        : "bg-foreground/10"
                    }`}
                  >
                    {allPagedChecked && <Check className="size-2.5" />}
                  </span>
                  {checkedIds.size > 0
                    ? t("skills.batch.selectedCount", {
                        count: format.formatNumber(checkedIds.size),
                      })
                    : t("skills.batch.totalCount", {
                        count: format.formatNumber(assets.length),
                      })}
                </button>

                {checkedIds.size === 0 ? (
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <select
                      value={sourceLabel}
                      onChange={(event) => {
                        setSourceLabel(event.target.value);
                        setPage(1);
                      }}
                      aria-label={t("skills.filter.source")}
                      className="h-[28px] rounded-full bg-surface-2/70 px-3 text-[12px] text-foreground outline-none"
                    >
                      <option value="all">
                        {t("skills.filter.sourceAll")}
                      </option>
                      {sourceOptions.map((option) => (
                        <option key={option.name} value={option.name}>
                          {option.name} · {option.count}
                        </option>
                      ))}
                    </select>
                    {partialSkills.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setSyncTarget({
                            title: t("skills.card.syncMissing", {
                              count: partialSkills.length,
                            }),
                            skills: partialSkills,
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium text-primary transition-colors hover:bg-primary/12"
                      >
                        <Zap className="size-3.5" />
                        {t("skills.card.syncMissing", {
                          count: partialSkills.length,
                        })}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void rescan()}
                      disabled={busy}
                      title={t("skills.actions.rescan")}
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-surface-2/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <RefreshCw
                        className={`size-3.5 ${busy ? "animate-spin" : ""}`}
                      />
                      {t("skills.actions.rescan")}
                    </button>
                  </div>
                ) : (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setSyncTarget({
                          title: t("skills.batch.selectedCount", {
                            count: format.formatNumber(checkedIds.size),
                          }),
                          skills: checkedSkills,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-surface-2/70 hover:text-foreground"
                    >
                      <Zap className="size-3.5" /> {t("skills.batch.sync")}
                    </button>
                    <Link to="/security">
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-surface-2/70 hover:text-foreground">
                        {t("skills.batch.scan")}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={openBatchUninstall}
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-destructive transition-colors hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" />{" "}
                      {t("skills.batch.uninstall")}
                    </button>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="rounded-full px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t("skills.batch.clearSelection")}
                    </button>
                  </div>
                )}
              </div>

              {/* 原型对齐的列表行布局 */}
              <ul className="overflow-hidden rounded-xl border border-border bg-card">
                {paged.map((skill, index) => (
                  <SkillListRow
                    key={skill.id}
                    skill={skill}
                    selected={checkedIds.has(skill.id)}
                    security={securityOf(skill.name)}
                    blacklisted={snapshot.blacklist.includes(skill.name)}
                    index={index}
                    onSelect={() =>
                      toggleChecked(skill.id, !checkedIds.has(skill.id))
                    }
                    onOpen={() => setDetailSkillId(skill.id)}
                  />
                ))}
              </ul>

              <Pagination
                page={currentPage}
                pageCount={totalPages}
                onChange={setPage}
                rangeLabel={t("skills.pagination.range", {
                  start: format.formatNumber(rangeStart),
                  end: format.formatNumber(rangeEnd),
                  total: format.formatNumber(assets.length),
                })}
              />
            </>
          )}

          {/* Detail modal (rich file tree + content) */}
          {detailSkill && (
            <SkillDetailModal
              skill={detailSkill}
              security={securityOf(detailSkill.name)}
              usableAgents={detectedAgentList}
              blacklisted={isBlocked}
              onClose={() => setDetailSkillId(null)}
              onSync={() =>
                setSyncTarget({
                  title: detailSkill.name,
                  skills: [detailSkill],
                })
              }
              onRemove={() => openUninstall(detailSkill)}
              onOpenSecurity={() => {
                const name = detailSkill.name;
                setDetailSkillId(null);
                setSecurityTarget(name);
              }}
              onToggleBlacklist={() => {
                if (isBlocked) {
                  void run(
                    () =>
                      updateSkillBlacklist({
                        data: { name: detailSkill.name, blocked: false },
                      }),
                    t("skills.toast.unblocked"),
                  );
                } else {
                  setBlacklistTarget(detailSkill);
                }
              }}
            />
          )}

          {/* Sync target picker */}
          {syncTarget && (
            <SyncTargetModal
              title={syncTarget.title}
              skills={syncTarget.skills}
              availableAgents={detectedAgentList}
              onClose={() => setSyncTarget(null)}
              onDone={() => refresh()}
            />
          )}

          {/* Real security history for one skill */}
          {securityTarget && (
            <SkillSecurityModal
              skillName={securityTarget}
              onClose={() => setSecurityTarget(null)}
            />
          )}

          {/* Uninstall confirmation */}
          {removeTarget && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
              <div className="tt-panel w-full max-w-md bg-popover p-0">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium">
                  <AlertTriangle className="size-4 text-danger" />
                  {t("skills.uninstall.title")}
                </div>
                <div className="space-y-2 p-4 text-[13px]">
                  <p>
                    {removeTarget.skills.length === 1
                      ? t("skills.uninstall.singleDesc", {
                          name: removeTarget.skills[0].name,
                        })
                      : t("skills.uninstall.batchDesc", {
                          count: format.formatNumber(
                            removeTarget.skills.length,
                          ),
                        })}
                  </p>
                  <p className="text-[12px] text-danger">
                    {t("skills.uninstall.irreversible")}
                  </p>
                </div>
                <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
                  <TTButton onClick={() => setRemoveTarget(null)}>
                    {t("common.cancel")}
                  </TTButton>
                  <TTButton
                    variant="danger"
                    onClick={() => void confirmUninstall()}
                  >
                    {t("skills.uninstall.confirm")}
                  </TTButton>
                </div>
              </div>
            </div>
          )}

          {/* Blacklist confirmation */}
          {blacklistTarget && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
              <div className="tt-panel w-full max-w-md bg-popover p-0">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-medium">
                  <ShieldBan className="size-4 text-danger" />
                  {t("skills.blacklist.title")}
                </div>
                <div className="space-y-2 p-4 text-[13px]">
                  <p>
                    {t("skills.blacklist.desc", { name: blacklistTarget.name })}
                  </p>
                </div>
                <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
                  <TTButton onClick={() => setBlacklistTarget(null)}>
                    {t("common.cancel")}
                  </TTButton>
                  <TTButton
                    variant="danger"
                    onClick={() => {
                      const target = blacklistTarget;
                      setBlacklistTarget(null);
                      void run(
                        () =>
                          updateSkillBlacklist({
                            data: { name: target.name, blocked: true },
                          }),
                        t("skills.toast.blocked"),
                      );
                    }}
                  >
                    {t("skills.blacklist.confirm")}
                  </TTButton>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
