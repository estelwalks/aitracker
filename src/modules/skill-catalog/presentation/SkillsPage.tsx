import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  ChartNoAxesCombined,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderKanban,
  Layers3,
  MessagesSquare,
  RefreshCw,
  Search,
  ShieldBan,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  Stat,
  TTButton,
} from "../../../components/tt";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { Checkbox } from "../../../components/ui/checkbox";
import { Badge } from "../../../components/ui/badge";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import type { UsagePeriod } from "../../../lib/local-usage/presentation";
import { cn } from "../../../lib/utils";
import type { DashboardReadModel } from "../../dashboard/contracts";
import {
  getLocalSkills,
  requestApprovedBatchUninstall,
  requestApprovedSkillInstall,
  requestApprovedSkillSync,
  requestApprovedSkillUninstall,
  updateSkillBlacklist,
  SKILL_AGENTS,
  type LocalSkill,
  type SkillAgent,
  type SkillSnapshot,
  type SkillWorkspaceSnapshot,
} from "../query";
import {
  availableAssetSorts,
  buildSkillWorkspace,
  buildToolOverview,
  querySkillAssets,
  type AssetSortKey,
  type AssetSourceFilter,
  type AssetUpdateFilter,
} from "../application";

export type SkillsPageProps = {
  initial: SkillWorkspaceSnapshot;
  usage: DashboardReadModel;
};

const PAGE_SIZE = 25;

// --- Sync state types ---

type SyncScopeState = {
  skills: LocalSkill[];
  mode: "global" | "specific";
  selectedAgents: Set<string>;
};

type SyncConflictItem = {
  skillId: string;
  skillName: string;
  agent: string;
  resolution: "overwrite" | "skip";
};

type SyncConflictState = {
  skills: LocalSkill[];
  targetAgents: string[];
  conflicts: SyncConflictItem[];
};

type UninstallTarget =
  | { type: "single"; skill: LocalSkill }
  | { type: "batch"; skills: LocalSkill[] };

