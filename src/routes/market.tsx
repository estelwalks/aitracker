import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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

import {
  Dot,
  EmptyState,
  PageHeader,
  StatusBadge,
  TTButton,
} from "../components/tt";
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
} from "../lib/local-market";

const PAGE_SIZE = 20;

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
  loader: async () => {
    try {
      return {
        result: await getMarketSkills({
          data: { page: 1, limit: PAGE_SIZE, search: "" },
        }),
        error: null,
      };
    } catch (error) {
      return {
        result: emptyResult(),
        error:
          error instanceof Error
            ? error.message
            : "网络不可用：Skill 市场加载失败",
      };
    }
  },
  head: () => ({
    meta: [
      { title: "Skill 市场 · AITracker V3.0" },
      {
        name: "description",
        content:
          "浏览 AITracker Skill 市场真实索引，下载后执行本地静态安全检查。",
      },
    ],
  }),
  component: MarketPage,
});

function MarketPage() {
  const initial = Route.useLoaderData();
  const [result, setResult] = useState(initial.result);
  const [error, setError] = useState<string | null>(initial.error);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [retrySequence, setRetrySequence] = useState(0);
  const [detail, setDetail] = useState<MarketSkill | null>(null);
  const [installSkill, setInstallSkill] = useState<MarketSkill | null>(null);
  const firstRequest = useRef(true);
  const requestSequence = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(rawQuery.trim());
      setPage(1);
    }, 350);
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
    void getMarketSkills({ data: { page, limit: PAGE_SIZE, search: query } })
      .then((nextResult) => {
        if (sequence === requestSequence.current) setResult(nextResult);
      })
      .catch((requestError) => {
        if (sequence === requestSequence.current) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "网络不可用：Skill 市场加载失败",
          );
        }
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false);
      });
  }, [page, query, retrySequence]);

  const pages = result.pagination.pages;

  return (
    <>
      <PageHeader
        eyebrow="AITracker 市场接口"
        title="Skill 市场"
        desc={`真实社区索引 · 共 ${result.pagination.total.toLocaleString()} 个 Skill · 下载后执行本地静态扫描`}
        status={
          <StatusBadge
            tone={error || result.source === "cache" ? "warn" : "ok"}
          >
            <Dot
              className={`size-1 ${error || result.source === "cache" ? "bg-warn" : "bg-ok"}`}
            />
            {error
              ? "网络不可用"
              : result.source === "cache"
                ? "本地缓存"
                : "实时数据"}
          </StatusBadge>
        }
      />

      <div className="tt-panel mb-3 p-4">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={rawQuery}
            onChange={(event) => setRawQuery(event.target.value)}
            placeholder="按名称或描述搜索真实 Skill…"
            className="h-9 w-full rounded-sm border border-border bg-surface-2 pr-10 pl-9 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary"
          />
          {loading && (
            <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-primary" />
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            数据更新于 {formatDateTime(result.fetchedAt)}
            {query ? ` · 关键词“${query}”` : ""}
          </span>
          <span>
            每页 {PAGE_SIZE} 条 · 第 {result.pagination.page} 页
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {result.skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onDetail={() => setDetail(skill)}
                onInstall={() => setInstallSkill(skill)}
              />
            ))}
          </div>

          <div className="tt-num mt-4 flex items-center justify-center gap-2 text-xs">
            <TTButton
              size="sm"
              disabled={loading || page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              上一页
            </TTButton>
            <span className="px-2 text-muted-foreground">
              {result.pagination.page} / {Math.max(1, pages)}
            </span>
            <TTButton
              size="sm"
              disabled={loading || pages === 0 || page >= pages}
              onClick={() => setPage((current) => current + 1)}
            >
              下一页
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
          title={error ? "网络不可用" : "没有匹配的 Skill"}
          desc={
            error
              ? "请求失败且当前查询没有本地缓存，请检查网络后重试。"
              : "换一个关键词重新搜索。"
          }
          actions={
            error ? (
              <TTButton
                variant="primary"
                onClick={() => setRetrySequence((current) => current + 1)}
              >
                重试
              </TTButton>
            ) : undefined
          }
        />
      )}

      {detail && (
        <SkillDetail
          skill={detail}
          onClose={() => setDetail(null)}
          onInstall={() => {
            setDetail(null);
            setInstallSkill(detail);
          }}
        />
      )}
      {installSkill && (
        <InstallDialog
          skill={installSkill}
          onClose={() => setInstallSkill(null)}
        />
      )}
    </>
  );
}

