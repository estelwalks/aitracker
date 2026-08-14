import { useEffect, useMemo, useState } from "react";
import { Download, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  EmptyState,
  Pagination,
  SearchInput,
  Segmented,
  Stat,
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
import {
  compactNumber,
  formatSizeBytes,
} from "../../skill-catalog/presentation/skill-format.ts";

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

const SORT_OPTIONS: { value: MarketSort; labelKey: MessageKey }[] = [
  { value: "stars", labelKey: "market.sort.hot" },
  { value: "created_at", labelKey: "market.sort.latest" },
  { value: "name_asc", labelKey: "market.sort.nameAsc" },
  { value: "name_desc", labelKey: "market.sort.nameDesc" },
  { value: "downloads", labelKey: "market.sort.downloads" },
];

/** Card-grid market catalog (V3.0 prototype style), backed by the real API. */
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
  const [detail, setDetail] = useState<MarketSkill | null>(null);
  const [installTarget, setInstallTarget] = useState<MarketSkill | null>(null);
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

  const installedNames = useMemo(
    () => new Set((localSnapshot?.skills ?? []).map((skill) => skill.name)),
    [localSnapshot],
  );
  const detectedAgents = useMemo(
    () =>
      new Set(
        MARKET_AGENTS.filter(
          (agent) => localSnapshot?.agents[agent]?.installed === true,
        ),
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

  // Page-level real aggregates for the 5-cell stats strip.
  const pageStats = useMemo(() => {
    const safeCount = result.skills.filter(
      (skill) => securityOf(skill, t) === "safe",
    ).length;
    const total = result.skills.length;
    const maxInstall = Math.max(
      1,
      ...result.skills.map((skill) => skill.installCount ?? 0),
    );
    return {
      passRate: total > 0 ? (safeCount / total) * 100 : 0,
      maxInstall,
    };
  }, [result.skills, t]);

  return (
    <div className="space-y-4">
      {/* 5-cell stats strip (real server fn aggregates only) */}
      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label={t("market.stats.totalSkills")}
          value={format.formatNumber(result.stats?.totalSkills ?? 0)}
        />
        <Stat
          label={t("market.stats.officialCount")}
          value={format.formatNumber(result.stats?.officialCount ?? 0)}
        />
        <Stat
          label={t("market.stats.passRate")}
          value={format.formatPercent(pageStats.passRate)}
        />
        <Stat
          label={t("market.stats.installedCount")}
          value={format.formatNumber(result.stats?.installedCount ?? 0)}
        />
        <Stat
          label={t("market.stats.totalDownloads")}
          value={format.formatNumber(result.stats?.totalDownloads ?? 0)}
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
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

        {/* Category chips (fixed taxonomy) */}
        <div className="tt-xscroll flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setDomain("all")}
            className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
              domain === "all"
                ? "bg-primary/12 text-primary ring-1 ring-primary/25 ring-inset"
                : "bg-surface-2/70 text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("market.domainAll")}
            <span className="ml-1 text-[10px] opacity-60">
              {result.stats?.totalSkills ?? 0}
            </span>
          </button>
          {MARKET_DOMAINS.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setDomain(item.label)}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                domain === item.label
                  ? "bg-primary/12 text-primary ring-1 ring-primary/25 ring-inset"
                  : "bg-surface-2/70 text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
              <span className="ml-1 text-[10px] opacity-60">
                {domainCounts[item.label] ?? 0}
              </span>
            </button>
          ))}
        </div>
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {result.skills.map((skill) => {
              const security = securityOf(skill, t);
              const installed = installedNames.has(skill.name);
              const downloads = skill.installCount ?? 0;
              const downloadPercent = Math.max(
                2,
                Math.round((downloads / pageStats.maxInstall) * 100),
              );
              const repoSlug = `${skill.repoOwner}/${skill.repoName}/${skill.slug}`;
              const publisher = skill.repoOwner || "-";
              return (
                <article
                  key={skill.id}
                  className="flex cursor-pointer flex-col rounded-xl bg-card p-4 ring-1 ring-border/50 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
                  onClick={() => setDetail(skill)}
                >
                  <div className="flex items-start gap-3">
                    <span className="tt-num grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[11.5px] font-semibold text-primary">
                      {skill.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {skill.isOfficial === true && (
                          <Badge
                            variant="secondary"
                            className="bg-primary/10 text-[10px] font-normal text-primary"
                          >
                            {t("market.official")}
                          </Badge>
                        )}
                        <span className="truncate text-[13px] font-medium">
                          {skill.name}
                        </span>
                        {installed && (
                          <Badge
                            variant="secondary"
                            className="bg-ok/15 text-[10px] font-normal text-ok"
                          >
                            {t("market.installed")}
                          </Badge>
                        )}
                      </div>
                      <div className="tt-num mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {repoSlug}
                      </div>
                    </div>
                  </div>

                  <p className="mt-2.5 line-clamp-2 text-[11.5px] leading-4 text-muted-foreground">
                    {skill.descriptionZh ??
                      skill.description ??
                      t("market.noDescription")}
                  </p>

                  {/* Downloads bar (relative to the page's max, real numbers) */}
                  <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-ok/70"
                      style={{ width: `${downloadPercent}%` }}
                    />
                  </div>

                  {/* 4 stat cells */}
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {[
                      {
                        label: t("market.metric.downloads"),
                        value: compactNumber(downloads),
                      },
                      {
                        label: t("market.table.stars"),
                        value:
                          skill.stars != null
                            ? compactNumber(skill.stars)
                            : "-",
                      },
                      {
                        label: t("market.metric.tokenUsage"),
                        value:
                          skill.tokens != null
                            ? compactNumber(skill.tokens)
                            : "-",
                      },
                      {
                        label: t("market.metric.size"),
                        value: formatSizeBytes(skill.size ?? 0),
                      },
                    ].map((cell) => (
                      <div key={cell.label}>
                        <div className="tt-num truncate text-[13.5px] leading-none font-semibold">
                          {cell.value}
                        </div>
                        <div className="mt-1 truncate text-[10.5px] text-muted-foreground">
                          {cell.label}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] ${
                        security === "safe"
                          ? "text-ok"
                          : security === "attention"
                            ? "text-warn"
                            : "text-muted-foreground"
                      }`}
                    >
                      {security === "safe" ? (
                        <ShieldCheck className="size-3.5" />
                      ) : (
                        <ShieldAlert className="size-3.5" />
                      )}
                      {security === "safe"
                        ? t("market.security.safe")
                        : security === "attention"
                          ? t("market.security.attention")
                          : t("common.unknown")}
                      <span className="text-muted-foreground/70">
                        · {publisher}
                      </span>
                    </span>
                    <div
                      className="flex shrink-0 gap-1.5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <TTButton
                        size="sm"
                        variant="ghost"
                        onClick={() => setDetail(skill)}
                      >
                        {t("market.card.detail")}
                      </TTButton>
                      <TTButton
                        size="sm"
                        variant={installed ? "ghost" : "primary"}
                        disabled={installed}
                        onClick={() => setInstallTarget(skill)}
                      >
                        {installed ? (
                          t("market.installed")
                        ) : (
                          <>
                            <Download className="size-3" />{" "}
                            {t("market.install.button")}
                          </>
                        )}
                      </TTButton>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
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

      {detail && (
        <MarketDetailModal
          skill={detail}
          installed={installedNames.has(detail.name)}
          onInstall={() => {
            setInstallTarget(detail);
          }}
          onClose={() => setDetail(null)}
        />
      )}

      {installTarget && (
        <MarketInstallModal
          skill={installTarget}
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
  installed,
  onInstall,
  onClose,
}: {
  skill: MarketSkill;
  installed: boolean;
  onInstall: () => void;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const security = securityOf(skill, t);
  const repoSlug = `${skill.repoOwner}/${skill.repoName}/${skill.slug}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-[15px] font-semibold">
            <span className="tt-num grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[11.5px] font-semibold text-primary">
              {skill.name.slice(0, 2).toUpperCase()}
            </span>
            {skill.isOfficial === true && (
              <Badge
                variant="secondary"
                className="bg-primary/10 text-[10px] font-normal text-primary"
              >
                {t("market.official")}
              </Badge>
            )}
            <span>{skill.name}</span>
            {installed && (
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
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {skill.descriptionZh ??
              skill.description ??
              t("market.noDescription")}
          </p>

          <div className="tt-num truncate font-mono text-[11px] text-muted-foreground">
            {repoSlug}
          </div>

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
                label: t("market.table.stars"),
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
                ? "border-ok/30 bg-ok/10 text-ok"
                : security === "attention"
                  ? "border-warn/30 bg-warn/10 text-warn"
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
            <div className="tt-label mb-2">{t("market.detail.infoTitle")}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <InfoCell
                label={t("market.detail.repo")}
                value={`${skill.repoOwner}/${skill.repoName}/${skill.slug}`}
              />
              <InfoCell
                label={t("market.detail.sourcePath")}
                value={`${skill.repoOwner}/${skill.repoName}`}
              />
              <InfoCell
                label={t("market.drawer.contextTokens")}
                value={skill.tokens != null ? compactNumber(skill.tokens) : "-"}
              />
              <InfoCell
                label={t("market.table.size")}
                value={formatSizeBytes(skill.size ?? 0)}
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
          <TTButton variant="primary" disabled={installed} onClick={onInstall}>
            {installed ? t("market.installed") : t("market.install.button")}
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
  detectedAgents,
  installedSkillNames,
  onClose,
  onInstalled,
}: {
  skill: MarketSkill;
  detectedAgents: Set<string>;
  installedSkillNames: Set<string>;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const [agent, setAgent] = useState<MarketAgent | null>(null);
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
            <div className="flex flex-wrap gap-2">
              {MARKET_AGENTS.map((item) => {
                const detected = detectedAgents.has(item);
                const selected = agent === item;
                return (
                  <button
                    key={item}
                    type="button"
                    disabled={!detected}
                    onClick={() => setAgent(item)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${selected ? "bg-primary text-primary-foreground" : "bg-surface-2 hover:bg-accent"}`}
                  >
                    {item}
                    {detected ? null : ` · ${t("market.install.notDetected")}`}
                  </button>
                );
              })}
            </div>
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
