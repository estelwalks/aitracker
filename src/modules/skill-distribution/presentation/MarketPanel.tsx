import { useEffect, useMemo, useState } from "react";
import { Download, Search, ShieldAlert, ShieldCheck, Star } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, Segmented, Stat, TTButton } from "../../../components/tt";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { Progress } from "../../../components/ui/progress";
import { Badge } from "../../../components/ui/badge";
import { useI18n } from "../../../lib/i18n/context";
import { toUiError } from "../../../lib/errors";
import type { MessageKey, MessageParams } from "../../../lib/i18n/messages";
import type { BoundFormatters } from "../../../lib/i18n/format";
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

const PAGE_SIZE = 24;

type TFunction = <K extends MessageKey>(
  key: K,
  params?: MessageParams<K>,
) => string;

function securityOf(skill: MarketSkill, t: TFunction, format: BoundFormatters) {
  const safe =
    skill.verdict === "allow" ||
    (skill.securityScore != null && skill.securityScore >= 80);
  const label =
    skill.securityLevel ??
    (safe ? t("market.security.safe") : t("market.security.attention"));
  return { safe, label };
}

const SORT_OPTIONS: { value: MarketSort; labelKey: MessageKey }[] = [
  { value: "downloads", labelKey: "market.sort.downloads" },
  { value: "latest", labelKey: "market.sort.latest" },
  { value: "stars", labelKey: "market.sort.stars" },
  { value: "tokens", labelKey: "market.sort.tokens" },
];

function formatBytes(format: BoundFormatters, bytes: number | null): string {
  if (bytes == null || bytes <= 0) return "-";
  return format.formatBytes(bytes);
}

/** Card-grid market catalog used by the Skill Hub market tab. */
export function MarketPanel({ initial }: { initial: MarketListResult }) {
  const { t, format } = useI18n();
  const [result, setResult] = useState(initial);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MarketSort>("downloads");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<MarketSkill | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getMarketSkills({
      data: { page: 1, limit: PAGE_SIZE, search: query, sort },
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
  }, [query, sort, t]);

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

  // Page-level real aggregates for the 5-cell stats strip.
  const pageStats = useMemo(() => {
    const safeCount = result.skills.filter(
      (skill) => securityOf(skill, t, format).safe,
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
  }, [result.skills, t, format]);

  return (
    <div>
      {/* 5-cell stats strip (V3.0 prototype) — real server fn aggregates only. */}
      <div className="mb-4 grid gap-px overflow-x-auto rounded-sm border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
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
          hint={t("market.stats.passRatePage")}
        />
        <Stat
          label={t("market.stats.installedCount")}
          value={format.formatNumber(result.stats?.installedCount ?? 0)}
          hint={t("market.stats.hintLocalInstalled")}
        />
        <Stat
          label={t("market.stats.totalDownloads")}
          value={format.formatNumber(result.stats?.totalDownloads ?? 0)}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={rawQuery}
            onChange={(event) => setRawQuery(event.target.value)}
            placeholder={t("market.search.placeholder")}
            aria-label={t("market.search.placeholder")}
            className="h-9 w-full rounded-lg bg-surface-2/70 pr-8 pl-9 text-[13px] outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <Segmented
          value={sort}
          onChange={setSort}
          options={SORT_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
        />
      </div>

      {result.skills.length === 0 ? (
        <EmptyState
          title={t("market.empty.noMatch")}
          desc={t("market.empty.noMatchDesc")}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {result.skills.map((skill) => {
            const security = securityOf(skill, t, format);
            const installed = installedNames.has(skill.name);
            const downloads = skill.installCount ?? 0;
            const downloadPercent = Math.max(
              2,
              Math.round((downloads / pageStats.maxInstall) * 100),
            );
            return (
              <div
                key={skill.id}
                className="flex flex-col rounded-xl bg-card p-4 ring-1 ring-border/50 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
              >
                <button
                  type="button"
                  onClick={() => setDetail(skill)}
                  className="text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg"
                >
                  <div className="flex items-start gap-2">
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
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-4 text-muted-foreground">
                        {skill.descriptionZh ??
                          skill.description ??
                          t("market.noDescription")}
                      </p>
                    </div>
                  </div>

                  {/* Downloads bar (relative to the page's max, real numbers). */}
                  <div className="mt-3">
                    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${downloadPercent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Download className="size-3" />
                      {skill.installCount != null
                        ? format.formatNumber(skill.installCount)
                        : "-"}
                    </span>
                    <span>
                      {skill.tokens != null
                        ? format.formatNumber(skill.tokens)
                        : "-"}{" "}
                      {t("market.table.tokenUsage")}
                    </span>
                    <span>{formatBytes(format, skill.size)}</span>
                    {skill.stars != null && (
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="size-3 fill-amber-400 text-amber-400" />
                        {format.formatNumber(skill.stars)}
                      </span>
                    )}
                  </div>
                </button>

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] ${
                      security.safe ? "text-ok" : "text-warn"
                    }`}
                  >
                    {security.safe ? (
                      <ShieldCheck className="size-3.5" />
                    ) : (
                      <ShieldAlert className="size-3.5" />
                    )}
                    {security.label}
                  </span>
                  <TTButton
                    size="sm"
                    variant={installed ? "ghost" : "primary"}
                    disabled={installed}
                    onClick={() => setDetail(skill)}
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
            );
          })}
        </div>
      )}

      {detail && (
        <MarketInstallSheet
          skill={detail}
          detectedAgents={detectedAgents}
          installedSkillNames={installedNames}
          onClose={() => setDetail(null)}
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

function MarketInstallSheet({
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
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {skill.isOfficial === true && (
              <Badge
                variant="secondary"
                className="bg-primary/10 text-[10px] font-normal text-primary"
              >
                {t("market.official")}
              </Badge>
            )}
            {skill.name}
          </SheetTitle>
          <SheetDescription>
            {skill.descriptionZh ??
              skill.description ??
              t("market.noDescription")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
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

          <div className="flex justify-end gap-2">
            <TTButton variant="ghost" onClick={onClose}>
              {t("common.close")}
            </TTButton>
            <TTButton
              variant="primary"
              disabled={!agent || submitting || installed}
              onClick={handleInstall}
            >
              {installed ? t("market.installed") : t("market.install.button")}
            </TTButton>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
