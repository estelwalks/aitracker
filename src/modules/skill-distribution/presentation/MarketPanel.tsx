import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  ChevronRight,
  Package,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import {
  EmptyState,
  Pagination,
  SearchInput,
  Segmented,
  TTButton,
} from "../../../components/tt";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Progress } from "../../../components/ui/progress";
import { Badge } from "../../../components/ui/badge";
import { useI18n } from "../../../lib/i18n/context";
import { toUiError } from "../../../lib/errors";
import type { MessageKey, MessageParams } from "../../../lib/i18n/messages";
import {
  getMarketSkills,
  getLocalSkills,
  requestApprovedSkillInstall,
  MARKET_AGENTS,
  type InstallSkillResult,
  type MarketAgent,
  type MarketListResult,
  type MarketSkill,
  type MarketSort,
  type SkillSnapshot,
} from "../query.ts";
import { compactNumber, formatSizeBytes } from "../../skill-catalog/index.ts";
import { AgentInstallBar } from "./AgentInstallBar.tsx";

const PAGE_SIZE = 12;

/** Fixed market category taxonomy → upstream `tags` slugs. */
const MARKET_DOMAINS = [
  { label: "AI与自动化", tags: ["ai", "automation", "ml"] },
  { label: "开发", tags: ["backend", "frontend", "api"] },
  { label: "数据与分析", tags: ["data", "analytics"] },
  { label: "运维", tags: ["devops", "cli", "scripting"] },
  { label: "安全与测试", tags: ["security", "testing", "debugging"] },
  { label: "生产力", tags: ["productivity"] },
  { label: "文档", tags: ["docs", "code-review"] },
  { label: "云与性能", tags: ["cloud", "performance"] },
  { label: "设计与前端", tags: ["design", "frontend"] },
] as const;

type TFunction = <K extends MessageKey>(
  key: K,
  params?: MessageParams<K>,
) => string;

type SecurityState = "safe" | "attention" | "unknown";

function securityOf(skill: MarketSkill, t: TFunction): SecurityState {
  const safe =
    skill.verdict === "allow" ||
    (skill.securityScore != null && skill.securityScore >= 80);
  const hasEvidence =
    skill.securityScore != null ||
    skill.verdict != null ||
    skill.securityLevel != null;
  if (!hasEvidence) return "unknown";
  return safe ? "safe" : "attention";
}

/** 真实 tags → 领域分类标签（原型行内领域徽章）。 */
function domainOf(skill: MarketSkill): string {
  const tags = new Set(skill.tags ?? []);
  const matched = MARKET_DOMAINS.find((item) =>
    item.tags.some((tag) => tags.has(tag)),
  );
  return matched?.label ?? skill.tags?.[0] ?? "-";
}

const SORT_OPTIONS: { value: MarketSort; labelKey: MessageKey }[] = [
  { value: "downloads", labelKey: "market.sort.hot" },
  { value: "created_at", labelKey: "market.sort.latest" },
  { value: "stars", labelKey: "market.sort.rating" },
  { value: "tokens", labelKey: "market.sort.tokens" },
];

/** 安装目标（详情弹窗内预选 Agent 后发起安装）。 */
interface InstallRequest {
  readonly skill: MarketSkill;
  readonly agent: MarketAgent;
}

/**
 * 安全市场（V3.0 原型 MarketPanel）：KPI 统计条 + 搜索/排序 + 领域胶囊 +
 * 列表行（安全徽章 + Agent 安装条）+ 分页 + 详情/安装弹窗，全部接真实数据。
 */
