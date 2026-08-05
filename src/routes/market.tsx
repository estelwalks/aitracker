import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  LoaderCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dot,
  EmptyState,
  PageHeader,
  Panel,
  Segmented,
  StatusBadge,
  TTButton,
} from "../components/tt";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import { Progress } from "../components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import {
  getMarketSkills,
  MARKET_AGENTS,
  requestSkillInstall,
} from "../lib/local-market";
import type {
  InstallSkillResult,
  MarketAgent,
  MarketListResult,
  MarketSkill,
  MarketSort,
} from "../lib/local-market";
import { getLocalSkills } from "../lib/local-skills/server-fns";
import type { SkillSnapshot } from "../lib/local-skills/types";
import { toUiError } from "../lib/errors";
import { useI18n } from "../lib/i18n/context";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import {
  catalogs,
  getMessage,
  type MessageKey,
  type MessageParams,
} from "../lib/i18n/messages";
import type { BoundFormatters } from "../lib/i18n/format";

const PAGE_SIZE = 14;

type TFunction = <K extends MessageKey>(
  key: K,
  params?: MessageParams<K>,
) => string;

const SORT_OPTIONS: { value: MarketSort; labelKey: MessageKey }[] = [
  { value: "downloads", labelKey: "market.sort.downloads" },
  { value: "latest", labelKey: "market.sort.latest" },
  { value: "stars", labelKey: "market.sort.stars" },
  { value: "tokens", labelKey: "market.sort.tokens" },
];

function emptyResult(): MarketListResult {
  return {
    skills: [],
    pagination: { page: 1, limit: PAGE_SIZE, total: 0, pages: 0 },
    source: "network",
    fetchedAt: new Date(0).toISOString(),
    warning: null,
  };
}

export const Route = createFileRoute("/market")({
  loader: async ({ location }) => {
    try {
      return {
        locale: resolveLocaleFromSearch(location.search),
        result: await getMarketSkills({
          data: { page: 1, limit: PAGE_SIZE, search: "", sort: "downloads" },
        }),
        error: null,
      };
    } catch (error) {
      return {
        locale: resolveLocaleFromSearch(location.search),
        result: emptyResult(),
        error:
          error instanceof Error
            ? error.message
            : getMessage(
                catalogs[resolveLocaleFromSearch(location.search)],
                "market.network.loadFailed",
              ),
      };
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.market",
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "market.meta.description",
        ),
      },
    ],
  }),
  component: MarketPage,
});

