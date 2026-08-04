import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Download,
  RefreshCw,
  Search,
  ShieldBan,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dot,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  TTButton,
} from "../components/tt";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import { Checkbox } from "../components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import {
  batchUninstallSkills,
  getLocalSkills,
  installSkill,
  refreshSkillMarketEvidence,
  syncLocalSkill,
  uninstallSkill,
  updateSkillBlacklist,
} from "../lib/local-skills/server-fns";
import {
  SKILL_AGENTS,
  type LocalSkill,
  type SkillAgent,
  type SkillHealth,
  type SkillSnapshot,
} from "../lib/local-skills/types";

export const Route = createFileRoute("/skills")({
  loader: () => getLocalSkills(),
  head: () => ({
    meta: [
      { title: "Skill 管理 · TrustTools V3.0" },
      {
        name: "description",
        content:
          "扫描并管理本机 AI Agent 的 Skill，支持安全复制、跨 Agent 同步与黑名单。",
      },
    ],
  }),
  component: SkillsPage,
});

const PAGE_SIZE = 25;

const healthMeta: Record<
  SkillHealth,
  { label: string; dot: string; color: string }
> = {
  active: { label: "活跃", dot: "bg-ok", color: "text-ok" },
  low: { label: "低频", dot: "bg-warn", color: "text-warn" },
  doze: { label: "休眠", dot: "bg-orange-500", color: "text-orange-500" },
  dead: { label: "长期未活动", dot: "bg-danger", color: "text-danger" },
  unknown: {
    label: "调用未知",
    dot: "bg-muted-foreground",
    color: "text-muted-foreground",
  },
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/**
 * 近 7 天日均调用（仅 Codex 等产 context.skills 的来源可见，否则为 0）。
 */
function dailyAvg(daily?: { date: string; calls: number }[]): number {
  if (!daily || daily.length === 0) return 0;
  // 取序列中最近 7 个日期点求均值
  const tail = daily.slice(-7);
  const sum = tail.reduce((acc, point) => acc + point.calls, 0);
  return Math.round(sum / tail.length);
}

/**
 * 使用趋势：近 7 天 vs 前 7 天的日均差值方向（↑/↓/−）。
 * 数据不足或无序列时返回 "−"。
 */
function trendOf(daily?: { date: string; calls: number }[]): "↑" | "↓" | "−" {
  if (!daily || daily.length < 2) return "−";
  const recent = daily.slice(-7).reduce((acc, p) => acc + p.calls, 0);
  const priorSlice = daily.slice(-14, -7);
  if (priorSlice.length === 0) return recent > 0 ? "↑" : "−";
  const prior =
    priorSlice.reduce((acc, p) => acc + p.calls, 0) / priorSlice.length;
  const recentAvg = recent / Math.min(7, daily.slice(-7).length);
  if (prior === 0) return recentAvg > 0 ? "↑" : "−";
  const delta = (recentAvg - prior) / prior;
  if (delta > 0.1) return "↑";
  if (delta < -0.1) return "↓";
  return "−";
}

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

function SkillsPage() {
  const initial = Route.useLoaderData();
  const [snapshot, setSnapshot] = useState<SkillSnapshot>(initial);
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState<"all" | SkillHealth>("all");
  const [agent, setAgent] = useState<"all" | SkillAgent>("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);
  const [page, setPage] = useState(1);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(
    () => new Set(),
  );
  const [uninstallTarget, setUninstallTarget] =
    useState<UninstallTarget | null>(null);
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
    } else if (message) {
      snapshotRef.current = next;
      setSnapshot(next);
    }
    if (message) toast.success(message);
  }, []);

  useEffect(() => {
    let stopped = false;
    const synchronize = async () => {
      if (stopped || document.visibilityState !== "visible" || busyRef.current)
        return;
      try {
        await refreshSkillMarketEvidence();
        await refresh();
      } catch {
        return;
      }
    };
    const timer = window.setInterval(synchronize, 5_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void synchronize();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  // Reset to first page when filters or sort change
  useEffect(() => {
    setPage(1);
  }, [query, health, agent, sortDir]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    busyRef.current = true;
    try {
      await action();
      await refresh(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
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
        SKILL_AGENTS.filter((a) =>
          snapshot.skills.some((s) =>
            s.installations.some((i) => i.agent === a),
          ),
        ),
      ),
    [snapshot.skills],
  );

  // Filtered list (search by name OR description + health + agent filters)
  const filtered = useMemo(
    () =>
      snapshot.skills.filter((skill) => {
        const q = query.toLowerCase();
        const nameMatch = skill.name.toLowerCase().includes(q);
        const descMatch = skill.description?.toLowerCase().includes(q) ?? false;
        return (
          (nameMatch || descMatch) &&
          (health === "all" || skill.health === health) &&
          (agent === "all" ||
            skill.installations.some((i) => i.agent === agent))
        );
      }),
    [agent, health, query, snapshot.skills],
  );

  // Sorted list
  const sorted = useMemo(() => {
    if (!sortDir) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "zh-CN");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortDir]);

  // Paginated list
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [sorted, currentPage],
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
          await uninstallSkill({ data: installation.path });
        }
        await refresh(`${target.skill.name} 已永久删除`);
      } else {
        const paths = [
          ...new Set(
            target.skills.flatMap((s) => s.installations.map((i) => i.path)),
          ),
        ];
        if (paths.length === 0) {
          toast.success("没有需要卸载的副本");
        } else {
          const result = await batchUninstallSkills({ data: paths });
          setCheckedIds(new Set());
          await refresh();
          if (result.succeeded.length > 0) {
            toast.success(`${result.succeeded.length} 个安装副本已永久删除`);
          }
          if (result.failed.length > 0) {
            toast.error(
              `${result.failed.length} 项清理失败：${result.failed
                .map((f) => `${f.path}（${f.error}）`)
                .join("；")}`,
            );
          }
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "卸载失败");
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  // --- Sync handlers ---

  const openSyncScope = (skills: LocalSkill[]) => {
    const valid = skills.filter((s) => s.installations.length > 0);
    if (valid.length === 0) {
      toast.error("所选 Skill 没有可同步的安装副本");
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
      toast.error("请至少选择一个目标工具");
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
        const sourcePath = skill.installations[0]?.path;
        if (!sourcePath) continue;

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
            const result = await syncLocalSkill({
              data: {
                sourcePath,
                targetAgents: overwriteAgents,
                onConflict: "overwrite",
              },
            });
            succeeded += result.succeeded.length;
            skipped += result.skipped.length;
            failed += result.failed.length;
            result.failed.forEach((f) =>
              failedDetails.push(`${skill.name} → ${f.agent}: ${f.error}`),
            );
          } catch (error) {
            failed += overwriteAgents.length;
            failedDetails.push(
              `${skill.name}: ${error instanceof Error ? error.message : "同步失败"}`,
            );
          }
        }

        if (skipAgents.length > 0) {
          try {
            const result = await syncLocalSkill({
              data: {
                sourcePath,
                targetAgents: skipAgents,
                onConflict: "skip",
              },
            });
            succeeded += result.succeeded.length;
            skipped += result.skipped.length;
            failed += result.failed.length;
            result.failed.forEach((f) =>
              failedDetails.push(`${skill.name} → ${f.agent}: ${f.error}`),
            );
          } catch (error) {
            failed += skipAgents.length;
            failedDetails.push(
              `${skill.name}: ${error instanceof Error ? error.message : "同步失败"}`,
            );
          }
        }
      }

      await refresh();
      const message = `同步完成：成功 ${succeeded} 条 / 跳过 ${skipped} 条${failed > 0 ? ` / 失败 ${failed} 条` : ""}`;
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
    sorted.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, sorted.length);

  const toggleSort = () => {
    setSortDir((current) => {
      if (current === null) return "asc";
      if (current === "asc") return "desc";
      return null;
    });
  };

  return (
    <>
      <PageHeader
        title="Skill 管理"
        desc={`${snapshot.healthBasis} 扫描于 ${formatTime(snapshot.generatedAt)}`}
      />

      {/* Filter bar */}
      <div className="tt-panel mb-3 flex flex-wrap items-center gap-2 p-3">
        <span className="text-[11px] text-muted-foreground">
          页面可见时每 5 秒按变更指纹轮询（非原生 watcher）
        </span>
        <div className="relative min-w-[180px] flex-1 sm:max-w-64">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称或描述…"
            className="h-8 w-full rounded-sm border border-border bg-surface-2 pl-8 text-[13px] outline-none focus:border-primary"
          />
        </div>
        <select
          value={health}
          onChange={(event) =>
            setHealth(event.target.value as "all" | SkillHealth)
          }
          className="h-8 rounded-sm border border-border bg-surface px-2 text-[13px]"
        >
          <option value="all">健康度：全部</option>
          <option value="active">活跃</option>
          <option value="low">低频</option>
          <option value="doze">休眠</option>
          <option value="dead">长期未活动</option>
          <option value="unknown">调用未知</option>
        </select>
        <select
          value={agent}
          onChange={(event) =>
            setAgent(event.target.value as "all" | SkillAgent)
          }
          className="h-8 rounded-sm border border-border bg-surface px-2 text-[13px]"
        >
          <option value="all">安装位置：全部</option>
          {SKILL_AGENTS.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <TTButton
          className="ml-auto"
          disabled={busy}
          onClick={() => run(() => Promise.resolve(), "已重新扫描本地 Skill")}
        >
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />{" "}
          刷新扫描
        </TTButton>
      </div>

      {/* Skill table */}
      <Panel title={`Skill 列表（${sorted.length}）`} bodyClassName="p-0">
        {sorted.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="没有匹配的 Skill"
              desc="调整筛选条件，或添加监控目录后重新扫描。"
              actions={
                <>
                  <Link to="/settings">
                    <TTButton>添加监控目录</TTButton>
                  </Link>
                  <Link to="/market">
                    <TTButton>去市场看看</TTButton>
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
                  aria-label="全选当前页"
                />
                全选当前页
              </label>
              <span className="text-xs text-muted-foreground">
                已选 {checkedSkills.length} 项
              </span>
              <div className="ml-auto flex items-center gap-2">
                <TTButton
                  size="sm"
                  disabled={busy || checkedSkills.length === 0}
                  onClick={() => openSyncScope(checkedSkills)}
                >
                  <Copy className="size-3" /> 批量同步
                </TTButton>
                <TTButton
                  size="sm"
                  variant="danger"
                  disabled={busy || checkedSkills.length === 0}
                  onClick={openBatchUninstall}
                >
                  <Trash2 className="size-3" /> 批量卸载
                </TTButton>
                <TTButton
                  size="sm"
                  variant="ghost"
                  disabled={busy || checkedSkills.length === 0}
                  onClick={clearSelection}
                >
                  取消选择
                </TTButton>
              </div>
            </div>

            {/* Table */}
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[40px] pl-4" />
                  <TableHead
                    onClick={toggleSort}
                    className={cn(
                      "cursor-pointer select-none whitespace-nowrap",
                      sortDir !== null && "text-primary",
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      名称
                      {sortDir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : sortDir === "desc" ? (
                        <ArrowDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-50" />
                      )}
                    </span>
                  </TableHead>
                  <TableHead className="min-w-[100px]">描述</TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap text-right">
                    调用
                  </TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap text-right">
                    日均
                  </TableHead>
                  <TableHead className="w-[60px] whitespace-nowrap text-center">
                    趋势
                  </TableHead>
                  <TableHead className="w-[200px]">安装位置</TableHead>
                  <TableHead className="w-[140px] whitespace-nowrap">
                    最近使用时间
                  </TableHead>
                  <TableHead className="w-[130px] pr-4">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((skill) => {
                  const agents = skill.installations.map((i) => i.agent);
                  const visibleAgents = expandedAgents.has(skill.id)
                    ? agents
                    : agents.slice(0, 3);
                  const hiddenCount = agents.length - visibleAgents.length;
                  return (
                    <TableRow
                      key={skill.id}
                      className={cn(
                        "cursor-default",
                        checkedIds.has(skill.id) && "bg-accent/30",
                      )}
                    >
                      <TableCell className="pl-4">
                        <Checkbox
                          checked={checkedIds.has(skill.id)}
                          onCheckedChange={(checked) =>
                            toggleChecked(skill.id, checked === true)
                          }
                          disabled={busy}
                          aria-label={`选择 ${skill.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Dot className={healthMeta[skill.health].dot} />
                          <button
                            type="button"
                            onClick={() => setDetailSkillId(skill.id)}
                            className="truncate text-left text-[13px] font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {skill.name}
                          </button>
                          {snapshot.blacklist.includes(skill.name) && (
                            <span className="rounded-sm bg-danger/15 px-1.5 py-0.5 text-[10px] text-danger">
                              黑名单
                            </span>
                          )}
                        </div>
                        {skill.installations[0] && (
                          <div className="tt-num mt-0.5 truncate text-[10px] text-muted-foreground">
                            {skill.installations[0].path}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <span className="line-clamp-2 text-[12px] text-muted-foreground">
                          {skill.description ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="tt-num tabular-nums text-right text-[12px] text-muted-foreground">
                        {skill.usageCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="tt-num tabular-nums text-right text-[12px] text-muted-foreground">
                        {dailyAvg(skill.daily)}
                      </TableCell>
                      <TableCell className="tt-num text-center text-[12px]">
                        {(() => {
                          const t = trendOf(skill.daily);
                          return (
                            <span
                              className={
                                t === "↑"
                                  ? "text-ok"
                                  : t === "↓"
                                    ? "text-danger"
                                    : "text-muted-foreground"
                              }
                            >
                              {t}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          {visibleAgents.map((a, idx) => (
                            <Badge
                              key={`${a}-${idx}`}
                              variant="secondary"
                              className="text-[10px] font-normal"
                            >
                              {a}
                            </Badge>
                          ))}
                          {hiddenCount > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleAgentsExpanded(skill.id)}
                              className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              +{hiddenCount}
                            </button>
                          )}
                          {hiddenCount === 0 &&
                            expandedAgents.has(skill.id) &&
                            agents.length > 3 && (
                              <button
                                type="button"
                                onClick={() => toggleAgentsExpanded(skill.id)}
                                className="text-[10px] text-muted-foreground hover:text-foreground"
                              >
                                收起
                              </button>
                            )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground">
                        {skill.lastUsedAt ? formatTime(skill.lastUsedAt) : "—"}
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex items-center gap-1">
                          <TTButton
                            size="sm"
                            disabled={busy || skill.installations.length === 0}
                            onClick={() => openSyncScope([skill])}
                            title="跨 Agent 同步"
                          >
                            <Copy className="size-3" /> 同步
                          </TTButton>
                          <TTButton
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() => openUninstall(skill)}
                            title="卸载"
                          >
                            <Trash2 className="size-3" /> 卸载
                          </TTButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Pagination footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
              <span className="text-xs text-muted-foreground">
                第 {rangeStart}-{rangeEnd} 条 / 共 {sorted.length} 条
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
                  <Dot className={healthMeta[detailSkill.health].dot} />
                  {detailSkill.name}
                </SheetTitle>
                <SheetDescription>
                  {detailSkill.description ?? "暂无描述"}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4 text-[13px]">
                {/* Source path */}
                <div>
                  <div className="tt-label mb-1">来源路径</div>
                  {detailSkill.installations.map((inst) => (
                    <div
                      key={inst.path}
                      className="tt-num mt-1 break-all text-[11px] text-muted-foreground"
                    >
                      {inst.path}
                    </div>
                  ))}
                </div>

                {/* Health info */}
                <div className="text-[12px] text-muted-foreground">
                  <p>{detailSkill.healthReason}</p>
                  <p className="mt-1">
                    最近调用：
                    {detailSkill.lastUsedAt == null
                      ? "暂无可验证记录"
                      : formatTime(detailSkill.lastUsedAt)}
                    {" · "}累计识别：{detailSkill.usageCount.toLocaleString()}{" "}
                    次
                  </p>
                </div>

                {/* Per-agent install status (all 9 agents) */}
                <div>
                  <div className="tt-label mb-2">安装状态</div>
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
                                  已安装
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-muted-foreground"
                                >
                                  未安装
                                </Badge>
                              )}
                            </div>
                            {installation && (
                              <>
                                <div className="tt-num mt-1 break-all text-[10px] text-muted-foreground">
                                  {installation.path}
                                </div>
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  安装：{formatTime(installation.installedAt)}
                                  {" · "}修改：
                                  {formatTime(installation.modifiedAt)}
                                </div>
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  版本：{installation.version ?? "未提供"}
                                  {" · "}来源：
                                  {installation.source?.label ?? "未提供"}
                                </div>
                                <div
                                  className={cn(
                                    "mt-1 text-[10px]",
                                    installation.updateStatus === "available"
                                      ? "text-warn"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  更新状态：
                                  {installation.updateStatus === "available"
                                    ? "可更新"
                                    : installation.updateStatus === "current"
                                      ? "已是当前证据版本"
                                      : "无法判断"}
                                  （{installation.updateReason}）
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
                                    uninstallSkill({
                                      data: installation.path,
                                    }),
                                  `${detailSkill.name} 已从 ${agentName} 卸载`,
                                )
                              }
                            >
                              卸载
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
                                    installSkill({
                                      data: {
                                        sourcePath:
                                          detailSkill.installations[0].path,
                                        targetAgent: agentName,
                                      },
                                    }),
                                  `${detailSkill.name} 已安装到 ${agentName}`,
                                )
                              }
                            >
                              <Download className="size-3" /> 安装
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
                    onClick={() =>
                      run(
                        () =>
                          updateSkillBlacklist({
                            data: {
                              name: detailSkill.name,
                              blocked: !isBlocked,
                            },
                          }),
                        isBlocked ? "已移出黑名单" : "已加入黑名单",
                      )
                    }
                  >
                    <ShieldBan className="size-3.5" />
                    {isBlocked ? "移出黑名单" : "加入黑名单"}
                  </TTButton>
                  <TTButton
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      setDetailSkillId(null);
                      openUninstall(detailSkill);
                    }}
                  >
                    <Trash2 className="size-3.5" /> 卸载全部副本
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
              确认卸载
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1">
                <p>
                  将从全部已安装工具中移除
                  {uninstallTarget?.type === "batch"
                    ? ` ${uninstallTarget.skills.length} 个 Skill`
                    : ` ${uninstallTarget?.skill.name ?? ""}`}
                  。
                </p>
                <p className="text-danger">此操作不可撤销</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void confirmUninstall();
              }}
              className="border-danger bg-danger text-white shadow-sm hover:bg-danger/90"
            >
              确认卸载
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
            <DialogTitle>同步 Skill</DialogTitle>
            <DialogDescription>
              将所选 Skill 同步安装到其他 Agent 的 skills 目录
            </DialogDescription>
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
                      同步到全部工具（全局）
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      覆盖本地已安装的 agent，未安装的自动跳过
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
                    <div className="text-sm font-medium">仅同步到指定工具</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      勾选需要同步到的目标 Agent
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
                            未安装
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
              取消
            </TTButton>
            <TTButton
              variant="primary"
              disabled={busy}
              onClick={confirmSyncScope}
            >
              开始同步
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
              同步冲突
            </DialogTitle>
            <DialogDescription>
              以下目标 Agent 已存在同名 Skill，请选择处理方式
            </DialogDescription>
          </DialogHeader>

          {syncConflict && (
            <div className="space-y-3">
              {/* Top-level bulk actions */}
              <div className="flex items-center gap-2">
                <TTButton
                  size="sm"
                  onClick={() => setAllConflictResolutions("overwrite")}
                >
                  全部覆盖
                </TTButton>
                <TTButton
                  size="sm"
                  variant="default"
                  onClick={() => setAllConflictResolutions("skip")}
                >
                  全部跳过
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
                        目标 Agent：{conflict.agent}
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
                        覆盖
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
                        跳过
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
              取消
            </TTButton>
            <TTButton
              variant="primary"
              disabled={busy}
              onClick={confirmSyncConflict}
            >
              开始同步
            </TTButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
