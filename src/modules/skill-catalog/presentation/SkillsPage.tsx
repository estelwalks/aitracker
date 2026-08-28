import { Link, useNavigate } from "@tanstack/react-router";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { BrandIcon } from "../../../components/BrandIcon";
import {
  EmptyState,
  Pagination,
  SearchInput,
  AITrackerButton,
} from "../../../components/aitracker";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import { STANDARD_PAGE_SIZE } from "../../../lib/pagination";
import type { AgentUsageOverviewReadModel } from "../usage-overview-contracts";
import {
  refreshSkillSnapshot,
  requestApprovedBatchUninstall,
  requestApprovedSkillInstall,
  requestApprovedSkillUninstall,
  type LocalSkill,
  type SkillAgent,
  type SkillForm,
  type SkillSnapshot,
  type SkillWorkspaceSnapshot,
} from "../query";
import {
  buildSkillWorkspace,
  primarySkillDirectoryName,
  querySkillAssets,
  type SkillAssetView,
} from "../application";
import { type SkillCardSecurity, SkillListRow } from "./SkillListRow.tsx";
import { SkillDetailModal } from "./SkillDetailModal.tsx";
import { findSecurityTargetForSkill } from "./security-target.ts";
import { withSkillSearch } from "./skills-search.ts";
import { SyncTargetModal } from "./SyncTargetModal.tsx";
import { ToolOverview } from "./ToolOverview";
import {
  getBrowserSecurityClient,
  getDesktopSecurityClient,
  isScanActive,
  type SecuritySkillVerdictReadModel,
} from "../../security-assessment/index.ts";
import { SECURITY_SCAN_STARTED_EVENT } from "../../security-assessment/events";