function MarketPage() {
  const initial = Route.useLoaderData();
  const { t, format } = useI18n();
  const [result, setResult] = useState(initial.result);
  const [error, setError] = useState<string | null>(initial.error);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<MarketSort>("downloads");
  const [loading, setLoading] = useState(false);
  const [retrySequence, setRetrySequence] = useState(0);
  const [detail, setDetail] = useState<MarketSkill | null>(null);
  const [localSnapshot, setLocalSnapshot] = useState<SkillSnapshot | null>(
    null,
  );
  const firstRequest = useRef(true);
  const requestSequence = useRef(0);

  // Load local skills to detect installed skills and agents
  useEffect(() => {
    void getLocalSkills()
      .then(setLocalSnapshot)
      .catch(() => undefined);
  }, []);

  // Debounced search - 250ms per PRD FR-021
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(rawQuery.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  useEffect(() => {
    if (firstRequest.current && page === 1 && query === "") {
      firstRequest.current = false;
      return;
    }
    firstRequest.current = false;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    void getMarketSkills({
      data: { page, limit: PAGE_SIZE, search: query, sort },
    })
      .then((nextResult) => {
        if (sequence === requestSequence.current) setResult(nextResult);
      })
      .catch((requestError) => {
        if (sequence === requestSequence.current) {
          const ui = toUiError(requestError);
          setError(
            ui
              ? t(ui.code, ui.params)
              : requestError instanceof Error
                ? requestError.message
                : t("market.network.loadFailed"),
          );
        }
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false);
      });
  }, [page, query, sort, retrySequence]);

  // Installed skill names (for "已安装" tags)
  const installedSkillNames = useMemo(
    () => new Set((localSnapshot?.skills ?? []).map((s) => s.name)),
    [localSnapshot],
  );

  // Installation probes are authoritative. An installed Agent with an empty
  // skill directory remains a valid market installation target.
  const detectedAgents = useMemo(
    () =>
      new Set(
        MARKET_AGENTS.filter(
          (a) => localSnapshot?.agents[a]?.installed === true,
        ),
      ),
    [localSnapshot],
  );

  // Installed count for stats (cross-reference current page with local skills)
  const installedCount = useMemo(
    () => result.skills.filter((s) => installedSkillNames.has(s.name)).length,
    [result.skills, installedSkillNames],
  );

  const stats = result.stats;
  const pages = result.pagination.pages;

  return (
    <>
      <PageHeader
        title={t("market.pageHeader")}
        desc={t("market.pageHeaderDesc")}
      />

      {/* Stats cards (FR-021) */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label={t("market.stats.totalSkills")}
          value={stats ? format.formatNumber(stats.totalSkills) : "-"}
        />
        <StatCard
          label={t("market.stats.officialCount")}
          value={stats ? format.formatNumber(stats.officialCount) : "-"}
          hint={t("market.stats.hintCurrentPage")}
        />
        <StatCard label={t("market.stats.passRate")} value="100%" />
        <StatCard
          label={t("market.stats.installedCount")}
          value={format.formatNumber(installedCount)}
          hint={t("market.stats.hintLocalInstalled")}
        />
        <StatCard
          label={t("market.stats.totalDownloads")}
          value={stats ? format.formatNumber(stats.totalDownloads) : "-"}
          hint={t("market.stats.hintCurrentPage")}
        />
      </div>

      {/* Search + Sort bar */}
      <div className="tt-panel mb-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={rawQuery}
              onChange={(event) => setRawQuery(event.target.value)}
              placeholder={t("market.search.placeholder")}
              className="h-9 w-full rounded-sm border border-border bg-surface-2 pr-10 pl-9 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            {loading && (
              <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-primary" />
            )}
          </div>
          <Segmented
            value={sort}
            onChange={(v) => {
              setSort(v);
              setPage(1);
            }}
            options={SORT_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            {t("market.search.updatedAt", {
              time: format.formatDate(result.fetchedAt),
            })}
            {query ? t("market.search.keyword", { keyword: query }) : ""}
          </span>
          <span>
            {t("market.search.perPage", {
              count: format.formatNumber(PAGE_SIZE),
              page: format.formatNumber(result.pagination.page),
            })}
          </span>
        </div>
      </div>

      {(error || result.warning) && (
        <div className="mb-3 flex items-start gap-2 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error ?? result.warning}</span>
        </div>
      )}

      {result.skills.length > 0 ? (
        <div
          className={`transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}
        >
          <Panel
            title={t("market.list.title", {
              count: format.formatNumber(result.pagination.total),
            })}
            bodyClassName="p-0"
          >
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[50px] pl-4">
                    {t("market.table.rank")}
                  </TableHead>
                  <TableHead className="min-w-[180px]">Skill</TableHead>
                  <TableHead className="w-[120px]">
                    {t("market.table.publisher")}
                  </TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap">
                    {t("market.table.downloads")}
                  </TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap">
                    {t("market.table.tokenUsage")}
                  </TableHead>
                  <TableHead className="w-[70px] whitespace-nowrap">
                    {t("market.table.size")}
                  </TableHead>
                  <TableHead className="w-[70px] whitespace-nowrap">
                    {t("market.table.stars")}
                  </TableHead>
                  <TableHead className="w-[100px]">
                    {t("market.table.security")}
                  </TableHead>
                  <TableHead className="w-[80px] pr-4">
                    {t("market.table.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.skills.map((skill, index) => {
                  const security = securityPresentation(skill, t, format);
                  const rank =
                    (result.pagination.page - 1) * PAGE_SIZE + index + 1;
                  const isInstalled = installedSkillNames.has(skill.name);
                  return (
                    <TableRow
                      key={skill.id}
                      className="cursor-pointer"
                      onClick={() => setDetail(skill)}
                    >
                      <TableCell className="tt-num pl-4 text-[11px] text-muted-foreground">
                        {rank}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {security.safe ? (
                            <ShieldCheck className="size-3.5 shrink-0 text-ok" />
                          ) : (
                            <ShieldAlert className="size-3.5 shrink-0 text-warn" />
                          )}
                          <span className="truncate text-[13px] font-medium">
                            {skill.name}
                          </span>
                          {isInstalled && (
                            <Badge
                              variant="secondary"
                              className="bg-ok/15 text-[10px] font-normal text-ok"
                            >
                              {t("market.installed")}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {skill.descriptionZh ??
                            skill.description ??
                            t("market.noDescription")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="truncate text-[11px] text-muted-foreground">
                            {skill.repoOwner}/{skill.repoName}
                          </span>
                          {skill.isOfficial && (
                            <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                              {t("market.official")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="tt-num text-[12px] text-muted-foreground">
                        {formatCount(skill.installCount, t, format)}
                      </TableCell>
                      <TableCell className="tt-num text-[12px] text-muted-foreground">
                        {skill.tokens !== null
                          ? format.formatNumber(skill.tokens)
                          : "-"}
                      </TableCell>
                      <TableCell className="tt-num text-[12px] text-muted-foreground">
                        {skill.size !== null
                          ? format.formatBytes(skill.size)
                          : "-"}
                      </TableCell>
                      <TableCell className="tt-num text-[12px] text-muted-foreground">
                        {skill.stars !== null
                          ? format.formatNumber(skill.stars)
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <span className="text-[11px] text-ok">
                          <ShieldCheck className="mr-1 inline size-3" />
                          {security.label}
                        </span>
                      </TableCell>
                      <TableCell
                        className="pr-4"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <TTButton
                          size="sm"
                          variant="primary"
                          onClick={() => setDetail(skill)}
                        >
                          {t("market.install.button")}
                        </TTButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Panel>

          {/* Pagination with page numbers + ellipsis (FR-021) */}
          <div className="mt-4 flex items-center justify-center gap-1 text-xs">
            <TTButton
              size="sm"
              disabled={loading || page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t("market.pagination.prev")}
            </TTButton>
            {getPageNumbers(result.pagination.page, Math.max(1, pages)).map(
              (pageNum, idx) =>
                pageNum === "..." ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-1 text-muted-foreground"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    disabled={loading}
                    className={`tt-num h-7 min-w-7 rounded-sm border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      pageNum === result.pagination.page
                        ? "border-primary bg-primary/15 font-medium text-primary"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {pageNum}
                  </button>
                ),
            )}
            <TTButton
              size="sm"
              disabled={loading || pages === 0 || page >= pages}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("market.pagination.next")}
            </TTButton>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={
            error ? (
              <ShieldAlert className="size-7" />
            ) : (
              <Search className="size-7" />
            )
          }
          title={
            error
              ? t("market.network.unavailableTitle")
              : t("market.empty.noMatch")
          }
          desc={
            error
              ? t("market.network.unavailableDesc")
              : t("market.empty.noMatchDesc")
          }
          actions={
            error ? (
              <TTButton
                variant="primary"
                onClick={() => setRetrySequence((current) => current + 1)}
              >
                {t("common.retry")}
              </TTButton>
            ) : undefined
          }
        />
      )}

      {/* Detail Drawer (FR-022) */}
      {detail && (
        <SkillDetailDrawer
          skill={detail}
          detectedAgents={detectedAgents}
          installedSkillNames={installedSkillNames}
          onClose={() => setDetail(null)}
          onInstalled={() => {
            // Refresh local skills to update installed tags
            void getLocalSkills()
              .then(setLocalSnapshot)
              .catch(() => undefined);
          }}
        />
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="tt-panel px-4 py-3">
      <div className="tt-label">{label}</div>
      <div className="tt-num mt-1 text-lg">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function SkillDetailDrawer({
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
  const { t, format } = useI18n();
  const [selectedAgent, setSelectedAgent] = useState<MarketAgent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InstallSkillResult | null>(null);
  const cancelledRef = useRef(false);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const security = securityPresentation(skill, t, format);
  const isInstalled = installedSkillNames.has(skill.name);

  const startProgress = useCallback(() => {
    setProgress(0);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 90) return p;
        return Math.min(p + Math.random() * 8, 90);
      });
    }, 300);
  }, []);

  const stopProgress = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopProgress();
    };
  }, [stopProgress]);

  const submit = async () => {
    if (!selectedAgent) {
      setFailure(t("market.install.failure.noAgent"));
      return;
    }
    setSubmitting(true);
    setCancelled(false);
    cancelledRef.current = false;
    setFailure(null);
    setOutcome(null);
    startProgress();

    try {
      const nextOutcome = await requestSkillInstall({
        data: {
          skill: {
            name: skill.name,
            repoOwner: skill.repoOwner,
            repoName: skill.repoName,
            repoPath: skill.repoPath,
            slug: skill.slug,
          },
          agents: [selectedAgent],
        },
      });

      if (cancelledRef.current) return;

      setProgress(100);
      setOutcome(nextOutcome);

      if (nextOutcome.installed) {
        toast.success(t("market.install.success", { agent: selectedAgent }));
        onInstalled();
        onClose();
      } else if (nextOutcome.reason === "scan-blocked") {
        setFailure(t("market.install.failure.scanBlocked"));
      } else {
        setFailure(nextOutcome.message);
      }
    } catch (error) {
      if (cancelledRef.current) return;
      stopProgress();
      const ui = toUiError(error);
      if (ui) {
        setFailure(t(ui.code, ui.params));
        return;
      }
      const message = error instanceof Error ? error.message : "";
      if (error instanceof Error && error.name === "DiskSpaceError") {
        setFailure(t("market.install.failure.diskFull"));
      } else if (message.includes("磁盘空间不足")) {
        setFailure(t("market.install.failure.diskFull"));
      } else if (
        message.includes("超时") ||
        message.includes("网络") ||
        message.includes("下载失败")
      ) {
        setFailure(t("market.install.failure.download"));
      } else {
        setFailure(message || t("market.install.failure.generic"));
      }
    } finally {
      stopProgress();
      setSubmitting(false);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    setCancelled(true);
    setSubmitting(false);
    stopProgress();
    setFailure(null);
  };

  return (
    <Sheet
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {security.safe ? (
              <ShieldCheck className="size-4 text-ok" />
            ) : (
              <ShieldAlert className="size-4 text-warn" />
            )}
            {skill.name}
            {skill.isOfficial && (
              <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                {t("market.official")}
              </span>
            )}
            {isInstalled && (
              <Badge
                variant="secondary"
                className="bg-ok/15 text-[10px] font-normal text-ok"
              >
                {t("market.installed")}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {skill.repoOwner}/{skill.repoName}
            {skill.repoUrl && (
              <a
                href={skill.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
              >
                {t("market.drawer.viewRepo")}{" "}
                <ExternalLink className="size-3" />
              </a>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-[13px]">
          {/* Metric cards: 下载量 / Token占用 / Star / 体积 */}
          <div className="grid grid-cols-4 gap-2">
            <MetricCell
              label={t("market.metric.downloads")}
              value={formatCount(skill.installCount, t, format)}
            />
            <MetricCell
              label={t("market.metric.tokenUsage")}
              value={
                skill.tokens !== null ? format.formatNumber(skill.tokens) : "-"
              }
            />
            <MetricCell
              label={t("market.metric.stars")}
              value={
                skill.stars !== null ? format.formatNumber(skill.stars) : "-"
              }
            />
            <MetricCell
              label={t("market.metric.size")}
              value={skill.size !== null ? format.formatBytes(skill.size) : "-"}
            />
          </div>

          {/* Description */}
          <div>
            <p className="leading-relaxed text-muted-foreground">
              {skill.descriptionZh ??
                skill.description ??
                t("market.noDescription")}
            </p>
          </div>

          {/* Security notice bar */}
          <div className="flex items-center gap-2 rounded-sm border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
            <ShieldCheck className="size-4 shrink-0" />
            <span>{t("market.drawer.securityNotice")}</span>
          </div>

          {/* Install info */}
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">
              {t("market.drawer.commandExample")}
            </dt>
            <dd className="break-all font-mono text-[11px]">
              trusttools install {skill.slug}
            </dd>
            <dt className="text-muted-foreground">
              {t("market.drawer.contextTokens")}
            </dt>
            <dd>{t("market.notProvided")}</dd>
            <dt className="text-muted-foreground">
              {t("market.drawer.lastUpdated")}
            </dt>
            <dd>
              {skill.updatedAt
                ? format.formatDate(skill.updatedAt)
                : t("market.notProvided")}
            </dd>
            <dt className="text-muted-foreground">
              {t("market.drawer.permissionClaim")}
            </dt>
            <dd>{skill.verdict ?? t("market.notProvided")}</dd>
            <dt className="text-muted-foreground">
              {t("market.drawer.networkClaim")}
            </dt>
            <dd>{skill.status ?? t("market.notProvided")}</dd>
          </dl>

          {/* Agent selection (single-select radio) */}
          <div>
            <div className="tt-label mb-2">
              {t("market.drawer.selectAgent", {
                count: format.formatNumber(MARKET_AGENTS.length),
              })}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {MARKET_AGENTS.map((agent) => {
                const detected = detectedAgents.has(agent);
                const isSelected = selectedAgent === agent;
                return (
                  <label
                    key={agent}
                    className={`flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-xs transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/10"
                        : detected
                          ? "cursor-pointer border-border bg-surface-2 hover:border-border-strong"
                          : "cursor-not-allowed border-border bg-surface-2 opacity-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="install-agent"
                      checked={isSelected}
                      onChange={() => detected && setSelectedAgent(agent)}
                      disabled={!detected}
                      className="accent-primary"
                    />
                    <span className="truncate">{agent}</span>
                    {!detected && (
                      <Badge
                        variant="outline"
                        className="ml-auto text-[9px] text-muted-foreground"
                      >
                        {t("market.drawer.agentNotInstalled")}
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Progress bar during install */}
          {submitting && (
            <div className="space-y-1.5">
              <Progress value={progress} />
              <p className="text-center text-[11px] text-muted-foreground">
                {t("market.install.downloading")}
              </p>
            </div>
          )}

          {/* Failure message */}
          {failure && (
            <div className="flex items-start gap-2 rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>{failure}</span>
            </div>
          )}

          {/* Outcome */}
          {outcome && !submitting && !cancelled && (
            <InstallOutcome outcome={outcome} />
          )}

          {/* Tags */}
          {skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {skill.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {submitting ? (
            <TTButton variant="danger" onClick={cancel}>
              {t("common.cancel")}
            </TTButton>
          ) : (
            <TTButton
              variant="primary"
              disabled={!selectedAgent}
              onClick={submit}
            >
              <Download className="size-3.5" />
              {t("market.install.toSelected")}
            </TTButton>
          )}
          {skill.repoUrl && (
            <a href={skill.repoUrl} target="_blank" rel="noreferrer">
              <TTButton>
                <ExternalLink className="size-3.5" />
                {t("market.drawer.viewSource")}
              </TTButton>
            </a>
          )}
          <TTButton variant="ghost" onClick={onClose}>
            {t("common.close")}
          </TTButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-center">
      <div className="tt-label text-[9px]">{label}</div>
      <div className="tt-num mt-0.5 text-[13px]">{value}</div>
    </div>
  );
}

function InstallOutcome({ outcome }: { outcome: InstallSkillResult }) {
  const { t, format } = useI18n();
  const failed =
    outcome.reason === "scan-blocked" || outcome.reason === "failed";
  const completed = outcome.reason === "installed";
  return (
    <div
      className={`space-y-2 rounded-sm border px-3 py-3 text-xs ${
        failed
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-primary/40 bg-primary/10 text-foreground"
      }`}
    >
      <div className="flex items-start gap-2">
        {failed ? (
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        ) : (
          <CheckCircle2
            className={`mt-0.5 size-4 shrink-0 ${completed ? "text-ok" : "text-warn"}`}
          />
        )}
        <strong>{outcome.message}</strong>
      </div>
      <div className="tt-num grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
        <span>
          {t("market.outcome.compressed", {
            size: format.formatBytes(outcome.inspection.compressedBytes),
          })}
        </span>
        <span>
          {t("market.outcome.unpacked", {
            size: format.formatBytes(outcome.inspection.scan.unpackedBytes),
          })}
        </span>
        <span>
          {t("market.outcome.entries", {
            count: format.formatNumber(outcome.inspection.scan.entriesChecked),
          })}
        </span>
        <span>
          {t("market.outcome.files", {
            count: format.formatNumber(outcome.inspection.scan.filesScanned),
          })}
        </span>
      </div>
      <ul className="space-y-1 border-t border-border pt-2 text-[11px]">
        {outcome.targets.map((target) => (
          <li
            key={target.agent}
            className={target.installed ? "text-ok" : "text-danger"}
          >
            {target.installed
              ? t("market.outcome.success")
              : t("market.outcome.failed")}{" "}
            · {target.agent} · {target.message}
          </li>
        ))}
      </ul>
      {outcome.inspection.scan.findings.length > 0 && (
        <ul className="max-h-32 space-y-1 overflow-auto border-t border-border pt-2 text-[11px]">
          {outcome.inspection.scan.findings
            .slice(0, 20)
            .map((finding, index) => (
              <li
                key={`${finding.path}:${finding.line}:${finding.rule}:${index}`}
              >
                [{finding.severity}] {finding.path}
                {finding.line ? `:${finding.line}` : ""} · {finding.message}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

// --- Helpers ---

function getPageNumbers(current: number, total: number): Array<number | "..."> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, "...", total];
  }
  if (current >= total - 3) {
    return [1, "...", total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, "...", current - 1, current, current + 1, "...", total];
}

function securityPresentation(
  skill: MarketSkill,
  t: TFunction,
  format: BoundFormatters,
): { safe: boolean; label: string } {
  const verdict = skill.verdict?.toLocaleLowerCase();
  const safe = verdict === "allow" || (skill.securityScore ?? -1) >= 80;
  const level =
    skill.securityLevel && skill.securityLevel !== "NONE"
      ? skill.securityLevel
      : null;
  const score =
    skill.securityScore === null
      ? t("market.security.scoreMissing")
      : t("market.security.score", {
          score: format.formatNumber(skill.securityScore, {
            maximumFractionDigits: 0,
          }),
        });
  return {
    safe,
    label: [level, score, verdict].filter(Boolean).join(" · "),
  };
}

function formatCount(
  value: number | null,
  t: TFunction,
  format: BoundFormatters,
): string {
  return value === null ? t("market.notProvided") : format.formatNumber(value);
}