function SkillCard({
  skill,
  onDetail,
  onInstall,
}: {
  skill: MarketSkill;
  onDetail: () => void;
  onInstall: () => void;
}) {
  const security = securityPresentation(skill);
  return (
    <article
      className="tt-panel flex min-h-56 cursor-pointer flex-col p-4 transition-colors hover:border-primary/50"
      onClick={onDetail}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
          {security.safe ? (
            <ShieldCheck className="size-4 shrink-0 text-ok" />
          ) : (
            <ShieldAlert className="size-4 shrink-0 text-warn" />
          )}
          <span className="truncate">{skill.name}</span>
        </h3>
        {skill.isOfficial && (
          <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
            官方
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">
        {skill.descriptionZh ?? skill.description ?? "该 Skill 暂未提供描述。"}
      </p>
      <div className="tt-num mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Download className="size-3" />
          安装 {formatCount(skill.installCount)}
        </span>
        <span className="flex items-center gap-1">
          <ShieldCheck className="size-3" />
          {security.label}
        </span>
        <span className="flex items-center gap-1">
          <Star className="size-3" />
          评分未提供
        </span>
        <span>版本未提供</span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="truncate text-[10px] text-muted-foreground">
          {skill.repoOwner}/{skill.repoName}
        </span>
        <div onClick={(event) => event.stopPropagation()}>
          <TTButton size="sm" variant="primary" onClick={onInstall}>
            安装到…
          </TTButton>
        </div>
      </div>
    </article>
  );
}

function SkillDetail({
  skill,
  onClose,
  onInstall,
}: {
  skill: MarketSkill;
  onClose: () => void;
  onInstall: () => void;
}) {
  const security = securityPresentation(skill);
  return (
    <Modal title={skill.name} onClose={onClose}>
      <div className="space-y-4 p-4 text-[13px]">
        <p className="leading-relaxed text-muted-foreground">
          {skill.descriptionZh ??
            skill.description ??
            "该 Skill 暂未提供描述。"}
        </p>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">安全级别 / 分数</dt>
          <dd>{security.label}</dd>
          <dt className="text-muted-foreground">平台审核状态</dt>
          <dd>{skill.status ?? "未提供"}</dd>
          <dt className="text-muted-foreground">安装量</dt>
          <dd>{formatCount(skill.installCount)}</dd>
          <dt className="text-muted-foreground">用户评分</dt>
          <dd>未提供</dd>
          <dt className="text-muted-foreground">版本</dt>
          <dd>未提供</dd>
          <dt className="text-muted-foreground">最后更新</dt>
          <dd>{formatDateTime(skill.updatedAt)}</dd>
          <dt className="text-muted-foreground">仓库路径</dt>
          <dd className="break-all font-mono text-[11px]">{skill.repoPath}</dd>
        </dl>
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
        {skill.repoUrl && (
          <a
            href={skill.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            查看源仓库 <ExternalLink className="size-3" />
          </a>
        )}
        <div className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
          平台安全分仅作为远端信息展示；点击安装后仍会下载压缩包并执行本地静态规则扫描。
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <TTButton onClick={onClose}>关闭</TTButton>
        <TTButton variant="primary" onClick={onInstall}>
          选择 Agent
        </TTButton>
      </div>
    </Modal>
  );
}

function InstallDialog({
  skill,
  onClose,
}: {
  skill: MarketSkill;
  onClose: () => void;
}) {
  const [agents, setAgents] = useState<MarketAgent[]>(["Claude Code"]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InstallSkillResult | null>(null);

  const toggleAgent = (agent: MarketAgent) => {
    setAgents((current) =>
      current.includes(agent)
        ? current.filter((item) => item !== agent)
        : [...current, agent],
    );
  };

  const submit = async () => {
    if (agents.length === 0) {
      setFailure("请至少选择一个 Agent");
      return;
    }
    setSubmitting(true);
    setFailure(null);
    setOutcome(null);
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
          agents,
        },
      });
      setOutcome(nextOutcome);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "下载或静态扫描失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`安装 ${skill.name}`} onClose={onClose}>
      <div className="space-y-4 p-4">
        <div>
          <div className="tt-label mb-2">{`选择 Agent（支持 ${MARKET_AGENTS.length} 个目标）`}</div>
          <div className="grid grid-cols-2 gap-2">
            {MARKET_AGENTS.map((agent) => (
              <label
                key={agent}
                className="flex cursor-pointer items-center gap-2 rounded-sm border border-border bg-surface-2 px-3 py-2 text-xs"
              >
                <input
                  type="checkbox"
                  checked={agents.includes(agent)}
                  onChange={() => toggleAgent(agent)}
                  className="accent-primary"
                />
                {agent}
              </label>
            ))}
          </div>
        </div>
        <div className="rounded-sm border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
          安装前会真实下载归档，在 AITracker
          临时目录安全解包并执行静态扫描；每个 Agent
          的安装结果将单独返回，临时文件随后自动清理。
        </div>
        {failure && (
          <div className="flex items-start gap-2 rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            {failure}
          </div>
        )}
        {outcome && <InstallOutcome outcome={outcome} />}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <TTButton onClick={onClose}>关闭</TTButton>
        <TTButton
          variant="primary"
          disabled={submitting || agents.length === 0}
          onClick={submit}
        >
          {submitting ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" /> 下载并扫描中
            </>
          ) : (
            "下载、扫描并准备安装"
          )}
        </TTButton>
      </div>
    </Modal>
  );
}

