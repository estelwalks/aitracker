import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, RotateCcw, Search, ShieldBan, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Dot, EmptyState, PageHeader, Panel, StatusBadge, TTButton } from "../components/tt";
import {
  batchUninstallSkills,
  getLocalSkills,
  installSkill,
  refreshSkillMarketEvidence,
  restoreSkill,
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
        content: "扫描并管理本机 AI Agent 的 Skill，支持安全复制、回收站恢复与黑名单。",
      },
    ],
  }),
  component: SkillsPage,
});

const healthMeta: Record<SkillHealth, { label: string; dot: string; color: string }> = {
  active: { label: "活跃", dot: "bg-ok", color: "text-ok" },
  low: { label: "低频", dot: "bg-warn", color: "text-warn" },
  doze: { label: "休眠", dot: "bg-orange-500", color: "text-orange-500" },
  dead: { label: "长期未活动", dot: "bg-danger", color: "text-danger" },
  unknown: { label: "调用未知", dot: "bg-muted-foreground", color: "text-muted-foreground" },
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

function SkillsPage() {
  const initial = Route.useLoaderData();
  const [snapshot, setSnapshot] = useState<SkillSnapshot>(initial);
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState<"all" | SkillHealth>("all");
  const [agent, setAgent] = useState<"all" | SkillAgent>("all");
  const [selectedId, setSelectedId] = useState(initial.skills[0]?.id ?? "");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
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
      setSelectedId((current) =>
        next.skills.some((skill) => skill.id === current) ? current : (next.skills[0]?.id ?? ""),
      );
    } else if (message) {
      snapshotRef.current = next;
      setSnapshot(next);
    }
    if (message) toast.success(message);
  }, []);

  useEffect(() => {
    let stopped = false;
    const synchronize = async () => {
      if (stopped || document.visibilityState !== "visible" || busyRef.current) return;
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

  const list = useMemo(
    () =>
      snapshot.skills.filter(
        (skill) =>
          skill.name.toLowerCase().includes(query.toLowerCase()) &&
          (health === "all" || skill.health === health) &&
          (agent === "all" ||
            skill.installations.some((installation) => installation.agent === agent)),
      ),
    [agent, health, query, snapshot.skills],
  );
  const selected: LocalSkill | undefined = snapshot.skills.find((skill) => skill.id === selectedId);
  const isBlocked = selected ? snapshot.blacklist.includes(selected.name) : false;
  const visibleIds = useMemo(() => new Set(list.map((skill) => skill.id)), [list]);
  const checkedVisible = list.filter((skill) => checkedIds.has(skill.id));
  const allVisibleChecked = list.length > 0 && checkedVisible.length === list.length;

  const toggleAllVisible = () => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (allVisibleChecked) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };

  const batchUninstall = async () => {
    const paths = [
      ...new Set(
        checkedVisible.flatMap((skill) =>
          skill.installations.map((installation) => installation.path),
        ),
      ),
    ];
    if (paths.length === 0) return;
    if (
      !window.confirm(
        `确认清理已选的 ${checkedVisible.length} 个 Skill（${paths.length} 个安装副本）？成功项可在 5 分钟内恢复。`,
      )
    ) {
      return;
    }

    setBusy(true);
    busyRef.current = true;
    try {
      const result = await batchUninstallSkills({ data: paths });
      setCheckedIds(new Set());
      await refresh();
      if (result.succeeded.length > 0) {
        toast.success(`${result.succeeded.length} 个安装副本已移至 5 分钟回收站`);
      }
      if (result.failed.length > 0) {
        toast.error(
          `${result.failed.length} 项清理失败：${result.failed
            .map((item) => `${item.path}（${item.error}）`)
            .join("；")}`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "批量清理失败");
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  const uninstallAll = (skill: LocalSkill) =>
    run(async () => {
      for (const installation of skill.installations) {
        await uninstallSkill({ data: installation.path });
      }
    }, `${skill.name} 已移至回收站，可在 5 分钟内恢复`);

  return (
    <>
      <PageHeader
        eyebrow="本地技能资产"
        title="Skill 管理"
        desc={`${snapshot.healthBasis} 扫描于 ${formatTime(snapshot.generatedAt)}`}
        status={
          <StatusBadge tone="ok">
            <Dot className="size-1 bg-ok" /> {snapshot.skills.length} 个真实 Skill
          </StatusBadge>
        }
      />

      <div className="tt-panel mb-3 flex flex-wrap items-center gap-2 p-3">
        <span className="text-[11px] text-muted-foreground">
          页面可见时每 5 秒按变更指纹轮询（非原生 watcher）
        </span>
        <div className="relative min-w-[180px] flex-1 sm:max-w-64">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Skill…"
            className="h-8 w-full rounded-sm border border-border bg-surface-2 pl-8 text-[13px] outline-none focus:border-primary"
          />
        </div>
        <select
          value={health}
          onChange={(event) => setHealth(event.target.value as "all" | SkillHealth)}
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
          onChange={(event) => setAgent(event.target.value as "all" | SkillAgent)}
          className="h-8 rounded-sm border border-border bg-surface px-2 text-[13px]"
        >
          <option value="all">Agent：全部</option>
          {SKILL_AGENTS.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <TTButton
          className="ml-auto"
          disabled={busy}
          onClick={() => run(() => Promise.resolve(), "已重新扫描本地 Skill")}
        >
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> 刷新扫描
        </TTButton>
      </div>

      {snapshot.trash.length > 0 && (
        <Panel className="mb-3" title={`回收站（${snapshot.trash.length}）`}>
          <ul className="space-y-2">
            {snapshot.trash.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-3 rounded-sm border border-border bg-surface-2 px-3 py-2 text-[13px]"
              >
                <Trash2 className="size-3.5 text-muted-foreground" />
                <span className="font-medium">{entry.skillName}</span>
                <span className="text-muted-foreground">{entry.agent}</span>
                <span className="tt-num ml-auto text-[11px] text-warn">
                  恢复截止 {formatTime(entry.expiresAt)}
                </span>
                <TTButton
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(() => restoreSkill({ data: entry.id }), `${entry.skillName} 已恢复`)
                  }
                >
                  <RotateCcw className="size-3" /> 恢复
                </TTButton>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,62%)_minmax(0,1fr)]">
        <Panel title={`Skill 列表（${list.length}）`} bodyClassName="p-0">
          {list.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="未扫描到 Skill"
                desc="已检查 8 个 Agent 常见路径；也可以前往设置确认本机环境。"
                actions={
                  <Link to="/settings">
                    <TTButton>打开设置</TTButton>
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allVisibleChecked}
                    onChange={toggleAllVisible}
                    disabled={busy}
                  />
                  全选当前筛选
                </label>
                <span className="text-xs text-muted-foreground">
                  已选 {checkedVisible.length} 项
                </span>
                <TTButton
                  className="ml-auto"
                  size="sm"
                  variant="danger"
                  disabled={busy || checkedVisible.length === 0}
                  onClick={() => void batchUninstall()}
                >
                  <Trash2 className="size-3" /> 批量清理
                </TTButton>
              </div>
              <ul className="divide-y divide-border">
                {list.map((skill) => (
                  <li
                    key={skill.id}
                    onClick={() => setSelectedId(skill.id)}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-3 ${
                      selectedId === skill.id ? "bg-accent/60" : "hover:bg-accent/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checkedIds.has(skill.id)}
                      disabled={busy}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        setCheckedIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(skill.id);
                          else next.delete(skill.id);
                          return next;
                        });
                      }}
                      aria-label={`选择 ${skill.name}`}
                    />
                    <Dot className={healthMeta[skill.health].dot} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{skill.name}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {skill.installations.map((item) => item.agent).join(" + ")}
                      </div>
                    </div>
                    {snapshot.blacklist.includes(skill.name) && (
                      <span className="rounded-sm bg-danger/15 px-1.5 py-0.5 text-[10px] text-danger">
                        黑名单
                      </span>
                    )}
                    <span className={`text-xs ${healthMeta[skill.health].color}`}>
                      {healthMeta[skill.health].label}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="Skill 详情">
          {!selected ? (
            <p className="text-[13px] text-muted-foreground">选择一个 Skill 查看详情。</p>
          ) : (
            <div className="space-y-4 text-[13px]">
              <div>
                <div className="text-base font-semibold">{selected.name}</div>
                <p className="mt-1 text-xs text-muted-foreground">{selected.healthReason}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  最近调用：
                  {selected.lastUsedAt == null ? "暂无可验证记录" : formatTime(selected.lastUsedAt)}
                  {" · "}累计识别：{selected.usageCount.toLocaleString()} 次
                </p>
              </div>
              <div>
                <div className="tt-label mb-2">真实安装位置</div>
                <ul className="space-y-2">
                  {selected.installations.map((installation) => (
                    <li
                      key={installation.path}
                      className="rounded-sm border border-border bg-surface-2 p-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{installation.agent}</span>
                        <TTButton
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => uninstallSkill({ data: installation.path }),
                              `${selected.name} 已移至回收站`,
                            )
                          }
                        >
                          卸载
                        </TTButton>
                      </div>
                      <div className="tt-num mt-1 break-all text-[10px] text-muted-foreground">
                        {installation.path}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        安装：{formatTime(installation.installedAt)} · 修改：
                        {formatTime(installation.modifiedAt)}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        版本：{installation.version ?? "未提供"} · 来源：
                        {installation.source?.label ?? "未提供"}
                      </div>
                      <div
                        className={`mt-1 text-[10px] ${
                          installation.updateStatus === "available"
                            ? "text-warn"
                            : "text-muted-foreground"
                        }`}
                      >
                        更新状态：
                        {installation.updateStatus === "available"
                          ? "可更新"
                          : installation.updateStatus === "current"
                            ? "已是当前证据版本"
                            : "无法判断"}
                        （{installation.updateReason}）
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="tt-label mb-2">复制安装到</div>
                <div className="flex flex-wrap gap-2">
                  {SKILL_AGENTS.filter(
                    (target) =>
                      !selected.installations.some((installation) => installation.agent === target),
                  ).map((target) => (
                    <TTButton
                      key={target}
                      size="sm"
                      disabled={busy || isBlocked}
                      onClick={() =>
                        run(
                          () =>
                            installSkill({
                              data: {
                                sourcePath: selected.installations[0].path,
                                targetAgent: target,
                              },
                            }),
                          `${selected.name} 已安装到 ${target}`,
                        )
                      }
                    >
                      <Download className="size-3" /> {target}
                    </TTButton>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                <TTButton
                  disabled={busy}
                  variant={isBlocked ? "default" : "danger"}
                  onClick={() =>
                    run(
                      () =>
                        updateSkillBlacklist({
                          data: { name: selected.name, blocked: !isBlocked },
                        }),
                      isBlocked ? "已移出黑名单" : "已加入黑名单",
                    )
                  }
                >
                  <ShieldBan className="size-3.5" />
                  {isBlocked ? "移出黑名单" : "加入黑名单"}
                </TTButton>
                <TTButton variant="danger" disabled={busy} onClick={() => uninstallAll(selected)}>
                  <Trash2 className="size-3.5" /> 卸载全部副本
                </TTButton>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
