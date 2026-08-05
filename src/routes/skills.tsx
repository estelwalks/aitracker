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
import { toUiError } from "../lib/errors";
import { useI18n } from "../lib/i18n/context";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
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
  type SkillSnapshot,
} from "../lib/local-skills/types";

export const Route = createFileRoute("/skills")({
  loader: async ({ location }) => {
    const data = await getLocalSkills();
    return { ...data, locale: resolveLocaleFromSearch(location.search) };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.skills",
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "skills.metaDesc",
        ),
      },
    ],
  }),
  component: SkillsPage,
});

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

function SkillsPage() {
  const { t, format } = useI18n();
  const initial = Route.useLoaderData();
  const [snapshot, setSnapshot] = useState<SkillSnapshot>(initial);
  const [query, setQuery] = useState("");
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
  }, [query, agent, sortDir]);

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
        SKILL_AGENTS.filter((a) =>
          snapshot.skills.some((s) =>
            s.installations.some((i) => i.agent === a),
          ),
        ),
      ),
    [snapshot.skills],
  );

  // Filtered list (search by name OR description + agent filter)
  const filtered = useMemo(
    () =>
      snapshot.skills.filter((skill) => {
        const q = query.toLowerCase();
        const nameMatch = skill.name.toLowerCase().includes(q);
        const descMatch = skill.description?.toLowerCase().includes(q) ?? false;
        return (
          (nameMatch || descMatch) &&
          (agent === "all" ||
            skill.installations.some((i) => i.agent === agent))
        );
      }),
    [agent, query, snapshot.skills],
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
        await refresh(t("skills.toast.deleted", { name: target.skill.name }));
      } else {
        const paths = [
          ...new Set(
            target.skills.flatMap((s) => s.installations.map((i) => i.path)),
          ),
        ];
        if (paths.length === 0) {
          toast.success(t("skills.toast.nothingToUninstall"));
        } else {
          const result = await batchUninstallSkills({ data: paths });
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
                      path: f.path,
                      error: f.error,
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
            const ui = toUiError(error);
            failedDetails.push(
              `${skill.name}: ${ui ? t(ui.code, ui.params) : t("skills.toast.syncFailed")}`,
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
        title={t("skills.pageHeader")}
        desc={t("skills.pageHeaderDesc", {
          count: format.formatNumber(snapshot.skills.length),
          time: format.formatDateTime(snapshot.generatedAt, false),
        })}
      />

      {/* Filter bar */}
      <div className="tt-panel mb-3 flex flex-wrap items-center gap-2 p-3">
        <span className="text-[11px] text-muted-foreground">
          {t("skills.pollingHint")}
        </span>
        <div className="relative min-w-[180px] flex-1 sm:max-w-64">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("skills.searchPlaceholder")}
            className="h-8 w-full rounded-sm border border-border bg-surface-2 pl-8 text-[13px] outline-none focus:border-primary"
          />
        </div>
        <select
          value={agent}
          onChange={(event) =>
            setAgent(event.target.value as "all" | SkillAgent)
          }
          className="h-8 rounded-sm border border-border bg-surface px-2 text-[13px]"
        >
          <option value="all">{t("skills.filter.agentAll")}</option>
          {SKILL_AGENTS.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <TTButton
          className="ml-auto"
          disabled={busy}
          onClick={() =>
            run(() => Promise.resolve(), t("skills.toast.rescanned"))
          }
        >
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />{" "}
          {t("skills.actions.rescan")}
        </TTButton>
      </div>

      {/* Skill table */}
      <Panel
        title={t("skills.table.title", {
          count: format.formatNumber(sorted.length),
        })}
        bodyClassName="p-0"
      >
        {sorted.length === 0 ? (
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
                      {t("skills.table.name")}
                      {sortDir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : sortDir === "desc" ? (
                        <ArrowDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-50" />
                      )}
                    </span>
                  </TableHead>
                  <TableHead className="min-w-[100px]">
                    {t("skills.table.desc")}
                  </TableHead>
                  <TableHead className="w-[200px]">
                    {t("skills.table.agent")}
                  </TableHead>
                  <TableHead className="w-[140px] whitespace-nowrap">
                    {t("skills.table.lastUsed")}
                  </TableHead>
                  <TableHead className="w-[130px] pr-4">
                    {t("skills.table.actions")}
                  </TableHead>
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
                          aria-label={t("skills.aria.selectSkill", {
                            name: skill.name,
                          })}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailSkillId(skill.id)}
                            className="truncate text-left text-[13px] font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {skill.name}
                          </button>
                          {snapshot.blacklist.includes(skill.name) && (
                            <span className="rounded-sm bg-danger/15 px-1.5 py-0.5 text-[10px] text-danger">
                              {t("skills.badge.blacklisted")}
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
                                {t("common.collapse")}
                              </button>
                            )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground">
                        {skill.lastUsedAt
                          ? format.formatDateTime(skill.lastUsedAt, false)
                          : "—"}
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex items-center gap-1">
                          <TTButton
                            size="sm"
                            disabled={busy || skill.installations.length === 0}
                            onClick={() => openSyncScope([skill])}
                            title={t("skills.actions.syncTitle")}
                          >
                            <Copy className="size-3" />{" "}
                            {t("skills.actions.sync")}
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Pagination footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
              <span className="text-xs text-muted-foreground">
                {t("skills.pagination.range", {
                  start: format.formatNumber(rangeStart),
                  end: format.formatNumber(rangeEnd),
                  total: format.formatNumber(sorted.length),
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
                {/* Source path */}
                <div>
                  <div className="tt-label mb-1">
                    {t("skills.detail.sourcePath")}
                  </div>
                  {detailSkill.installations.map((inst) => (
                    <div
                      key={inst.path}
                      className="tt-num mt-1 break-all text-[11px] text-muted-foreground"
                    >
                      {inst.path}
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
                                  {installation.path}
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
                                  {" · "}
                                  {t("skills.detail.source", {
                                    source:
                                      installation.source?.label ??
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
                                  {t("skills.detail.updateStatus", {
                                    status:
                                      installation.updateStatus === "available"
                                        ? t("skills.detail.updateAvailable")
                                        : installation.updateStatus ===
                                            "current"
                                          ? t("skills.detail.updateCurrent")
                                          : t("skills.detail.updateUnknown"),
                                    reason: installation.updateReason,
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
                                    uninstallSkill({
                                      data: installation.path,
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
                                    installSkill({
                                      data: {
                                        sourcePath:
                                          detailSkill.installations[0].path,
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
                    onClick={() =>
                      run(
                        () =>
                          updateSkillBlacklist({
                            data: {
                              name: detailSkill.name,
                              blocked: !isBlocked,
                            },
                          }),
                        isBlocked
                          ? t("skills.toast.unblocked")
                          : t("skills.toast.blocked"),
                      )
                    }
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