export function MarketPanel({ initial }: { initial: MarketListResult }) {
  const { t, format } = useI18n();
  const [result, setResult] = useState(initial);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MarketSort>("downloads");
  const [domain, setDomain] = useState("all");
  const [page, setPage] = useState(1);
  const [domainCounts, setDomainCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<MarketSkill | null>(null);
  const [installTarget, setInstallTarget] = useState<InstallRequest | null>(
    null,
  );
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
          sort: "downloads",
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
    void getMarketSkills({
      data: {
        page,
        limit: PAGE_SIZE,
        search: query,
        sort,
        tags: selectedTags,
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
  }, [query, sort, page, domain, t]);

  const installedBySkill = useMemo(() => {
    const map = new Map<string, Record<string, boolean>>();
    for (const skill of localSnapshot?.skills ?? []) {
      const per: Record<string, boolean> = {};
      for (const installation of skill.installations) {
        per[installation.agent] = true;
      }
      map.set(skill.name, per);
    }
    return map;
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

  // Server-driven pagination: `result.pagination` reflects the filtered total.
  const totalPages = Math.max(1, result.pagination?.pages ?? 1);
  const currentPage = Math.min(page, totalPages);

  // Reset to the first page whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [query, sort, domain]);

  // Page-level real aggregates for the KPI strip.
  const pageSafeCount = useMemo(
    () =>
      result.skills.filter((skill) => securityOf(skill, t) === "safe").length,
    [result.skills, t],
  );

  const kpis = [
    {
      label: t("market.stats.totalSkills"),
      value: format.formatNumber(result.stats?.totalSkills ?? 0),
      hint: t("market.stats.hintDomains", {
        count: format.formatNumber(MARKET_DOMAINS.length),
      }),
    },
    {
      label: t("market.stats.officialCount"),
      value: format.formatNumber(result.stats?.officialCount ?? 0),
      hint: t("market.stats.hintOfficial"),
    },
    {
      label: t("market.stats.passRate"),
      value: format.formatNumber(pageSafeCount),
      hint: t("market.stats.hintCurrentPage"),
    },
    {
      label: t("market.stats.installedCount"),
      value: format.formatNumber(result.stats?.installedCount ?? 0),
      hint: t("market.stats.hintDownloads", {
        count: compactNumber(result.stats?.totalDownloads ?? 0),
      }),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">
          {t("market.strip.subtitle")}
        </p>
      </div>

      {/* KPI 统计条（原型 4 格） */}
      <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-border bg-card">
        {kpis.map((kpi, index) => (
          <div
            key={kpi.label}
            className={`min-w-0 px-4 py-3.5 transition-colors hover:bg-surface-2 ${
              index > 0 ? "border-l border-rowline" : ""
            }`}
          >
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70 uppercase">
              {kpi.label}
            </div>
            <div className="tt-num mt-2 font-mono text-[22px] leading-none font-black tracking-tight">
              {kpi.value}
            </div>
            <div className="mt-1.5 truncate text-[11px] text-muted-foreground/80">
              {kpi.hint}
            </div>
          </div>
        ))}
      </div>

      {result.warning && (
        <p className="text-[11px] text-warn">{result.warning}</p>
      )}

      <div className="min-w-0">
        <div className="tt-panel mb-3 flex flex-wrap items-center gap-2 p-2">
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
        </div>

        {/* 领域分类胶囊（原型样式） */}
        <div className="tt-xscroll mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => {
              setDomain("all");
              setPage(1);
            }}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
              domain === "all"
                ? "bg-primary/12 text-primary ring-1 ring-primary/25 ring-inset"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("market.domainAll")}
            <span className="ml-1 text-[10px] opacity-60">
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
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
                  on
                    ? "bg-primary/12 text-primary ring-1 ring-primary/25 ring-inset"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
                <span className="ml-1 text-[10px] opacity-60">
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
              {pageSafeCount === result.skills.length && (
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-ok">
                  <ShieldCheck className="size-3.5" />
                  {t("market.list.allSafe")}
                </span>
              )}
            </div>

            <ul className="overflow-hidden rounded-xl border border-border bg-card">
              {result.skills.map((skill, index) => {
                const security = securityOf(skill, t);
                const downloads = skill.installCount ?? 0;
                const stars = skill.stars ?? 0;
                const tokens = skill.tokens ?? 0;
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
                            className="tt-num truncate text-[14px] font-semibold hover:text-primary"
                          >
                            {skill.name}
                          </button>
                          {skill.isOfficial === true && (
                            <BadgeCheck className="size-3.5 shrink-0 text-primary" />
                          )}
                          <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-px text-[11px] text-muted-foreground">
                            {domainOf(skill)}
                          </span>
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
                          <span className="tt-num hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                            ↓{compactNumber(downloads)} · {compactNumber(stars)}{" "}
                            Star · {compactNumber(tokens)} tok
                          </span>
                          <span className="mx-1 hidden h-3.5 w-px shrink-0 bg-rowline sm:inline-block" />
                          <AgentInstallBar
                            agents={detectedAgents}
                            installed={installedBySkill.get(skill.name) ?? {}}
                            onToggle={(agent) =>
                              setInstallTarget({ skill, agent })
                            }
                            inline
                            inlineVisible={4}
                          />
                        </div>
                        <p
                          className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground"
                          title={skill.descriptionZh ?? skill.description ?? ""}
                        >
                          {skill.descriptionZh ??
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
                start: (currentPage - 1) * PAGE_SIZE + 1,
                end: Math.min(
                  currentPage * PAGE_SIZE,
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
          installed={installedBySkill.get(detail.name) ?? {}}
          skillInstalled={installedNames.has(detail.name)}
          onRequestInstall={(agent) => {
            setInstallTarget({ skill: detail, agent });
          }}
          onClose={() => setDetail(null)}
        />
      )}

      {installTarget && (
        <MarketInstallModal
          skill={installTarget.skill}
          initialAgent={installTarget.agent}
          detectedAgents={detectedAgents}
          installedSkillNames={installedNames}
          onClose={() => setInstallTarget(null)}
          onInstalled={() => {
            void getLocalSkills()
              .then(setLocalSnapshot)
              .catch(() => undefined);
          }}
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
  onRequestInstall,
  onClose,
}: {
  skill: MarketSkill;
  agents: readonly string[];
  installed: Readonly<Record<string, boolean>>;
  skillInstalled: boolean;
  onRequestInstall: (agent: string) => void;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const security = securityOf(skill, t);
  const repoSlug = `${skill.repoOwner}/${skill.repoName}/${skill.slug}`;
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-[15px] font-semibold">
            <Package className="size-4 shrink-0 text-primary" />
            <span className="tt-num truncate">{skill.name}</span>
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
            <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
              {skill.isOfficial === true && (
                <BadgeCheck className="size-3 text-primary" />
              )}
              {skill.repoOwner || "-"} · {domainOf(skill)}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className="tt-num truncate font-mono text-[11.5px] text-muted-foreground"
            title={repoSlug}
          >
            源路径：{repoSlug}
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {skill.descriptionZh ??
              skill.description ??
              t("market.noDescription")}
          </p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {
                label: t("market.metric.downloads"),
                value: compactNumber(skill.installCount ?? 0),
              },
              {
                label: t("market.metric.tokenUsage"),
                value: skill.tokens != null ? compactNumber(skill.tokens) : "-",
              },
              {
                label: t("market.metric.stars"),
                value: skill.stars != null ? compactNumber(skill.stars) : "-",
              },
              {
                label: t("market.metric.size"),
                value: formatSizeBytes(skill.size ?? 0),
              },
            ].map((cell) => (
              <div
                key={cell.label}
                className="rounded-sm border border-border bg-surface-2/40 px-2.5 py-1.5"
              >
                <div className="tt-label text-[10px]">{cell.label}</div>
                <div className="tt-num mt-0.5 text-[13px]">{cell.value}</div>
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
            <div className="tt-label mb-1.5">
              {t("market.detail.infoTitle")}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <InfoCell
                label={t("market.drawer.commandExample")}
                value={`trusttools install ${skill.name}`}
              />
              <InfoCell
                label={t("market.metric.size")}
                value={formatSizeBytes(skill.size ?? 0)}
              />
              <InfoCell
                label={t("market.drawer.contextTokens")}
                value={skill.tokens != null ? compactNumber(skill.tokens) : "-"}
              />
              <InfoCell
                label={t("market.detail.sourcePath")}
                value={`${skill.repoOwner}/${skill.repoName}`}
              />
              <InfoCell
                label={t("market.detail.lastScanned")}
                value={
                  skill.lastScannedAt != null
                    ? format.formatDateTime(skill.lastScannedAt, false)
                    : "-"
                }
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

          {/* 安装到Agent（原型 AgentInstallBar 选择模式） */}
          {agents.length > 0 && (
            <div>
              <div className="tt-label mb-1.5">
                {t("market.drawer.selectAgent", {
                  count: agents.length,
                })}
              </div>
              <AgentInstallBar
                agents={agents}
                installed={installed}
                selected={selected}
                onSelect={(agent) => setSelected(agent)}
                cols={4}
              />
            </div>
          )}
        </div>

        <DialogFooter className="mt-3 flex-wrap items-center gap-2">
          {skill.repoUrl && (
            <a
              href={skill.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="mr-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {t("market.drawer.viewRepo")}
            </a>
          )}
          <TTButton variant="default" onClick={onClose}>
            {t("common.close")}
          </TTButton>
          <TTButton
            variant="primary"
            disabled={skillInstalled || selected == null}
            onClick={() => selected != null && onRequestInstall(selected)}
          >
            {skillInstalled
              ? t("market.installed")
              : t("market.install.button")}
          </TTButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-surface-2/40 px-2.5 py-1.5">
      <div className="tt-label text-[10px] text-muted-foreground">{label}</div>
      <div className="tt-num mt-0.5 truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

function MarketInstallModal({
  skill,
  initialAgent,
  detectedAgents,
  installedSkillNames,
  onClose,
  onInstalled,
}: {
  skill: MarketSkill;
  initialAgent: MarketAgent | null;
  detectedAgents: readonly string[];
  installedSkillNames: Set<string>;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const [agent, setAgent] = useState<MarketAgent | null>(initialAgent);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<InstallSkillResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const installed = installedSkillNames.has(skill.name);

  async function handleInstall() {
    if (!agent) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await requestApprovedSkillInstall({
        data: { confirmed: true, packageRef: skill.packageRef, agent },
      });
      setOutcome(result);
      if (result.installed) onInstalled();
    } catch (requestError) {
      const ui = toUiError(requestError);
      setError(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {skill.isOfficial === true && (
              <Badge
                variant="secondary"
                className="bg-primary/10 text-[10px] font-normal text-primary"
              >
                {t("market.official")}
              </Badge>
            )}
            {skill.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[12px] font-medium text-foreground">
              {t("market.install.target")}
            </p>
            <AgentInstallBar
              agents={detectedAgents}
              installed={{}}
              selected={agent}
              onSelect={(item) => setAgent(item as MarketAgent)}
              disabled={submitting}
              cols={2}
              rows={2}
            />
          </div>

          {submitting && <Progress value={undefined} className="h-1.5" />}

          {error && <p className="text-[12px] text-danger">{error}</p>}

          {outcome && (
            <p className="text-[12px] text-muted-foreground">
              {t(
                outcome.installed
                  ? "market.install.succeeded"
                  : "market.install.failed",
              )}
            </p>
          )}
        </div>

        <DialogFooter>
          <TTButton variant="ghost" disabled={submitting} onClick={onClose}>
            {t("common.close")}
          </TTButton>
          <TTButton
            variant="primary"
            disabled={!agent || submitting || installed}
            onClick={() => void handleInstall()}
          >
            {installed ? t("market.installed") : t("market.install.button")}
          </TTButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
