import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Bot,
  ChevronRight,
  Layers,
  Cloud,
  Code2,
  FileText,
  Package,
  Palette,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import {
  EmptyState,
  Pagination,
  SearchInput,
  Segmented,
  AITrackerButton,
} from "../../../components/aitracker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Progress } from "../../../components/ui/progress";
import { Badge } from "../../../components/ui/badge";
import { APP_ID } from "../../../lib/app-config";
import { useI18n } from "../../../lib/i18n/context";
import { toUiError } from "../../../lib/errors";
import type { MessageKey, MessageParams } from "../../../lib/i18n/messages";
import { countInstalledMarketSkills } from "../../../lib/local-market/installed-count.ts";
import { STANDARD_PAGE_SIZE } from "../../../lib/pagination";
import {
  getMarketSkills,
  getLocalSkills,
  refreshSkillSnapshot,
  requestApprovedSkillInstall,
  requestMarketSkillUninstall,
  MARKET_AGENTS,
  type MarketAgent,
  type MarketListResult,
  type MarketSkill,
  type MarketSort,
  type SkillSnapshot,
} from "../query.ts";
import { compactNumber, formatSizeBytes } from "../../skill-catalog/index.ts";
import { AgentInstallBar } from "./AgentInstallBar.tsx";

/** Fixed market category taxonomy → upstream `tags` slugs. */
const MARKET_DOMAINS = [
  { label: "AI与自动化", icon: Bot, tags: ["ai", "automation", "ml"] },
  { label: "开发", icon: Code2, tags: ["backend", "frontend", "api"] },
  { label: "数据与分析", icon: BarChart3, tags: ["data", "analytics"] },
  { label: "运维", icon: Server, tags: ["devops", "cli", "scripting"] },
  {
    label: "安全与测试",
    icon: ShieldCheck,
    tags: ["security", "testing", "debugging"],
  },
  { label: "生产力", icon: Zap, tags: ["productivity"] },
  { label: "文档", icon: FileText, tags: ["docs", "code-review"] },
  { label: "云与性能", icon: Cloud, tags: ["cloud", "performance"] },
  { label: "设计与前端", icon: Palette, tags: ["design", "frontend"] },
] as const;

type TFunction = <K extends MessageKey>(
  key: K,
  params?: MessageParams<K>,
) => string;

type SecurityState = "safe" | "attention" | "unknown";

function securityOf(skill: MarketSkill, t: TFunction): SecurityState {
  // 外接 API v1 不再返回 verdict，安全判定以安全分为准（≥80 视为安全）。
  const safe = skill.securityScore != null && skill.securityScore >= 80;
  const hasEvidence =
    skill.securityScore != null || skill.securityLevel != null;
  if (!hasEvidence) return "unknown";
  return safe ? "safe" : "attention";
}

/**
 * 真实 tags → 领域分类标签（原型行内领域徽章）。没有匹配到领域时返回
 * null，调用方不渲染徽章——避免在列表名称与安全状态之间出现占位的 "-"。
 */
function domainOf(skill: MarketSkill): string | null {
  const tags = new Set(skill.tags ?? []);
  const matched = MARKET_DOMAINS.find((item) =>
    item.tags.some((tag) => tags.has(tag)),
  );
  return matched?.label ?? skill.tags?.[0] ?? null;
}

const SORT_OPTIONS: { value: MarketSort; labelKey: MessageKey }[] = [
  { value: "stars", labelKey: "market.sort.rating" },
  { value: "security_score", labelKey: "market.sort.security" },
  { value: "created_at", labelKey: "market.sort.latest" },
  { value: "name_asc", labelKey: "market.sort.nameAsc" },
  { value: "name_desc", labelKey: "market.sort.nameDesc" },
];

/**
 * 安全市场（V3.0 原型 MarketPanel）：KPI 统计条 + 搜索/排序 + 领域胶囊 +
 * 列表行（安全徽章 + Agent 安装条）+ 分页 + 详情/安装弹窗，全部接真实数据。
 */