export function SkillsPage({ initial, usage }: SkillsPageProps) {
  const { t, format } = useI18n();
  const [snapshot, setSnapshot] = useState<SkillSnapshot>(initial.snapshot);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState<"all" | SkillAgent>("all");
  const [source, setSource] = useState<AssetSourceFilter>("all");
  const [updateStatus, setUpdateStatus] = useState<AssetUpdateFilter>("all");
  const [sort, setSort] = useState<AssetSortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [toolPeriod, setToolPeriod] = useState<UsagePeriod>("30d");
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"models" | "projects">("models");
  const [page, setPage] = useState(1);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(
    () => new Set(),
  );
  const [uninstallTarget, setUninstallTarget] =
    useState<UninstallTarget | null>(null);
  const [blacklistTarget, setBlacklistTarget] = useState<LocalSkill | null>(
    null,
  );
  const [syncScope, setSyncScope] = useState<SyncScopeState | null>(null);
  const [syncConflict, setSyncConflict] = useState<SyncConflictState | null>(
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
    if (next.fingerprint !== snapshotRef.current.fingerprint) {
      snapshotRef.current = next;
      setSnapshot(next);
      setWorkspace(buildSkillWorkspace(next));
    } else if (message) {
      snapshotRef.current = next;
      setSnapshot(next);
      setWorkspace(buildSkillWorkspace(next));
    }
    if (message) toast.success(message);
  }, []);

  const rescan = async () => {
    setBusy(true);
    busyRef.current = true;
    try {
      // getLocalSkills runs the local scanner server-side. It is deliberately
      // not a client-side placeholder or a toast-only refresh.
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

  // Reset to first page when filters or sort change
  useEffect(() => {
    setPage(1);
  }, [query, agent, source, updateStatus, sort, sortDir]);

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

  // --- Derived data ---

  // Agents detected as "installed" on this machine (have at least one skill)
  const detectedAgents = useMemo(
    () =>
      new Set(
        workspace.coverage
          .filter((item) => item.installed)
          .map((item) => item.agent),
      ),
    [workspace.coverage],
  );

  const agentCounts = useMemo(
    () =>
      new Map(workspace.facets.agents.map((item) => [item.value, item.count])),
    [workspace.facets.agents],
  );

  const summary = workspace.summary;
  const sortOptions = useMemo(() => availableAssetSorts(snapshot), [snapshot]);
  const assets = useMemo(
    () =>
      querySkillAssets(snapshot, {
        text: query,
        agent,
        source,
        updateStatus,
        sort,
        direction: sortDir,
      }),
    [agent, query, snapshot, sort, sortDir, source, updateStatus],
  );
  const toolOverview = useMemo(
    () =>
      buildToolOverview(
        { tools: usage.v2.tools, events: usage.snapshot.details },
        selectedToolId,
        toolPeriod,
      ),
    [selectedToolId, toolPeriod, usage.snapshot.details, usage.v2.tools],
  );

  // Paginated list
  const totalPages = Math.max(1, Math.ceil(assets.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => assets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [assets, currentPage],
  );

  // Detail skill
  const detailSkill = detailSkillId
    ? snapshot.skills.find((s) => s.id === detailSkillId)
    : undefined;
  const isBlocked = detailSkill
    ? snapshot.blacklist.includes(detailSkill.name)
    : false;

  // Selection helpers
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

  // --- Uninstall handlers ---

  const openUninstall = (skill: LocalSkill) =>
    setUninstallTarget({ type: "single", skill });

  const openBatchUninstall = () => {
    if (checkedSkills.length === 0) return;
    setUninstallTarget({ type: "batch", skills: checkedSkills });
  };

  const confirmUninstall = async () => {
    if (!uninstallTarget) return;
    const target = uninstallTarget;
    setUninstallTarget(null);
    setBusy(true);
    busyRef.current = true;
    try {
      if (target.type === "single") {
        for (const installation of target.skill.installations) {
          await requestApprovedSkillUninstall({
            data: {
              confirmed: true,
              installationRef: installation.installationRef,
            },
          });
        }
        await refresh(t("skills.toast.deleted", { name: target.skill.name }));
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

  // --- Sync handlers ---

  const openSyncScope = (skills: LocalSkill[]) => {
    const valid = skills.filter((s) => s.installations.length > 0);
    if (valid.length === 0) {
      toast.error(t("skills.toast.noSyncCopies"));
      return;
    }
    setSyncScope({ skills: valid, mode: "global", selectedAgents: new Set() });
  };

  const confirmSyncScope = () => {
    if (!syncScope) return;
    const targetAgents =
      syncScope.mode === "global"
        ? [...detectedAgents]
        : [...syncScope.selectedAgents];

    if (targetAgents.length === 0) {
      toast.error(t("skills.toast.selectTarget"));
      return;
    }

    // Detect conflicts: target agent already has a skill with the same name
    const conflicts: SyncConflictItem[] = [];
    for (const skill of syncScope.skills) {
      for (const targetAgent of targetAgents) {
        const hasConflict = snapshot.skills.some(
          (s) =>
            s.name === skill.name &&
            s.installations.some((i) => i.agent === targetAgent),
        );
        if (hasConflict) {
          conflicts.push({
            skillId: skill.id,
            skillName: skill.name,
            agent: targetAgent,
            resolution: "overwrite",
          });
        }
      }
    }

    const skillsToSync = syncScope.skills;
    setSyncScope(null);

    if (conflicts.length > 0) {
      setSyncConflict({
        skills: skillsToSync,
        targetAgents,
        conflicts,
      });
    } else {
      void executeSync(skillsToSync, targetAgents, []);
    }
  };

  const setConflictResolution = (
    index: number,
    resolution: "overwrite" | "skip",
  ) => {
    setSyncConflict((current) => {
      if (!current) return current;
      const conflicts = [...current.conflicts];
      conflicts[index] = { ...conflicts[index], resolution };
      return { ...current, conflicts };
    });
  };

  const setAllConflictResolutions = (resolution: "overwrite" | "skip") => {
    setSyncConflict((current) => {
      if (!current) return current;
      return {
        ...current,
        conflicts: current.conflicts.map((c) => ({ ...c, resolution })),
      };
    });
  };

  const confirmSyncConflict = () => {
    if (!syncConflict) return;
    const { skills, targetAgents, conflicts } = syncConflict;
    setSyncConflict(null);
    void executeSync(skills, targetAgents, conflicts);
  };

  const executeSync = async (
    skills: LocalSkill[],
    targetAgents: string[],
    conflicts: SyncConflictItem[],
  ) => {
    setBusy(true);
    busyRef.current = true;
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    const failedDetails: string[] = [];

    try {
      for (const skill of skills) {
        const sourceInstallationRef = skill.installations[0]?.installationRef;
        if (!sourceInstallationRef) continue;

        // Partition target agents: overwrite (no-conflict + conflict-overwrite) vs skip
        const overwriteAgents: string[] = [];
        const skipAgents: string[] = [];
        for (const targetAgent of targetAgents) {
          const conflict = conflicts.find(
            (c) => c.skillId === skill.id && c.agent === targetAgent,
          );
          if (conflict) {
            if (conflict.resolution === "overwrite")
              overwriteAgents.push(targetAgent);
            else skipAgents.push(targetAgent);
          } else {
            overwriteAgents.push(targetAgent);
          }
        }

        if (overwriteAgents.length > 0) {
          try {
            const result = await requestApprovedSkillSync({
              data: {
                confirmed: true,
                installationRef: sourceInstallationRef,
                targetAgents: overwriteAgents,
                onConflict: "overwrite",
              },
            });
            succeeded += result.succeeded.length;
            skipped += result.skipped.length;
            failed += result.failed.length;
            result.failed.forEach((f) =>
              failedDetails.push(
                `${skill.name} → ${f.agent}: ${t(f.errorCode ?? "errors.generic", f.errorParams)}`,
              ),
            );
          } catch (error) {
            failed += overwriteAgents.length;
            const ui = toUiError(error);
            failedDetails.push(
              `${skill.name}: ${ui ? t(ui.code, ui.params) : t("skills.toast.syncFailed")}`,
            );
          }
        }

        if (skipAgents.length > 0) {
          try {
            const result = await requestApprovedSkillSync({
              data: {
                confirmed: true,
                installationRef: sourceInstallationRef,
                targetAgents: skipAgents,
                onConflict: "skip",
              },
            });
            succeeded += result.succeeded.length;
            skipped += result.skipped.length;
            failed += result.failed.length;
            result.failed.forEach((f) =>
              failedDetails.push(
                `${skill.name} → ${f.agent}: ${t(f.errorCode ?? "errors.generic", f.errorParams)}`,
              ),
            );
          } catch (error) {
            failed += skipAgents.length;
            const ui = toUiError(error);
            failedDetails.push(
              `${skill.name}: ${ui ? t(ui.code, ui.params) : t("skills.toast.syncFailed")}`,
            );
          }
        }
      }

      await refresh();
      const message =
        failed > 0
          ? t("skills.toast.syncDoneFailed", {
              succeeded: format.formatNumber(succeeded),
              skipped: format.formatNumber(skipped),
              failed: format.formatNumber(failed),
            })
          : t("skills.toast.syncDone", {
              succeeded: format.formatNumber(succeeded),
              skipped: format.formatNumber(skipped),
            });
      if (failed > 0 && succeeded === 0) {
        toast.error(message, { description: failedDetails.join("\n") });
      } else if (failed > 0) {
        toast.warning(message, { description: failedDetails.join("\n") });
      } else {
        toast.success(message);
      }
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  // --- Agent tags +N fold ---

  const toggleAgentsExpanded = (skillId: string) => {
    setExpandedAgents((current) => {
      const next = new Set(current);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  // --- Pagination helpers ---

  const rangeStart =
    assets.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, assets.length);

  const updateStatusLabel = (value: AssetUpdateFilter) =>
    t(`skills.update.${value}`);
  const sortLabel = (value: AssetSortKey) => t(`skills.sort.${value}`);
  const contextLabels = {
    textResponses: t("skills.agentOverview.textResponses"),
    toolCalls: t("skills.agentOverview.toolCalls"),
    skillCalls: t("skills.agentOverview.skillCalls"),
    toolOutputCalls: t("skills.agentOverview.toolOutputCalls"),
  } as const;
  const detailRows =
    detailMode === "models" ? toolOverview.models : toolOverview.projects;
  const maxTrendTokens = Math.max(
    ...toolOverview.trend.map((item) => item.tokens),
    1,
  );
  const maxDetailTokens = Math.max(...detailRows.map((item) => item.tokens), 1);

  return (
    <>
      <section className="tool-overview-reference mb-7 space-y-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t("skills.agentOverview.title")}
          </h1>
        </div>

        <section className="tool-overview-insight">
          <div className="flex min-w-0 items-start gap-3">
            <span className="tool-overview-orb">
              <Bot className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">
                {toolOverview.selected?.name ??
                  t("skills.agentOverview.insightTitle")}
              </h2>
              <p className="mt-2 max-w-4xl text-[13px] leading-6 text-muted-foreground">
                {toolOverview.selected == null
                  ? t("skills.agentOverview.noActivity")
                  : t("skills.agentOverview.insightDescription")}
              </p>
              {toolOverview.selected && (
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                  {t("skills.agentOverview.observedEvents", {
                    count: format.formatNumber(toolOverview.totalEvents),
                  })}
                  {" · "}
                  {toolOverview.skillUsage.observed
                    ? t("skills.agentOverview.skillEvidenceObserved", {
                        count: format.formatNumber(
                          toolOverview.skillUsage.calls,
                        ),
                      })
                    : t("skills.agentOverview.skillEvidenceUnavailable")}
                </p>
              )}
            </div>
          </div>
        </section>

        <div className="tool-overview-card-wall">
          {toolOverview.cards.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => setSelectedToolId(tool.id)}
              className={cn(
                "tool-overview-agent-card",
                toolOverview.selected?.id === tool.id &&
                  "tool-overview-agent-card-selected",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium">
                  <span className="tool-overview-card-mark">
                    {tool.name.slice(0, 2).toUpperCase()}
                  </span>
                  {tool.name}
                </span>
                <span
                  className={cn(
                    "tool-overview-state",
                    tool.active && "tool-overview-state-active",
                  )}
                >
                  {tool.active
                    ? t("skills.agentOverview.active")
                    : t("skills.agentOverview.inactive")}
                </span>
              </div>
              <div className="mt-5 flex items-end justify-between gap-3">
                <span className="tt-num text-2xl">
                  {format.formatTokens(tool.tokens)}
                </span>
                <span className="tt-label">
                  {t("skills.agentOverview.totalTokens")}
                </span>
              </div>
              <div className="tool-overview-card-rule mt-2">
                <span style={{ width: `${tool.active ? 100 : 10}%` }} />
              </div>
              <div className="mt-3 space-y-1 text-left font-mono text-[10px] text-muted-foreground">
                <p>
                  {t("skills.agentOverview.observedEvents", {
                    count: format.formatNumber(tool.events),
                  })}
                </p>
                <p>
                  {tool.skillUsage.observed
                    ? t("skills.agentOverview.skillEvidenceObserved", {
                        count: format.formatNumber(tool.skillUsage.calls),
                      })
                    : t("skills.agentOverview.skillEvidenceUnavailable")}
                </p>
                <p>
                  {tool.lastActiveAt
                    ? t("skills.agentOverview.lastActive", {
                        time: format.formatDateTime(tool.lastActiveAt, false),
                      })
                    : t("skills.agentOverview.noActivity")}
                </p>
              </div>
            </button>
          ))}
        </div>

        <Panel
          title={`${toolOverview.selected?.name ?? "—"} · ${t("skills.agentOverview.trend")}`}
          action={
            <div className="tool-overview-periods">
              {(
                [
                  ["today", t("dashboard.period.today")],
                  ["7d", t("dashboard.period.lastNDays", { count: 7 })],
                  ["30d", t("dashboard.period.lastNDays", { count: 30 })],
                  ["all", t("dashboard.period.all")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setToolPeriod(value)}
                  className={cn(
                    "tool-overview-period",
                    toolPeriod === value && "tool-overview-period-active",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <p className="mb-4 text-[11px] text-muted-foreground">
            {t("skills.agentOverview.trendSummary", {
              tokens: format.formatTokens(toolOverview.totalTokens),
              events: format.formatNumber(toolOverview.totalEvents),
            })}
          </p>
          {toolOverview.trend.length === 0 ? (
            <p className="py-10 text-sm text-muted-foreground">
              {t("skills.agentOverview.noActivity")}
            </p>
          ) : (
            <div
              className="tool-overview-trend"
              role="img"
              aria-label={t("skills.agentOverview.trend")}
            >
              {toolOverview.trend.map((point) => (
                <div key={point.date} className="tool-overview-trend-point">
                  <span
                    className="tool-overview-trend-bar"
                    style={{
                      height: `${Math.max(7, (point.tokens / maxTrendTokens) * 100)}%`,
                    }}
                    title={`${point.date}: ${format.formatTokens(point.tokens)}`}
                  />
                  <span>{point.date.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={`${toolOverview.selected?.name ?? "—"} · ${t("skills.agentOverview.composition")}`}
          action={<MessagesSquare className="size-4 text-muted-foreground" />}
        >
          <p className="mb-4 text-[11px] text-muted-foreground">
            {t("skills.agentOverview.compositionHint")}
          </p>
          <div className="space-y-3">
            {toolOverview.context.map((row) => {
              const total = toolOverview.context.reduce(
                (sum, item) => sum + item.count,
                0,
              );
              const percent = total > 0 ? (row.count / total) * 100 : 0;
              return (
                <div key={row.key} className="tool-overview-context-row">
                  <span className="min-w-0 flex-1">
                    {contextLabels[row.key]}
                  </span>
                  <span className="tt-num text-xs">
                    {format.formatNumber(row.count)}
                  </span>
                  <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">
                    {format.formatNumber(Math.round(percent))}%
                  </span>
                  <span className="tool-overview-context-track">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel
          title={`${toolOverview.selected?.name ?? "—"} · ${t("skills.agentOverview.details")}`}
          action={
            <div className="tool-overview-detail-tabs">
              <button
                type="button"
                onClick={() => setDetailMode("models")}
                className={cn(
                  detailMode === "models" && "tool-overview-detail-tab-active",
                )}
              >
                <ChartNoAxesCombined className="size-3" />{" "}
                {t("skills.agentOverview.byModel")}
              </button>
              <button
                type="button"
                onClick={() => setDetailMode("projects")}
                className={cn(
                  detailMode === "projects" &&
                    "tool-overview-detail-tab-active",
                )}
              >
                <FolderKanban className="size-3" />{" "}
                {t("skills.agentOverview.byProject")}
              </button>
            </div>
          }
        >
          {detailRows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {t("skills.agentOverview.noDetail")}
            </p>
          ) : (
            <div className="space-y-3">
              {detailRows.slice(0, 6).map((row) => (
                <div key={row.key} className="tool-overview-breakdown-row">
                  <span
                    className="min-w-0 truncate font-mono text-xs"
                    title={row.key}
                  >
                    {row.key}
                  </span>
                  <span className="tool-overview-breakdown-track">
                    <span
                      style={{
                        width: `${(row.tokens / maxDetailTokens) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="tt-num text-right text-xs">
                    {format.formatTokens(row.tokens)}
                  </span>
                  <span className="text-right font-mono text-[10px] text-muted-foreground">
                    {format.formatNumber(row.events)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <PageHeader
        title={t("skills.agentOverview.workspaceTitle")}
        desc={t("skills.agentOverview.workspaceDesc")}
      >
        <TTButton disabled={busy} onClick={() => void rescan()}>
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
          {t("skills.actions.rescan")}
        </TTButton>
      </PageHeader>

      <section className="skill-workspace-hero mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.13em] text-primary uppercase">
            <Sparkles className="size-3.5" />
            {t("skills.workspace.eyebrow")}
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {t("skills.workspace.description", {
              time: format.formatDateTime(summary.lastScannedAt, false),
            })}
          </p>
        </div>
        <div className="skill-workspace-health">
          <span className="tt-label">{t("skills.workspace.coverage")}</span>
          <span className="tt-num text-xl text-foreground">
            {format.formatNumber(summary.coveragePercent)}%
          </span>
          <span className="text-[11px] text-muted-foreground">
            {t("skills.workspace.coverageHint", {
              active: format.formatNumber(summary.activeAgentCount),
              available: format.formatNumber(summary.availableAgentCount),
            })}
          </span>
        </div>
      </section>

      <div className="mb-4 grid gap-px overflow-x-auto rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t("skills.summary.assets")}
          value={format.formatNumber(summary.skillCount)}
          hint={t("skills.summary.installations", {
            count: format.formatNumber(summary.installationCount),
          })}
        />
        <Stat
          label={t("skills.summary.agentCoverage")}
          value={`${format.formatNumber(summary.activeAgentCount)} / ${format.formatNumber(summary.availableAgentCount)}`}
          hint={t("skills.summary.coverageHint")}
        />
        <Stat
          label={t("skills.summary.updates")}
          value={format.formatNumber(summary.updateAvailableCount)}
          hint={t("skills.summary.updatesHint")}
        />
        <Stat
          label={t("skills.summary.unassigned")}
          value={format.formatNumber(summary.unassignedSkillCount)}
          hint={t("skills.summary.unassignedHint")}
        />
      </div>

      <Panel
        className="mb-4"
        title={t("skills.workspace.coverage")}
        action={
          <span className="text-[11px] text-muted-foreground">
            {t("skills.workspace.coveragePanelHint")}
          </span>
        }
        bodyClassName="p-0"
      >
        <div className="skill-coverage-rail">
          {workspace.coverage.map((item) => (
            <button
              key={item.agent}
              type="button"
              disabled={!item.installed}
              onClick={() => item.installed && setAgent(item.agent)}
              className={cn(
                "skill-coverage-node",
                agent === item.agent && "skill-coverage-node-active",
                item.state === "covered" && "skill-coverage-node-covered",
              )}
            >
              <span className="skill-coverage-dot" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium">{item.agent}</span>
              <span className="tt-num text-[11px]">{item.skillCount}</span>
            </button>
          ))}
        </div>
      </Panel>

      {/* Filter bar */}
      <div className="skills-filter-panel mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t("skills.pageHeader")}</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t("skills.pollingHint")}
            </p>
          </div>
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("skills.searchPlaceholder")}
              className="h-10 w-full rounded-lg border border-border bg-background/70 pl-9 text-[13px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAgent("all")}
            className={`skill-filter-chip ${agent === "all" ? "skill-filter-chip-active" : ""}`}
          >
            {t("skills.filter.agentAll")}
            <span>{format.formatNumber(snapshot.skills.length)}</span>
          </button>
          {SKILL_AGENTS.filter((name) => (agentCounts.get(name) ?? 0) > 0).map(
            (name) => (
              <button
                key={name}
                type="button"
                onClick={() => setAgent(name)}
                className={`skill-filter-chip ${agent === name ? "skill-filter-chip-active" : ""}`}
              >
                {name}
                <span>{format.formatNumber(agentCounts.get(name) ?? 0)}</span>
              </button>
            ),
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border/70 pt-3">
          <select
            aria-label={t("skills.filter.source")}
            value={source}
            onChange={(event) =>
              setSource(event.target.value as AssetSourceFilter)
            }
            className="h-8 rounded-sm border border-border bg-background px-2 text-xs"
          >
            <option value="all">{t("skills.filter.sourceAll")}</option>
            <option value="frontmatter">
              {t("skills.filter.sourceRecorded")}
            </option>
            <option value="market">{t("skills.filter.sourceManaged")}</option>
            <option value="unknown">
              {t("skills.filter.sourceUnclassified")}
            </option>
          </select>
          <select
            aria-label={t("skills.filter.updateStatus")}
            value={updateStatus}
            onChange={(event) =>
              setUpdateStatus(event.target.value as AssetUpdateFilter)
            }
            className="h-8 rounded-sm border border-border bg-background px-2 text-xs"
          >
            <option value="all">{t("skills.filter.updateAll")}</option>
            <option value="available">{updateStatusLabel("available")}</option>
            <option value="current">{updateStatusLabel("current")}</option>
            <option value="unknown">{updateStatusLabel("unknown")}</option>
          </select>
          <select
            aria-label={t("skills.filter.sort")}
            value={sort}
            onChange={(event) => setSort(event.target.value as AssetSortKey)}
            className="h-8 rounded-sm border border-border bg-background px-2 text-xs"
          >
            {sortOptions.map((option) => (
              <option key={option} value={option}>
                {sortLabel(option)}
              </option>
            ))}
          </select>
          <TTButton
            size="sm"
            variant="ghost"
            onClick={() =>
              setSortDir((direction) => (direction === "asc" ? "desc" : "asc"))
            }
            title={t("skills.filter.sortDirection")}
          >
            {sortDir === "asc" ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )}
            {sortDir === "asc"
              ? t("skills.sort.ascending")
              : t("skills.sort.descending")}
          </TTButton>
        </div>
      </div>

      {/* Asset operation cards: rendered from browser-safe workspace items only. */}
      <Panel
        title={t("skills.table.title", {
          count: format.formatNumber(assets.length),
        })}
        bodyClassName="p-0"
      >
        {assets.length === 0 ? (
          <div className="p-4">
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
          </div>
        ) : (
          <>
            {/* Batch action bar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={
                    allPagedChecked
                      ? true
                      : checkedPaged.length > 0
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={() => toggleAllPaged()}
                  disabled={busy}
                  aria-label={t("skills.batch.selectPage")}
                />
                {t("skills.batch.selectPage")}
              </label>
              <span className="text-xs text-muted-foreground">
                {t("skills.batch.selectedCount", {
                  count: format.formatNumber(checkedSkills.length),
                })}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <TTButton
                  size="sm"
                  disabled={busy || checkedSkills.length === 0}
                  onClick={() => openSyncScope(checkedSkills)}
                >
                  <Copy className="size-3" /> {t("skills.batch.sync")}
                </TTButton>
                <TTButton
                  size="sm"
                  variant="danger"
                  disabled={busy || checkedSkills.length === 0}
                  onClick={openBatchUninstall}
                >
                  <Trash2 className="size-3" /> {t("skills.batch.uninstall")}
                </TTButton>
                <TTButton
                  size="sm"
                  variant="ghost"
                  disabled={busy || checkedSkills.length === 0}
                  onClick={clearSelection}
                >
                  {t("skills.batch.clearSelection")}
                </TTButton>
              </div>
            </div>

            <div className="skill-workspace-list">
              {paged.map((skill) => {
                const agents = skill.installedAgents;
                const visibleAgents = expandedAgents.has(skill.id)
                  ? agents
                  : agents.slice(0, 3);
                const hiddenCount = agents.length - visibleAgents.length;
                const isSelected = checkedIds.has(skill.id);
                const statusTone =
                  skill.updateStatus === "available"
                    ? "warn"
                    : skill.updateStatus === "current"
                      ? "ok"
                      : "neutral";
                return (
                  <article
                    key={skill.id}
                    className={cn(
                      "skill-workspace-card",
                      isSelected && "skill-workspace-card-selected",
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) =>
                        toggleChecked(skill.id, checked === true)
                      }
                      disabled={busy}
                      aria-label={t("skills.aria.selectSkill", {
                        name: skill.name,
                      })}
                    />
                    <button
                      type="button"
                      aria-label={t("skills.aria.openSkill", {
                        name: skill.name,
                      })}
                      onClick={() => setDetailSkillId(skill.id)}
                      className="skill-workspace-mark"
                    >
                      {skill.name.slice(0, 2).toUpperCase()}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailSkillId(skill.id)}
                          className="truncate text-left text-[13px] font-semibold text-foreground hover:text-primary hover:underline"
                        >
                          {skill.name}
                        </button>
                        <StatusBadge tone={statusTone}>
                          {updateStatusLabel(skill.updateStatus)}
                        </StatusBadge>
                        {snapshot.blacklist.includes(skill.name) && (
                          <StatusBadge tone="danger">
                            {t("skills.badge.blacklisted")}
                          </StatusBadge>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
                        {skill.description ?? t("skills.detail.noDescription")}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="tt-label mr-1">
                          {t("skills.workspace.availableIn")}
                        </span>
                        {visibleAgents.map((agentName) => (
                          <span key={agentName} className="skill-agent-chip">
                            {agentName}
                          </span>
                        ))}
                        {hiddenCount > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleAgentsExpanded(skill.id)}
                            className="skill-agent-chip skill-agent-chip-more"
                          >
                            +{hiddenCount}
                          </button>
                        )}
                        {expandedAgents.has(skill.id) && agents.length > 3 && (
                          <button
                            type="button"
                            onClick={() => toggleAgentsExpanded(skill.id)}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            {t("common.collapse")}
                          </button>
                        )}
                        {agents.length === 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            {t("skills.workspace.notAssigned")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="skill-workspace-card-actions">
                      <div className="text-right text-[11px] text-muted-foreground">
                        <div className="tt-label">
                          {t("skills.workspace.version")}
                        </div>
                        <div className="mt-1">
                          {skill.versions.join(", ") || "—"}
                        </div>
                      </div>
                      <TTButton
                        size="sm"
                        disabled={busy || skill.installations.length === 0}
                        onClick={() => openSyncScope([skill])}
                        title={t("skills.actions.syncTitle")}
                      >
                        <Copy className="size-3" /> {t("skills.actions.sync")}
                      </TTButton>
                      <TTButton
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setDetailSkillId(skill.id)}
                        title={t("skills.actions.inspect")}
                      >
                        <Layers3 className="size-3" />{" "}
                        {t("skills.actions.inspect")}
                      </TTButton>
                      <TTButton
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => openUninstall(skill)}
                        title={t("skills.actions.uninstall")}
                      >
                        <Trash2 className="size-3" />{" "}
                        {t("skills.actions.uninstall")}
                      </TTButton>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Pagination footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
              <span className="text-xs text-muted-foreground">
                {t("skills.pagination.range", {
                  start: format.formatNumber(rangeStart),
                  end: format.formatNumber(rangeEnd),
                  total: format.formatNumber(assets.length),
                })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={currentPage === 1 || busy}
                  className="rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronFirst className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1 || busy}
                  className="rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="size-3" />
                </button>
                <span className="px-2 text-xs text-muted-foreground">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || busy}
                  className="rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={currentPage === totalPages || busy}
                  className="rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLast className="size-3" />
                </button>
              </div>
            </div>
          </>
        )}
      </Panel>

      {/* FR-015: Detail Drawer */}
      <Sheet
        open={detailSkillId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailSkillId(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-lg"
        >
          {detailSkill && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {detailSkill.name}
                </SheetTitle>
                <SheetDescription>
                  {detailSkill.description ?? t("skills.detail.noDescription")}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4 text-[13px]">
                {/* Opaque installation identity */}
                <div>
                  <div className="tt-label mb-1">
                    {t("skills.detail.installStatus")}
                  </div>
                  {detailSkill.installations.map((inst) => (
                    <div
                      key={inst.installationRef}
                      className="tt-num mt-1 break-all text-[11px] text-muted-foreground"
                    >
                      {inst.agent}
                    </div>
                  ))}
                </div>

                {/* Last used */}
                <div className="text-[12px] text-muted-foreground">
                  {detailSkill.lastUsedAt == null
                    ? t("skills.detail.noLastUsed")
                    : t("skills.detail.lastUsedAt", {
                        time: format.formatDateTime(
                          detailSkill.lastUsedAt,
                          false,
                        ),
                      })}
                </div>

                {/* Per-agent install status (all 9 agents) */}
                <div>
                  <div className="tt-label mb-2">
                    {t("skills.detail.installStatus")}
                  </div>
                  <ul className="space-y-2">
                    {SKILL_AGENTS.map((agentName) => {
                      const installation = detailSkill.installations.find(
                        (i) => i.agent === agentName,
                      );
                      return (
                        <li
                          key={agentName}
                          className="flex items-center justify-between gap-2 rounded-sm border border-border bg-surface-2 p-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{agentName}</span>
                              {installation ? (
                                <Badge
                                  variant="secondary"
                                  className="bg-ok/15 text-ok"
                                >
                                  {t("common.installed")}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-muted-foreground"
                                >
                                  {t("common.notInstalled")}
                                </Badge>
                              )}
                            </div>
                            {installation && (
                              <>
                                <div className="tt-num mt-1 break-all text-[10px] text-muted-foreground">
                                  {installation.agent}
                                </div>
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  {t("skills.detail.installedAt", {
                                    time: format.formatDateTime(
                                      installation.installedAt,
                                      false,
                                    ),
                                  })}
                                  {" · "}
                                  {t("skills.detail.modifiedAt", {
                                    time: format.formatDateTime(
                                      installation.modifiedAt,
                                      false,
                                    ),
                                  })}
                                </div>
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  {t("skills.detail.version", {
                                    version:
                                      installation.version ??
                                      t("skills.detail.notProvided"),
                                  })}
                                </div>
                                <div
                                  className={cn(
                                    "mt-1 text-[10px]",
                                    installation.updateStatus === "available"
                                      ? "text-warn"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {t("skills.detail.updateStatusShort", {
                                    status:
                                      installation.updateStatus === "available"
                                        ? t("skills.detail.updateAvailable")
                                        : installation.updateStatus ===
                                            "current"
                                          ? t("skills.detail.updateCurrent")
                                          : t("skills.detail.updateUnknown"),
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                          {installation ? (
                            <TTButton
                              size="sm"
                              variant="danger"
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () =>
                                    requestApprovedSkillUninstall({
                                      data: {
                                        confirmed: true,
                                        installationRef:
                                          installation.installationRef,
                                      },
                                    }),
                                  t("skills.toast.uninstalledFrom", {
                                    name: detailSkill.name,
                                    agent: agentName,
                                  }),
                                )
                              }
                            >
                              {t("skills.actions.uninstall")}
                            </TTButton>
                          ) : (
                            <TTButton
                              size="sm"
                              disabled={
                                busy ||
                                isBlocked ||
                                detailSkill.installations.length === 0
                              }
                              onClick={() =>
                                run(
                                  () =>
                                    requestApprovedSkillInstall({
                                      data: {
                                        confirmed: true,
                                        installationRef:
                                          detailSkill.installations[0]
                                            .installationRef,
                                        targetAgent: agentName,
                                      },
                                    }),
                                  t("skills.toast.installedTo", {
                                    name: detailSkill.name,
                                    agent: agentName,
                                  }),
                                )
                              }
                            >
                              <Download className="size-3" />{" "}
                              {t("skills.actions.install")}
                            </TTButton>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <TTButton
                    disabled={busy}
                    variant={isBlocked ? "default" : "danger"}
                    onClick={() => {
                      if (!isBlocked) {
                        setBlacklistTarget(detailSkill);
                        return;
                      }
                      void run(
                        () =>
                          updateSkillBlacklist({
                            data: { name: detailSkill.name, blocked: false },
                          }),
                        t("skills.toast.unblocked"),
                      );
                    }}
                  >
                    <ShieldBan className="size-3.5" />
                    {isBlocked
                      ? t("skills.actions.unblock")
                      : t("skills.actions.block")}
                  </TTButton>
                  <TTButton
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      setDetailSkillId(null);
                      openUninstall(detailSkill);
                    }}
                  >
                    <Trash2 className="size-3.5" />{" "}
                    {t("skills.actions.uninstallAll")}
                  </TTButton>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* FR-016: Uninstall confirmation AlertDialog */}
      <AlertDialog
        open={uninstallTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUninstallTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-danger" />
              {t("skills.uninstall.title")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1">
                <p>
                  {uninstallTarget?.type === "batch"
                    ? t("skills.uninstall.batchDesc", {
                        count: format.formatNumber(
                          uninstallTarget.skills.length,
                        ),
                      })
                    : t("skills.uninstall.singleDesc", {
                        name: uninstallTarget?.skill.name ?? "",
                      })}
                </p>
                <p className="text-danger">
                  {t("skills.uninstall.irreversible")}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void confirmUninstall();
              }}
              className="border-danger bg-danger text-white shadow-sm hover:bg-danger/90"
            >
              {t("skills.uninstall.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={blacklistTarget !== null}
        onOpenChange={(open) => {
          if (!open) setBlacklistTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldBan className="size-5 text-danger" />
              {t("skills.blacklist.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("skills.blacklist.desc", {
                name: blacklistTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                const target = blacklistTarget;
                setBlacklistTarget(null);
                if (!target) return;
                void run(
                  () =>
                    updateSkillBlacklist({
                      data: { name: target.name, blocked: true },
                    }),
                  t("skills.toast.blocked"),
                );
              }}
              className="border-danger bg-danger text-white shadow-sm hover:bg-danger/90"
            >
              {t("skills.blacklist.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* FR-017: Sync scope Dialog */}
      <Dialog
        open={syncScope !== null}
        onOpenChange={(open) => {
          if (!open) setSyncScope(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("skills.sync.title")}</DialogTitle>
            <DialogDescription>{t("skills.sync.desc")}</DialogDescription>
          </DialogHeader>

          {syncScope && (
            <div className="space-y-3">
              {/* Scope options */}
              <div className="space-y-2">
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                    syncScope.mode === "global"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border-strong",
                  )}
                >
                  <input
                    type="radio"
                    checked={syncScope.mode === "global"}
                    onChange={() =>
                      setSyncScope((s) => (s ? { ...s, mode: "global" } : s))
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">
                      {t("skills.sync.globalMode")}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("skills.sync.globalModeHint")}
                    </div>
                  </div>
                </label>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                    syncScope.mode === "specific"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border-strong",
                  )}
                >
                  <input
                    type="radio"
                    checked={syncScope.mode === "specific"}
                    onChange={() =>
                      setSyncScope((s) => (s ? { ...s, mode: "specific" } : s))
                    }
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">
                      {t("skills.sync.specificMode")}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("skills.sync.specificModeHint")}
                    </div>
                  </div>
                </label>
              </div>

              {/* Agent list for specific mode */}
              {syncScope.mode === "specific" && (
                <div className="max-h-[240px] space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {SKILL_AGENTS.map((agentName) => {
                    const detected = detectedAgents.has(agentName);
                    return (
                      <label
                        key={agentName}
                        className={cn(
                          "flex items-center gap-2 rounded-sm p-1.5",
                          detected
                            ? "cursor-pointer hover:bg-accent"
                            : "cursor-not-allowed opacity-50",
                        )}
                      >
                        <Checkbox
                          checked={syncScope.selectedAgents.has(agentName)}
                          onCheckedChange={(checked) => {
                            if (!detected) return;
                            setSyncScope((s) => {
                              if (!s) return s;
                              const next = new Set(s.selectedAgents);
                              if (checked === true) next.add(agentName);
                              else next.delete(agentName);
                              return { ...s, selectedAgents: next };
                            });
                          }}
                          disabled={!detected}
                        />
                        <span className="text-[13px]">{agentName}</span>
                        {!detected && (
                          <Badge
                            variant="outline"
                            className="ml-auto text-[10px] text-muted-foreground"
                          >
                            {t("common.notInstalled")}
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <TTButton
              variant="default"
              disabled={busy}
              onClick={() => setSyncScope(null)}
            >
              {t("common.cancel")}
            </TTButton>
            <TTButton
              variant="primary"
              disabled={busy}
              onClick={confirmSyncScope}
            >
              {t("skills.sync.start")}
            </TTButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FR-017: Sync conflict Dialog */}
      <Dialog
        open={syncConflict !== null}
        onOpenChange={(open) => {
          if (!open) setSyncConflict(null);
        }}
      >
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warn" />
              {t("skills.conflict.title")}
            </DialogTitle>
            <DialogDescription>{t("skills.conflict.desc")}</DialogDescription>
          </DialogHeader>

          {syncConflict && (
            <div className="space-y-3">
              {/* Top-level bulk actions */}
              <div className="flex items-center gap-2">
                <TTButton
                  size="sm"
                  onClick={() => setAllConflictResolutions("overwrite")}
                >
                  {t("skills.conflict.overwriteAll")}
                </TTButton>
                <TTButton
                  size="sm"
                  variant="default"
                  onClick={() => setAllConflictResolutions("skip")}
                >
                  {t("skills.conflict.skipAll")}
                </TTButton>
              </div>

              {/* Conflict list */}
              <ul className="space-y-2">
                {syncConflict.conflicts.map((conflict, index) => (
                  <li
                    key={`${conflict.skillId}-${conflict.agent}`}
                    className="flex items-center justify-between gap-2 rounded-sm border border-border bg-surface-2 p-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">
                        {conflict.skillName}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t("skills.conflict.targetAgent", {
                          agent: conflict.agent,
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setConflictResolution(index, "overwrite")
                        }
                        className={cn(
                          "rounded-sm border px-2 py-1 text-[11px] transition-colors",
                          conflict.resolution === "overwrite"
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t("skills.conflict.overwrite")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConflictResolution(index, "skip")}
                        className={cn(
                          "rounded-sm border px-2 py-1 text-[11px] transition-colors",
                          conflict.resolution === "skip"
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t("skills.conflict.skip")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            <TTButton
              variant="default"
              disabled={busy}
              onClick={() => setSyncConflict(null)}
            >
              {t("common.cancel")}
            </TTButton>
            <TTButton
              variant="primary"
              disabled={busy}
              onClick={confirmSyncConflict}
            >
              {t("skills.sync.start")}
            </TTButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