function InstallOutcome({ outcome }: { outcome: InstallSkillResult }) {
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
        <span>压缩包 {formatBytes(outcome.inspection.compressedBytes)}</span>
        <span>解压后 {formatBytes(outcome.inspection.scan.unpackedBytes)}</span>
        <span>检查条目 {outcome.inspection.scan.entriesChecked}</span>
        <span>扫描文件 {outcome.inspection.scan.filesScanned}</span>
      </div>
      <ul className="space-y-1 border-t border-border pt-2 text-[11px]">
        {outcome.targets.map((target) => (
          <li
            key={target.agent}
            className={target.installed ? "text-ok" : "text-danger"}
          >
            {target.installed ? "成功" : "失败"} · {target.agent} ·{" "}
            {target.message}
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

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="tt-panel max-h-[85vh] w-full max-w-xl overflow-auto bg-popover">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-popover px-4 py-3">
          <h2 className="truncate text-sm font-medium">{title}</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function securityPresentation(skill: MarketSkill): {
  safe: boolean;
  label: string;
} {
  const verdict = skill.verdict?.toLocaleLowerCase();
  const safe = verdict === "allow" || (skill.securityScore ?? -1) >= 80;
  const level =
    skill.securityLevel && skill.securityLevel !== "NONE"
      ? skill.securityLevel
      : null;
  const score =
    skill.securityScore === null
      ? "安全分未提供"
      : `安全分 ${skill.securityScore.toFixed(0)}`;
  return {
    safe,
    label: [level, score, skill.verdict].filter(Boolean).join(" · "),
  };
}

function formatCount(value: number | null): string {
  return value === null ? "未提供" : value.toLocaleString();
}

function formatDateTime(value: string | null): string {
  if (!value) return "未提供";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