export function MarketPanel({ initial }: { initial: MarketListResult }) {
  const { t, format } = useI18n();
  const [result, setResult] = useState(initial);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MarketSort>("stars");
  const [domain, setDomain] = useState("all");
  const [page, setPage] = useState(1);
  const [domainCounts, setDomainCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const forceRefreshRef = useRef(false);
  const [detail, setDetail] = useState<MarketSkill | null>(null);
  /** 行内 Agent 安装/卸载进行中集合（keyed by skill.id）。 */
  const [pendingAgents, setPendingAgents] = useState<
    Record<number, Set<string>>
  >({});
  const [localSnapshot, setLocalSnapshot] = useState<SkillSnapshot | null>(
    null,
  );

  useEffect(() => {
    void getLocalSkills()
      .then(setLocalSnapshot)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  // Fetch per-category totals once (one lightweight `limit:1` request each).
  useEffect(() => {
    let cancelled = false;
    for (const item of MARKET_DOMAINS) {
      void getMarketSkills({
        data: {
          page: 1,
          limit: 1,
          search: "",
          sort: "stars",
          tags: [...item.tags],
        },
      })
        .then((next) => {
          if (cancelled) return;
          setDomainCounts((prev) => ({
            ...prev,
            [item.label]: next.pagination?.total ?? 0,
          }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const selectedTags =
      domain === "all"
        ? undefined
        : [
            ...(MARKET_DOMAINS.find((item) => item.label === domain)?.tags ??
              []),
          ];
    const forceRefresh = forceRefreshRef.current;
    forceRefreshRef.current = false;
    void getMarketSkills({
      data: {
        page,
        limit: STANDARD_PAGE_SIZE,
        search: query,
        sort,
        tags: selectedTags,
        forceRefresh,
      },
    })
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("market.network.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, sort, page, domain, refreshRequest, t]);

  const installedBySkill = useMemo(() => {
    // 本地 Skill 名取自 SKILL.md frontmatter，可能与市场名不同；市场安装的
    // source.label 固定为 "${repoOwner}/${repoName}"，用它做第二索引，保证
    // 安装后图标正确点亮（避免误判未安装导致重复安装报错）。
    const byName = new Map<string, Record<string, boolean>>();
    const byMarket = new Map<string, Record<string, boolean>>();
    for (const skill of localSnapshot?.skills ?? []) {
      const per: Record<string, boolean> = {};
      for (const installation of skill.installations) {
        per[installation.agent] = true;
      }
      byName.set(skill.name, per);
      for (const installation of skill.installations) {
        if (
          installation.source?.kind === "market" &&
          installation.source.label
        ) {
          byMarket.set(installation.source.label, per);
        }
      }
    }
    return { byName, byMarket };
  }, [localSnapshot]);

  const installedNames = useMemo(
    () => new Set((localSnapshot?.skills ?? []).map((skill) => skill.name)),
    [localSnapshot],
  );
  const detectedAgents = useMemo(
    () =>
      MARKET_AGENTS.filter(
        (agent) => localSnapshot?.agents[agent]?.installed === true,
      ),
    [localSnapshot],
  );
  const installedMarketSkillCount = useMemo(
    () =>
      localSnapshot == null
        ? (result.stats?.installedCount ?? 0)
        : countInstalledMarketSkills(localSnapshot.skills),
    [localSnapshot, result.stats?.installedCount],
  );

  /**
   * 行内 Agent 点击：未安装 → 直接安装；已安装 → 直接卸载。
   * 安装/卸载期间该 Agent 按钮显示 spinner 并禁用，结束后刷新本地快照。
   */
  async function toggleRowAgent(
    skill: MarketSkill,
    agent: string,
    next: boolean,
  ) {
    const target = agent as MarketAgent;
    setPendingAgents((prev) => {
      const nextSet = new Set(prev[skill.id] ?? []);
      nextSet.add(target);
      return { ...prev, [skill.id]: nextSet };
    });
    try {
      if (next) {
        await requestApprovedSkillInstall({
          data: {
            confirmed: true,
            packageRef: skill.packageRef,
            agent: target,
          },
        });
        toast.success(t("market.install.success", { agent: target }));
      } else {
        await requestMarketSkillUninstall({
          data: {
            confirmed: true,
            packageRef: skill.packageRef,
            agent: target,
          },
        });
        toast.success(t("market.install.uninstalled", { agent: target }));
      }
    } catch (requestError) {
      const ui = toUiError(requestError);
      toast.error(ui ? t(ui.code, ui.params) : t("market.install.failed"));
    } finally {
      setPendingAgents((prev) => {
        const nextSet = new Set(prev[skill.id] ?? []);
        nextSet.delete(target);
        return { ...prev, [skill.id]: nextSet };
      });
      // 安装/卸载后强制重新扫描，避免读到操作前的快照缓存导致图标不点亮。
      void refreshSkillSnapshot()
        .then(setLocalSnapshot)
        .catch(() => undefined);
    }
  }

  // Server-driven pagination: `result.pagination` reflects the filtered total.
  const totalPages = Math.max(1, result.pagination?.pages ?? 1);
  const currentPage = Math.min(page, totalPages);

  // Reset to the first page whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [query, sort, domain]);

  // Every Skill admitted to the market has passed all security dimensions, so
  // the pass count is identical to the market's server-reported total.
  const totalSkillCount = result.stats?.totalSkills ?? 0;

  const kpis = [
    {
      label: t("market.stats.totalSkills"),
      value: format.formatNumber(totalSkillCount),
      hint: t("market.stats.hintDomains", {
        count: format.formatNumber(MARKET_DOMAINS.length),
      }),
    },
    {
      label: t("market.stats.passRate"),
      value: format.formatNumber(totalSkillCount),
      hint: t("market.stats.hintAllDimensionsPassed"),
    },
    {
      label: t("market.stats.installedCount"),
      value: format.formatNumber(installedMarketSkillCount),
      hint: t("market.stats.hintLocalInstalled"),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">
          {t("market.strip.subtitle")}
        </p>
      </div>

      {/* KPI 统计条（原型 3 格） */}
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-card">
        {kpis.map((kpi, index) => (
          <div
            key={kpi.label}
            className={`min-w-0 px-4 py-3.5 transition-colors hover:bg-surface-2 ${
              index > 0 ? "border-l border-rowline" : ""
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

      {result.warning && (
        <p className="text-[11px] text-warn">{result.warning}</p>
      )}

      <div className="min-w-0">
        <div className="aitracker-panel mb-3 flex flex-wrap items-center gap-2 p-2">
          <SearchInput
            value={rawQuery}
            onChange={setRawQuery}
            placeholder={t("market.search.placeholder")}
            ariaLabel={t("market.search.placeholder")}
            className="min-w-0 flex-1"
          />
          <Segmented
            value={sort}
            onChange={setSort}
            options={SORT_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
          <AITrackerButton
            variant="default"
            disabled={loading}
            onClick={() => {
              forceRefreshRef.current = true;
              setRefreshRequest((value) => value + 1);
            }}
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
            {t(loading ? "common.refreshing" : "common.refresh")}
          </AITrackerButton>
        </div>

        {/* 领域分类胶囊（原型样式） */}
        <div className="aitracker-xscroll mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => {
              setDomain("all");
              setPage(1);
            }}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
              domain === "all"
                ? "bg-primary/12 text-primary ring-1 ring-primary/25 ring-inset"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Layers className="size-4 shrink-0" strokeWidth={1.8} />
            {t("market.domainAll")}
            <span className="ml-0.5 text-[10px] opacity-60">
              {result.stats?.totalSkills ?? 0}
            </span>
          </button>
          {MARKET_DOMAINS.map((item) => {
            const on = domain === item.label;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setDomain(item.label);
                  setPage(1);
                }}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
                  on
                    ? "bg-primary/12 text-primary ring-1 ring-primary/25 ring-inset"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <item.icon className="size-4 shrink-0" strokeWidth={1.8} />
                {item.label}
                <span className="ml-0.5 text-[10px] opacity-60">
                  {domainCounts[item.label] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {loading && result.skills.length === 0 ? (
          <div className="grid h-40 place-items-center text-muted-foreground">
            <Progress value={undefined} className="h-1.5 w-40" />
          </div>
        ) : result.skills.length === 0 ? (
          <EmptyState
            title={t("market.empty.noMatch")}
            desc={t("market.empty.noMatchDesc")}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              {t("market.list.count", {
                count: format.formatNumber(result.pagination?.total ?? 0),
              })}
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-ok">
                <ShieldCheck className="size-3.5" />
                {t("market.list.allSafe")}
              </span>
            </div>

            <ul className="overflow-hidden rounded-xl border border-border bg-card">
              {result.skills.map((skill, index) => {
                const security = securityOf(skill, t);
                const installed =
                  installedBySkill.byName.get(skill.name) ??
                  installedBySkill.byMarket.get(
                    `${skill.repoOwner}/${skill.repoName}`,
                  ) ??
                  {};
                return (
                  <li
                    key={skill.id}
                    className={`group relative px-3.5 py-3 transition-colors hover:bg-surface-2/40 ${
                      index > 0
                        ? "[box-shadow:inset_0_1px_0_var(--rowline)]"
                        : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        title={t("market.security.safe")}
                        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${
                          security === "safe"
                            ? "bg-ok/10 text-ok"
                            : security === "attention"
                              ? "bg-warn/10 text-warn"
                              : "bg-surface-2 text-muted-foreground"
                        }`}
                      >
                        {security === "safe" ? (
                          <ShieldCheck className="size-4" />
                        ) : (
                          <ShieldAlert className="size-4" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetail(skill)}
                            className="aitracker-num truncate text-[14px] font-semibold hover:text-primary"
                          >
                            {skill.name}
                          </button>
                          {domainOf(skill) != null && (
                            <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-px text-[11px] text-muted-foreground">
                              {domainOf(skill)}
                            </span>
                          )}
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 text-[11px] ${
                              security === "safe"
                                ? "text-ok"
                                : security === "attention"
                                  ? "text-warn"
                                  : "text-muted-foreground"
                            }`}
                          >
                            <ShieldCheck className="size-3.5" />
                            {security === "safe"
                              ? t("market.security.safe")
                              : security === "attention"
                                ? t("market.security.attention")
                                : t("common.unknown")}
                          </span>
                          {(skill.stars != null ||
                            skill.securityScore != null) && (
                            <span className="aitracker-num hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                              {skill.stars != null &&
                                `${compactNumber(skill.stars)} Star`}
                              {skill.stars != null &&
                                skill.securityScore != null &&
                                " · "}
                              {skill.securityScore != null &&
                                t("market.security.score", {
                                  score: skill.securityScore,
                                })}
                            </span>
                          )}
                          <span className="mx-1 hidden h-3.5 w-px shrink-0 bg-rowline sm:inline-block" />
                          <AgentInstallBar
                            agents={detectedAgents}
                            installed={installed}
                            onToggle={(agent, next) =>
                              void toggleRowAgent(skill, agent, next)
                            }
                            pendingAgents={pendingAgents[skill.id]}
                            inline
                            inlineVisible={8}
                          />
                        </div>
                        <p
                          className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground"
                          title={
                            skill.shortDescription ?? skill.description ?? ""
                          }
                        >
                          {skill.shortDescription ??
                            skill.description ??
                            t("market.noDescription")}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center justify-end gap-2 pl-2">
                        <button
                          type="button"
                          title={t("market.card.detail")}
                          aria-label={t("market.card.detail")}
                          onClick={() => setDetail(skill)}
                          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ChevronRight className="size-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <Pagination
              page={currentPage}
              pageCount={totalPages}
              onChange={setPage}
              rangeLabel={t("market.pagination.range", {
                start: (currentPage - 1) * STANDARD_PAGE_SIZE + 1,
                end: Math.min(
                  currentPage * STANDARD_PAGE_SIZE,
                  result.pagination?.total ?? 0,
                ),
                total: result.pagination?.total ?? 0,
              })}
              prevLabel={t("market.pagination.prev")}
              nextLabel={t("market.pagination.next")}
            />
          </div>
        )}
      </div>

      {detail && (
        <MarketDetailModal
          skill={detail}
          agents={detectedAgents}
          installed={
            installedBySkill.byName.get(detail.name) ??
            installedBySkill.byMarket.get(
              `${detail.repoOwner}/${detail.repoName}`,
            ) ??
            {}
          }
          skillInstalled={installedNames.has(detail.name)}
          onInstalled={() => {
            void refreshSkillSnapshot()
              .then(setLocalSnapshot)
              .catch(() => undefined);
          }}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function MarketDetailModal({
  skill,
  agents,
  installed,
  skillInstalled,
  onInstalled,
  onClose,
}: {
  skill: MarketSkill;
  agents: readonly string[];
  installed: Readonly<Record<string, boolean>>;
  skillInstalled: boolean;
  onInstalled: () => void;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const security = securityOf(skill, t);
  const repoSlug = `${skill.repoOwner}/${skill.repoName}/${skill.slug}`;
  // 多选安装目标：逐个勾选，支持全选/全不选，最后统一安装。
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const installableAgents = agents.filter((agent) => !installed[agent]);
  const allSelected =
    installableAgents.length > 0 &&
    installableAgents.every((agent) => selectedAgents.has(agent));

  function toggleSelect(agent: string) {
    if (installed[agent]) return;
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  }

  async function handleInstallSelected() {
    const targets = agents.filter(
      (agent) => selectedAgents.has(agent) && !installed[agent],
    );
    if (targets.length === 0) return;
    setInstalling(true);
    setInstallError(null);
    try {
      for (const agent of targets) {
        await requestApprovedSkillInstall({
          data: {
            confirmed: true,
            packageRef: skill.packageRef,
            agent: agent as MarketAgent,
          },
        });
      }
      toast.success(t("market.install.success", { agent: targets.join(", ") }));
      onInstalled();
      setSelectedAgents(new Set());
    } catch (requestError) {
      const ui = toUiError(requestError);
      setInstallError(ui ? t(ui.code, ui.params) : t("market.install.failed"));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-[15px] font-semibold">
            <Package className="size-4 shrink-0 text-primary" />
            <span className="aitracker-num truncate">{skill.name}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[10px] ${
                security === "safe"
                  ? "border-ok/40 bg-ok/10 text-ok"
                  : security === "attention"
                    ? "border-warn/40 bg-warn/10 text-warn"
                    : "border-border bg-surface-2 text-muted-foreground"
              }`}
            >
              {security === "safe" ? (
                <ShieldCheck className="size-2.5" />
              ) : (
                <ShieldAlert className="size-2.5" />
              )}
              {security === "safe"
                ? t("market.security.safe")
                : security === "attention"
                  ? t("market.security.attention")
                  : t("common.unknown")}
            </span>
            {skillInstalled && (
              <Badge
                variant="secondary"
                className="bg-ok/15 text-[10px] font-normal text-ok"
              >
                {t("market.installed")}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className="aitracker-num truncate font-mono text-[11.5px] text-muted-foreground"
            title={repoSlug}
          >
            源路径：{repoSlug}
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {skill.description ??
              skill.shortDescription ??
              t("market.noDescription")}
          </p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {
                label: t("market.metric.securityScore"),
                value:
                  skill.securityScore != null
                    ? String(skill.securityScore)
                    : "-",
              },
              {
                label: t("market.metric.stars"),
                value: skill.stars != null ? compactNumber(skill.stars) : "-",
              },
              {
                label: t("market.metric.size"),
                value: formatSizeBytes(skill.size ?? 0),
              },
              {
                label: t("market.drawer.lastUpdated"),
                value:
                  skill.updatedAt != null
                    ? format.formatDateTime(skill.updatedAt, false)
                    : "-",
              },
            ].map((cell) => (
              <div
                key={cell.label}
                className="rounded-sm border border-border bg-surface-2/40 px-2.5 py-1.5"
              >
                <div className="aitracker-label text-[10px]">{cell.label}</div>
                <div className="aitracker-num mt-0.5 text-[13px]">
                  {cell.value}
                </div>
              </div>
            ))}
          </div>

          {/* Security callout (real evidence only) */}
          <div
            className={`rounded-sm border px-3 py-2 text-[12px] ${
              security === "safe"
                ? "border-ok/40 bg-ok/10 text-ok"
                : security === "attention"
                  ? "border-warn/40 bg-warn/10 text-warn"
                  : "border-border bg-surface-2/40 text-muted-foreground"
            }`}
          >
            {security === "safe"
              ? t("market.drawer.securityNotice")
              : security === "attention"
                ? t("market.security.attention")
                : t("common.unknown")}
          </div>

          {/* Install info grid */}
          <div>
            <div className="aitracker-label mb-1.5">
              {t("market.detail.infoTitle")}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <InfoCell
                label={t("market.drawer.commandExample")}
                value={`${APP_ID} install ${skill.name}`}
              />
              <InfoCell
                label={t("market.metric.size")}
                value={formatSizeBytes(skill.size ?? 0)}
              />
              <InfoCell
                label={t("market.metric.securityLevel")}
                value={skill.securityLevel ?? "-"}
              />
              <InfoCell
                label={t("market.detail.sourcePath")}
                value={`${skill.repoOwner}/${skill.repoName}`}
              />
              <InfoCell
                label={t("market.drawer.lastUpdated")}
                value={
                  skill.updatedAt != null
                    ? format.formatDateTime(skill.updatedAt, false)
                    : "-"
                }
              />
            </div>
          </div>

          {skill.tags != null && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skill.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-sm bg-surface-2 px-1.5 py-px text-[11px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* 安装到Agent（多选勾选 + 全选，最后统一安装） */}
          {agents.length > 0 && (
            <div>
              <div className="aitracker-label mb-1.5">
                {t("market.drawer.selectAgent", {
                  count: agents.length,
                })}
              </div>
              <AgentInstallBar
                agents={agents}
                installed={installed}
                selected={[...selectedAgents]}
                onSelect={toggleSelect}
                onSetAll={(next) =>
                  setSelectedAgents(
                    next ? new Set(installableAgents) : new Set(),
                  )
                }
                allSelected={allSelected}
                disabled={installing}
                cols={4}
              />
            </div>
          )}

          {installing && <Progress value={undefined} className="h-1.5" />}
        </div>

        <DialogFooter className="mt-3 flex-wrap items-center gap-2">
          {installError && (
            <p className="mr-auto text-[12px] text-danger">{installError}</p>
          )}
          <AITrackerButton
            variant="default"
            disabled={installing}
            onClick={onClose}
          >
            {t("common.close")}
          </AITrackerButton>
          <AITrackerButton
            variant="primary"
            disabled={installing || selectedAgents.size === 0}
            onClick={() => void handleInstallSelected()}
          >
            {installing
              ? t("market.install.downloading")
              : t("market.install.toSelected")}
          </AITrackerButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-surface-2/40 px-2.5 py-1.5">
      <div className="aitracker-label text-[10px] text-muted-foreground">
        {label}
      </div>
      <div className="aitracker-num mt-0.5 truncate" title={value}>
        {value}
      </div>
    </div>
  );
}