export type SkillsPageProps = {
  initial: SkillWorkspaceSnapshot;
  /** Optional route-provided Skill identity used to initialize the filter. */
  initialQuery?: string;
  /** Compact agent-overview projection; never raw events (P1-T1-06/07). */
  usage?: AgentUsageOverviewReadModel;
  showWorkspace?: boolean;
  showToolOverview?: boolean;
  /** Real security-detection summary (skill name → risk-finding count). */
  security?: SkillsSecurityView;
  /** Latest safe-scan verdict per Skill, used by the Agent overview KPI. */
  securityVerdicts?: SecuritySkillVerdictReadModel;
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

type SyncTargetState = { title: string; skills: LocalSkill[] };
type RemoveTargetState = { title: string; skills: LocalSkill[] };
type SkillCategoryFilter =
  "all" | "workflow" | "prompt" | "distilled" | "market" | "other";

export function SkillsPage({
  initial,
  initialQuery,
  usage,
  showWorkspace = true,
  showToolOverview = true,
  security,
  securityVerdicts,
  distillation,
}: SkillsPageProps) {
  const { t, format } = useI18n();
  const navigate = useNavigate({ from: "/skills" });
  const [snapshot, setSnapshot] = useState<SkillSnapshot>(initial.snapshot);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [query, setQuery] = useState(() => initialQuery?.trim() ?? "");
  const [agent, setAgent] = useState<"all" | SkillAgent>("all");
  const [originFilter, setOriginFilter] = useState<
    "all" | "distilled" | "market" | "other"
  >("all");
  const [form, setForm] = useState<"all" | SkillForm>("all");
  const [sourceLabel, setSourceLabel] = useState("all");
  const [page, setPage] = useState(1);
  /** Agent 筛选行分页游标（原型第2行，一屏 9 个 + 全部）。 */
  const [agentPage, setAgentPage] = useState(0);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  /** 行内 Agent 安装/卸载进行中集合（keyed by skill.id，与安全市场一致）。 */
  const [pendingAgents, setPendingAgents] = useState<
    Record<string, Set<string>>
  >({});
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [syncTarget, setSyncTarget] = useState<SyncTargetState | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTargetState | null>(
    null,
  );
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const directoryNameRefreshRequestedRef = useRef(false);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    setQuery(initialQuery?.trim() ?? "");
    setPage(1);
  }, [initialQuery]);

  const updateQuery = useCallback(
    (value: string) => {
      setQuery(value);
      setPage(1);
      void navigate({
        to: "/skills",
        search: (previous) => withSkillSearch(previous, value),
        replace: true,
      });
    },
    [navigate],
  );

  const refresh = useCallback(async (message?: string) => {
    // 安装/卸载/同步后强制重新扫描，避免读到操作前的快照缓存。
    const next = await refreshSkillSnapshot();
    snapshotRef.current = next;
    setSnapshot(next);
    setWorkspace(buildSkillWorkspace(next));
    if (message) toast.success(message);
  }, []);

  // Older persisted snapshots predate the safe directory-name projection.
  // Refresh them once in the background so existing installations stop
  // falling back to the frontmatter `name` after the schema migration. A
  // short-lived buggy projection also persisted that same frontmatter name as
  // `directoryName`, so equal values are treated as stale as well.
  useEffect(() => {
    const needsDirectoryNames = snapshot.skills.some((skill) =>
      skill.installations.some((installation) => {
        const directoryName = installation.directoryName?.trim();
        return !directoryName || directoryName === skill.name;
      }),
    );
    if (!needsDirectoryNames || directoryNameRefreshRequestedRef.current)
      return;
    directoryNameRefreshRequestedRef.current = true;
    void refresh().catch(() => {});
  }, [refresh, snapshot.skills]);

  const rescan = async () => {
    setBusy(true);
    busyRef.current = true;
    try {
      // 「重新扫描」必须强制重扫磁盘（而不是读快照缓存），否则新字段/新
      // 安装不会反映到页面。
      const next = await refreshSkillSnapshot();
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
  }, [agent, form, originFilter, query, sourceLabel]);

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

  // 原型对齐：origin 分段 tab 计数（全部/蒸馏/外部/其他）。
  // 没有 source 的安装只代表“来源未声明”（常见于用户手动安装），不能
  // 推断为蒸馏产物；只有保存流程写入的显式 provenance 才计入蒸馏。
  const originCounts = useMemo(() => {
    const external = workspace.items.filter((item) =>
      item.sourceKinds.includes("market"),
    ).length;
    const distilled = workspace.items.filter((item) => item.isDistilled).length;
    const total = workspace.summary.skillCount;
    const other = workspace.items.filter(
      (item) => !item.isDistilled && !item.sourceKinds.includes("market"),
    ).length;
    return {
      total,
      distilled,
      external,
      other,
    };
  }, [workspace]);

  // 原型对齐：形态（form）分段 tab 计数（全部形态/完整包/工作流/Prompt）。
  const formCounts = useMemo(() => {
    const map = new Map(
      workspace.facets.forms.map((facet) => [facet.value, facet.count]),
    );
    return {
      total: workspace.summary.skillCount,
      package: map.get("package") ?? 0,
      workflow: map.get("workflow") ?? 0,
      prompt: map.get("prompt") ?? 0,
    };
  }, [workspace]);

  const categoryFilter: SkillCategoryFilter =
    originFilter === "distilled"
      ? "distilled"
      : originFilter === "market"
        ? "market"
        : originFilter === "other"
          ? "other"
          : form === "workflow"
            ? "workflow"
            : form === "prompt"
              ? "prompt"
              : "all";

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

  const assets = useMemo(() => {
    const filtered = querySkillAssets(snapshot, {
      text: query,
      agent,
      source: originFilter === "market" ? "market" : "all",
      form,
      updateStatus: "all",
      sort: "name",
      direction: "asc",
    });
    const originFiltered =
      originFilter === "distilled"
        ? filtered.filter((skill) => skill.isDistilled)
        : originFilter === "other"
          ? filtered.filter(
              (skill) =>
                !skill.isDistilled && !skill.sourceKinds.includes("market"),
            )
          : filtered;
    if (sourceLabel === "all") return originFiltered;
    return originFiltered.filter((skill) =>
      skill.installations.some(
        (installation) => installation.source?.label === sourceLabel,
      ),
    );
  }, [agent, form, originFilter, query, snapshot, sourceLabel]);

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
        form: "all",
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

  const totalPages = Math.max(1, Math.ceil(assets.length / STANDARD_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () =>
      assets.slice(
        (currentPage - 1) * STANDARD_PAGE_SIZE,
        currentPage * STANDARD_PAGE_SIZE,
      ),
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

  const openUninstall = (skill: LocalSkill) => {
    setRemoveError(null);
    setRemoveTarget({ title: skill.name, skills: [skill] });
  };

  const startSkillSecurityScan = useCallback(
    async (skill: LocalSkill) => {
      try {
        const client =
          getDesktopSecurityClient() ?? (await getBrowserSecurityClient());
        if (client == null) {
          toast.error(t("common.error"));
          return false;
        }
        const status = await client.getStatus();
        if (isScanActive(status.status)) return true;
        const target = findSecurityTargetForSkill(
          skill,
          await client.listSkills(),
        );
        const next = await client.startScan({
          scope: "single",
          mode: "quick",
          trigger: "manual",
          ...(target
            ? { skillRef: target.skillRef as `skill:${string}` }
            : { skillName: primarySkillDirectoryName(skill) }),
        });
        window.dispatchEvent(new Event(SECURITY_SCAN_STARTED_EVENT));
        if (next.status === "model-required") {
          toast.warning(t("security.center.model.requiredSettings"));
        }
        return true;
      } catch (error) {
        const ui = toUiError(error);
        toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
        return false;
      }
    },
    [t],
  );

  const openBatchUninstall = () => {
    if (checkedSkills.length === 0) return;
    setRemoveError(null);
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
    setRemoveError(null);
    setBusy(true);
    busyRef.current = true;
    try {
      if (target.skills.length === 1) {
        const uninstalledId = target.skills[0].id;
        const installationRefs = target.skills[0].installations.map(
          (installation) => installation.installationRef,
        );
        if (installationRefs.length === 0) {
          setRemoveTarget(null);
          toast.success(t("skills.toast.nothingToUninstall"));
        } else {
          // Resolve all refs against one fresh snapshot before removing any
          // copy. Resolving one-by-one would shift index-based opaque refs
          // after the first installation is moved to the recycle bin.
          const result = await requestApprovedBatchUninstall({
            data: { confirmed: true, installationRefs },
          });
          setCheckedIds(new Set());
          setDetailSkillId((current) =>
            current === uninstalledId ? null : current,
          );
          setRemoveTarget(null);
          await refresh();
          if (result.failed.length === 0) {
            toast.success(
              t("skills.toast.deleted", { name: target.skills[0].name }),
            );
          } else {
            toast.error(
              t("skills.toast.uninstallFailed", {
                count: format.formatNumber(result.failed.length),
                details: result.failed
                  .map((failure) =>
                    t("skills.toast.uninstallFailedItem", {
                      path: failure.installationRef,
                      error: t(
                        failure.errorCode ?? "errors.generic",
                        failure.errorParams,
                      ),
                    }),
                  )
                  .join(t("skills.toast.uninstallFailedSeparator")),
              }),
            );
          }
        }
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
          setRemoveTarget(null);
        } else {
          const result = await requestApprovedBatchUninstall({
            data: { confirmed: true, installationRefs },
          });
          setRemoveTarget(null);
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
      const message = ui ? t(ui.code, ui.params) : t("common.error");
      setRemoveError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  // --- 行内安装条（原型 AgentInstallBar）交互 ---

  /** 点击单个 Agent：装一个 / 卸一个（sourceRef 取首个安装副本，同 SyncTargetModal）。 */
  const toggleInstall = async (
    skill: SkillAssetView,
    agent: string,
    next: boolean,
  ) => {
    setPendingAgents((prev) => {
      const nextSet = new Set(prev[skill.id] ?? []);
      nextSet.add(agent);
      return { ...prev, [skill.id]: nextSet };
    });
    try {
      if (next) {
        const sourceRef = skill.installations[0]?.installationRef;
        if (!sourceRef) return;
        await requestApprovedSkillInstall({
          data: {
            confirmed: true,
            installationRef: sourceRef,
            targetAgent: agent as SkillAgent,
          },
        });
        toast.success(
          t("skills.toast.installedTo", { name: skill.name, agent }),
        );
      } else {
        const installation = skill.installations.find(
          (item) => item.agent === agent,
        );
        if (!installation) return;
        await requestApprovedSkillUninstall({
          data: {
            confirmed: true,
            installationRef: installation.installationRef,
          },
        });
        toast.success(
          t("skills.toast.uninstalledFrom", { name: skill.name, agent }),
        );
      }
      await refresh();
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    } finally {
      setPendingAgents((prev) => {
        const nextSet = new Set(prev[skill.id] ?? []);
        nextSet.delete(agent);
        return { ...prev, [skill.id]: nextSet };
      });
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
    assets.length === 0 ? 0 : (currentPage - 1) * STANDARD_PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * STANDARD_PAGE_SIZE, assets.length);

  return (
    <div className="space-y-4">
      {showToolOverview && usage ? (
        <ToolOverview
          usage={usage}
          workspaceSummary={initial.workspace.summary}
          skillSnapshot={snapshot}
          securityVerdicts={securityVerdicts}
        />
      ) : null}

      {showWorkspace ? (
        <>
          {/* KPI strip（原型瓦片样式） */}
          <div className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: t("skills.kpi.localSkills"),
                value: format.formatNumber(summary.skillCount),
                hint: t("skills.kpi.localSkillsHint", {
                  count: format.formatNumber(summary.installationCount),
                }),
              },
              {
                label: t("skills.kpi.distilled"),
                value:
                  distillation == null
                    ? "—"
                    : format.formatNumber(distillation.approved),
                hint: t("skills.kpi.distilledHint"),
              },
              {
                label: t("skills.kpi.detected"),
                value:
                  securitySummary == null
                    ? "—"
                    : format.formatNumber(securitySummary.scannedCount),
                hint: t("skills.kpi.detectedHint", {
                  pct: format.formatNumber(securityCoveragePct),
                }),
              },
              {
                label: t("skills.kpi.risks"),
                value:
                  securitySummary == null
                    ? "—"
                    : format.formatNumber(securitySummary.riskCount),
                hint:
                  securitySummary != null && securitySummary.riskCount > 0
                    ? t("skills.kpi.risksHint")
                    : t("skills.kpi.risksHintClean"),
              },
            ].map((kpi, index) => (
              <div
                key={kpi.label}
                className={`min-w-0 px-4 py-3.5 transition-colors hover:bg-surface-2 ${
                  index > 0 ? "border-l border-border/60" : ""
                }`}
              >
                <div className="text-[10px] tracking-[0.08em] text-foreground/75 uppercase">
                  {kpi.label}
                </div>
                <div className="aitracker-num aitracker-text-metric mt-2 font-mono leading-none font-black tracking-tight">
                  {kpi.value}
                </div>
                <div className="mt-1.5 truncate text-[11px] text-muted-foreground/70">
                  {kpi.hint}
                </div>
              </div>
            ))}
          </div>

          {/* Filter bar */}
          <section className="space-y-2">
            <div className="aitracker-panel flex flex-wrap items-center gap-2 p-2">
              <SearchInput
                value={query}
                onChange={updateQuery}
                placeholder={t("skills.searchPlaceholder")}
                ariaLabel={t("skills.searchPlaceholder")}
                className="min-w-0 flex-1"
              />
              {/* 统一筛选：来源与形态合并为一组，避免重复切换。 */}
              <div className="inline-flex shrink-0 rounded-sm border border-border bg-surface-2 p-0.5">
                {[
                  {
                    v: "all" as const,
                    label: `${t("skills.origin.all")} ${originCounts.total}`,
                  },
                  {
                    v: "workflow" as const,
                    label: `${t("skills.form.workflow")} ${formCounts.workflow}`,
                  },
                  {
                    v: "prompt" as const,
                    label: `${t("skills.form.prompt")} ${formCounts.prompt}`,
                  },
                  {
                    v: "distilled" as const,
                    label: `${t("skills.filter.distilledSkill")} ${originCounts.distilled}`,
                  },
                  {
                    v: "market" as const,
                    label: `${t("skills.filter.securityMarket")} ${originCounts.external}`,
                  },
                  {
                    v: "other" as const,
                    label: `${t("skills.origin.other")} ${originCounts.other}`,
                  },
                ].map((option) => (
                  <button
                    key={option.v}
                    type="button"
                    disabled={
                      option.v === "distilled" && originCounts.distilled === 0
                    }
                    onClick={() => {
                      if (
                        option.v === "distilled" &&
                        originCounts.distilled === 0
                      )
                        return;
                      setOriginFilter(
                        option.v === "distilled" ||
                          option.v === "market" ||
                          option.v === "other"
                          ? option.v
                          : "all",
                      );
                      setForm(
                        option.v === "workflow"
                          ? "workflow"
                          : option.v === "prompt"
                            ? "prompt"
                            : "all",
                      );
                      setPage(1);
                    }}
                    className={`rounded-sm px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
                      categoryFilter === option.v
                        ? "bg-primary/15 font-medium text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
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
                  <span className="aitracker-num opacity-60">
                    {allAssets.length}
                  </span>
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
                    <span className="aitracker-num opacity-60">
                      {agentCounts.get(item) ?? 0}
                    </span>
                  </button>
                ))}
              </div>

              {agentPages > 1 && (
                <>
                  {agentPageIndex > 0 && (
                    <>
                      <span className="pointer-events-none absolute inset-y-0 left-0 z-10 w-7 bg-gradient-to-r from-background to-transparent" />
                      <button
                        type="button"
                        aria-label={t("skills.agent.prevGroup")}
                        title={t("skills.agent.prevGroup")}
                        onClick={() =>
                          setAgentPage((p) => (p - 1 + agentPages) % agentPages)
                        }
                        className="absolute top-1/2 left-1.5 z-20 grid size-[26px] -translate-y-1/2 place-items-center rounded-lg bg-card/90 text-muted-foreground shadow-md transition-colors hover:bg-surface-2 hover:text-foreground"
                      >
                        <ChevronLeft className="size-3.5" />
                      </button>
                    </>
                  )}
                  {agentPageIndex < agentPages - 1 && (
                    <>
                      <span className="pointer-events-none absolute inset-y-0 right-0 z-10 w-7 bg-gradient-to-l from-background to-transparent" />
                      <button
                        type="button"
                        aria-label={t("skills.agent.nextGroup")}
                        title={t("skills.agent.nextGroup")}
                        onClick={() =>
                          setAgentPage((p) => (p + 1) % agentPages)
                        }
                        className="absolute top-1/2 right-1.5 z-20 grid size-[26px] -translate-y-1/2 place-items-center rounded-lg bg-card/90 text-muted-foreground shadow-md transition-colors hover:bg-surface-2 hover:text-foreground"
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
                    <AITrackerButton>
                      {t("skills.actions.addMonitorDir")}
                    </AITrackerButton>
                  </Link>
                  <Link to="/market">
                    <AITrackerButton>
                      {t("skills.actions.goMarket")}
                    </AITrackerButton>
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
                    className={`grid size-5 shrink-0 place-items-center rounded-[6px] border transition-colors ${
                      allPagedChecked
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-surface-2"
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

              {/* 原型对齐的列表行布局（--rowline 细分隔线，同原型） */}
              <ul
                className="overflow-hidden rounded-xl border border-border bg-card"
                style={
                  {
                    "--rowline":
                      "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
                  } as CSSProperties
                }
              >
                {paged.map((skill, index) => (
                  <SkillListRow
                    key={skill.id}
                    skill={skill}
                    selected={checkedIds.has(skill.id)}
                    security={securityOf(skill.name)}
                    blacklisted={snapshot.blacklist.includes(skill.name)}
                    index={index}
                    availableAgents={detectedAgentList}
                    pendingAgents={pendingAgents[skill.id]}
                    onToggleAgent={(agent, next) =>
                      void toggleInstall(skill, agent, next)
                    }
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
              onInstalled={() => void refresh()}
              onRemove={() => {
                setDetailSkillId(null);
                openUninstall(detailSkill);
              }}
              onOpenSecurity={() => {
                void (async () => {
                  const started = await startSkillSecurityScan(detailSkill);
                  if (!started) return;
                  setDetailSkillId(null);
                  await navigate({ to: "/security" });
                })();
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

          {/* Uninstall confirmation */}
          {removeTarget && (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-background/75 p-4 backdrop-blur-md"
              role="dialog"
              aria-modal="true"
              aria-labelledby="skill-uninstall-title"
            >
              <div className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-danger/25 bg-card shadow-2xl shadow-black/30">
                <div className="border-b border-border/70 px-5 py-5">
                  <div className="flex items-start gap-3.5">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger ring-1 ring-danger/20">
                      <AlertTriangle className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <h2
                        id="skill-uninstall-title"
                        className="mt-1 text-[17px] font-semibold tracking-tight"
                      >
                        {t("skills.uninstall.title")}
                      </h2>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 px-5 py-5 text-[13px]">
                  <div className="rounded-xl border border-border/70 bg-surface-2/50 px-3.5 py-3">
                    <p className="leading-relaxed">
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
                    {removeTarget.skills.length === 1 && (
                      <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                        {removeTarget.skills[0].name}
                      </p>
                    )}
                  </div>
                  {removeError && (
                    <p
                      role="alert"
                      className="rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-danger"
                    >
                      {removeError}
                    </p>
                  )}
                </div>

                <div className="flex justify-end gap-2 border-t border-border/70 bg-surface-2/25 px-5 py-4">
                  <AITrackerButton
                    disabled={busy}
                    onClick={() => {
                      setRemoveError(null);
                      setRemoveTarget(null);
                    }}
                  >
                    {t("common.cancel")}
                  </AITrackerButton>
                  <AITrackerButton
                    variant="danger"
                    disabled={busy}
                    onClick={() => void confirmUninstall()}
                  >
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    {t("skills.uninstall.confirm")}
                  </AITrackerButton>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
