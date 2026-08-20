import { Brain, Download, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import { ChunkErrorBoundary } from "../../../components/ChunkErrorBoundary";
import { InsightCard } from "../../insights/page/presentation/insight-card";
import { EmptyState, SearchInput, TTButton } from "../../../components/tt";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import type { MessageKey } from "../../../lib/i18n/messages";
import {
  archiveMemory,
  createMemory,
  getMemoryAssets,
  updateMemory,
} from "../query";
import { MemoryModal } from "./memory-modal";
import type { MemoryCreateInput, MemoryEntry, MemoryType } from "./index";

// P6-T6-05: the editor form is an on-demand chunk (loaded only when the user
// edits an entry); the boundary keeps the page usable if the chunk
// fails to load.
const MemoryForm = lazy(() =>
  import("./MemoryForm.tsx").then((module) => ({
    default: module.MemoryForm,
  })),
);

type TypeFilter = "all" | MemoryType;

function sourceLabel(item: MemoryEntry, t: ReturnType<typeof useI18n>["t"]) {
  if (item.source === "distill") return t("memory.sourceDistill");
  if (item.source === "unknown") return t("memory.sourceUnknown");
  return item.source;
}

/** FR-024 来源分组的显示名：固定 token 走 i18n，工具名原样显示。 */
function sourceTokenLabel(token: string, t: ReturnType<typeof useI18n>["t"]) {
  if (token === "distill") return t("memory.sourceDistill");
  if (token === "manual") return t("memory.originManual");
  if (token === "unknown") return t("memory.sourceUnknown");
  return token;
}

function typeLabel(item: MemoryEntry, t: ReturnType<typeof useI18n>["t"]) {
  return item.type === "profile"
    ? t("memory.typeProfile")
    : t("memory.typeTask");
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** 单条记忆导出 MD：frontmatter + 完整正文（FR-014），浏览器本地下载（不触碰网络）。 */
function downloadMemoryMarkdown(item: MemoryEntry) {
  const safeName = (item.title || "memory")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, 60);
  const frontmatter = [
    "---",
    `title: ${item.title.replace(/\n/g, " ") || "记忆"}`,
    `type: ${item.type}`,
    `source: ${item.source}`,
    ...(item.project ? [`project: ${item.project}`] : []),
    `createdAt: ${item.createdAt}`,
    `updatedAt: ${item.updatedAt}`,
    "---",
    "",
    (item.body ?? item.summary) || "",
  ].join("\n");
  download(`${safeName || "memory"}.md`, frontmatter);
}

/**
 * 记忆库整页（V3.0 原型对齐）：JarvisInsight 概览、数据概览统计条、搜索 + 类型
 * 筛选、卡片网格（2/3 列）、编辑表单与删除确认。所有
 * 数据来自 knowledge 模块的 renderer-safe server fns —— 仅投影元数据与 provenance
 * 摘要，绝不返回对话正文（CLEAN_ROOM）。
 */
export function MemoryPage() {
  const { t, format } = useI18n();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  // P4-T4-03: counts come from the server projection (single store read),
  // never recomputed from a partial first screen.
  const [counts, setCounts] = useState({ total: 0, profile: 0, task: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  // FR-024：来源分组筛选。取值 "all" 或某个来源 token（distill / manual / 工具名）。
  const [source, setSource] = useState<string>("all");
  const [editing, setEditing] = useState<MemoryEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState<MemoryEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const rows = await getMemoryAssets();
      setEntries([...rows.entries]);
      setCounts(rows.counts);
      setHasMore(rows.hasMore);
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const list = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return entries
      .filter((item) => (type === "all" ? true : item.type === type))
      .filter((item) => (source === "all" ? true : item.source === source))
      .filter((item) => {
        if (!keyword) return true;
        // 与原型一致（搜「正文」）：搜 title/正文/来源/项目。正文是记忆产物
        // （FR-014），绝不返回对话正文（CLEAN_ROOM）。
        return [
          item.title,
          item.body ?? item.summary,
          sourceLabel(item, t),
          item.project,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      });
  }, [entries, q, type, source, t]);

  // FR-024：来源分组——固定 token（distill/manual/unknown）置前，工具名按字母序。
  const sourceOptions = useMemo(() => {
    const tokens = [...new Set(entries.map((item) => item.source))].filter(
      Boolean,
    );
    const rank = (token: string) =>
      token === "distill"
        ? 0
        : token === "manual"
          ? 1
          : token === "unknown"
            ? 2
            : 3;
    return tokens.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [entries]);

  const distillCount = useMemo(
    () => entries.filter((item) => item.origin === "distill").length,
    [entries],
  );
  const lastUpdated = useMemo(
    () =>
      entries.reduce(
        (max, item) =>
          Math.max(max, Date.parse(item.updatedAt || item.createdAt) || 0),
        0,
      ),
    [entries],
  );

  const statCards = [
    {
      label: t("memory.statTotal"),
      value: format.formatNumber(counts.total),
      sub: t("memory.statTotalSub", {
        profile: counts.profile,
        task: counts.task,
      }),
    },
    {
      label: t("memory.statProfile"),
      value: format.formatNumber(counts.profile),
      sub: t("memory.statProfileSub"),
    },
    {
      label: t("memory.statDistill"),
      value: format.formatNumber(distillCount),
      sub: t("memory.statDistillSub", {
        manual: Math.max(0, counts.total - distillCount),
      }),
    },
    {
      label: t("memory.statUpdated"),
      value: lastUpdated
        ? format.formatDateTime(new Date(lastUpdated), false)
        : "—",
      sub: t("memory.statUpdatedSub"),
    },
  ];

  function errorMessage(errorCode?: string): string {
    return errorCode ? t(errorCode as MessageKey) : t("common.failed");
  }

  async function handleUpdate(assetId: string, input: MemoryCreateInput) {
    setBusy(true);
    try {
      const result = await updateMemory({ data: { assetId, ...input } });
      if (!result.ok || !result.entry) {
        toast.error(errorMessage(result.errorCode));
        return;
      }
      setEntries((prev) =>
        prev.map((item) => (item.assetId === assetId ? result.entry! : item)),
      );
      setEditing(null);
      toast.success(t("memory.edited"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  /** FR-025：手动新增一条记忆（body 服务端 hash，仅存摘要）。 */
  async function handleCreate(input: MemoryCreateInput) {
    setBusy(true);
    try {
      const result = await createMemory({ data: input });
      if (!result.ok || !result.entry) {
        toast.error(errorMessage(result.errorCode));
        return;
      }
      setCreating(false);
      // counts 来自服务端投影，重新拉取保证统计准确。
      await reload();
      toast.success(t("memory.added"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(assetId: string) {
    setBusy(true);
    try {
      const result = await archiveMemory({ data: { assetId } });
      if (!result.ok) {
        toast.error(errorMessage(result.errorCode));
        return;
      }
      const deletedType = entries.find(
        (item) => item.assetId === assetId,
      )?.type;
      setEntries((prev) => prev.filter((item) => item.assetId !== assetId));
      setCounts((prev) => ({
        total: Math.max(0, prev.total - 1),
        profile: Math.max(
          0,
          prev.profile - (deletedType === "profile" ? 1 : 0),
        ),
        task: Math.max(0, prev.task - (deletedType === "task" ? 1 : 0)),
      }));
      setConfirmDel(null);
      toast.success(t("memory.removed"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const filtered = q.trim() !== "" || type !== "all" || source !== "all";

  return (
    <div className="space-y-4 pb-12">
      <InsightCard
        surfaceId="memory"
        variant="hero"
        title={t("memory.insightTitle")}
        dotsLabel={t("memory.insightDots")}
      />

      {/* 数据概览（V3.0 原型对齐） */}
      <div className="overflow-hidden rounded-xl bg-card">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {statCards.map((card) => (
            <div
              key={card.label}
              className="bg-card px-4 py-3.5 transition-colors hover:bg-surface-2"
            >
              <div className="truncate font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70 uppercase">
                {card.label}
              </div>
              <div className="tt-num mt-2 truncate text-[22px] leading-none font-black tracking-tight">
                {card.value}
              </div>
              <div
                className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                title={card.sub}
              >
                {card.sub}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 筛选栏（V3.0 原型：tt-panel + 玻璃分段） */}
      <div className="tt-panel flex flex-wrap items-center gap-2 p-2">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder={t("memory.searchPlaceholder")}
          ariaLabel={t("memory.searchPlaceholder")}
          className="min-w-0 flex-1"
        />
        <div className="inline-flex shrink-0 rounded-sm border border-border bg-surface-2 p-0.5">
          {(
            [
              {
                value: "all" as TypeFilter,
                label: `${t("memory.typeAll")} ${counts.total}`,
              },
              {
                value: "profile" as TypeFilter,
                label: `${t("memory.typeProfile")} ${counts.profile}`,
              },
              {
                value: "task" as TypeFilter,
                label: `${t("memory.typeTask")} ${counts.task}`,
              },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setType(option.value)}
              className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${
                type === option.value
                  ? "bg-primary/15 font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {/* FR-024：按来源分组（全部 / 蒸馏 / 手动 / 工具名） */}
        <div className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-sm border border-border bg-surface-2 p-0.5">
          <button
            key="all"
            type="button"
            onClick={() => setSource("all")}
            className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${
              source === "all"
                ? "bg-primary/15 font-medium text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("memory.allSources")}
          </button>
          {sourceOptions.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => setSource(token)}
              className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${
                source === token
                  ? "bg-primary/15 font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {sourceTokenLabel(token, t)}
            </button>
          ))}
        </div>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setType("all");
              setSource("all");
            }}
            className="shrink-0 rounded-full px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("memory.reset")}
          </button>
        )}
        <TTButton
          size="sm"
          onClick={() => setCreating(true)}
          className="ml-auto shrink-0"
        >
          <Plus className="size-3.5" strokeWidth={2} />
          {t("memory.add")}
        </TTButton>
      </div>

      {/* 列表头 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span>
          {t("memory.count", { count: format.formatNumber(list.length) })}
        </span>
        <span className="ml-auto">{t("memory.countHint")}</span>
      </div>

      {loading ? (
        <div className="tt-panel p-5">
          <EmptyState
            icon={<Sparkles className="size-5" strokeWidth={1.8} />}
            title={t("common.loading")}
          />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Brain className="size-5" strokeWidth={1.8} />}
          title={t("memory.empty")}
          desc={t("memory.emptyDesc")}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((item) => (
              <MemoryCard
                key={item.assetId}
                item={item}
                busy={busy}
                onEdit={() => setEditing(item)}
                onDelete={() => setConfirmDel(item)}
              />
            ))}
          </div>
          {hasMore && (
            <p className="mt-2 px-1 font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground/60">
              {t("memory.hasMore", {
                total: counts.total,
                limit: 50,
              })}
            </p>
          )}
        </>
      )}

      {editing && (
        <ChunkErrorBoundary>
          <Suspense
            fallback={
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60">
                <span className="text-[12.5px] text-muted-foreground">
                  {t("common.loading")}
                </span>
              </div>
            }
          >
            <MemoryForm
              item={editing}
              busy={busy}
              onClose={() => setEditing(null)}
              onSubmit={(input) => handleUpdate(editing.assetId, input)}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      {creating && (
        <ChunkErrorBoundary>
          <Suspense
            fallback={
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60">
                <span className="text-[12.5px] text-muted-foreground">
                  {t("common.loading")}
                </span>
              </div>
            }
          >
            <MemoryForm
              item={null}
              busy={busy}
              onClose={() => setCreating(false)}
              onSubmit={(input) => void handleCreate(input)}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      {confirmDel && (
        <MemoryModal
          title={t("memory.deleteTitle")}
          onClose={() => setConfirmDel(null)}
          footer={
            <>
              <TTButton onClick={() => setConfirmDel(null)} disabled={busy}>
                {t("memory.cancel")}
              </TTButton>
              <TTButton
                variant="danger"
                onClick={() => void handleDelete(confirmDel.assetId)}
                disabled={busy}
              >
                {t("memory.delete")}
              </TTButton>
            </>
          }
        >
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t("memory.deleteConfirm", { title: confirmDel.title })}
          </p>
        </MemoryModal>
      )}
    </div>
  );
}

function MemoryCard({
  item,
  busy,
  onEdit,
  onDelete,
}: {
  item: MemoryEntry;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t, format } = useI18n();
  const label = sourceLabel(item, t);
  const sourceLine = `${t("memory.form.source")} ${label}${
    item.project ? ` · ${item.project}` : ""
  }`;

  return (
    <article className="group flex min-w-0 flex-col rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40 hover:bg-surface-2/40">
      <div className="min-w-0">
        <button
          type="button"
          onClick={onEdit}
          className="block w-full truncate text-left text-[13px] font-medium hover:text-primary"
          title={item.title}
        >
          {item.title}
        </button>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
            {typeLabel(item, t)}
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {sourceLine}
          </span>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-3 min-h-[3.2em] text-[12.5px] leading-relaxed text-muted-foreground">
        {(item.body ?? item.summary) || "—"}
      </p>

      <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5">
        <span className="tt-num font-mono text-[10.5px] text-muted-foreground">
          {format.formatDateTime(item.updatedAt || item.createdAt, false)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <TTButton
            size="sm"
            onClick={() => {
              downloadMemoryMarkdown(item);
              toast.success(t("memory.exportMd"));
            }}
            disabled={busy}
          >
            <Download className="size-3.5" strokeWidth={2} />
            {t("memory.exportMd")}
          </TTButton>
          <TTButton
            size="sm"
            onClick={onEdit}
            disabled={busy}
            title={t("memory.edit")}
          >
            <Pencil className="size-3.5" strokeWidth={2} />
          </TTButton>
          <TTButton
            size="sm"
            variant="danger"
            onClick={onDelete}
            disabled={busy}
            title={t("memory.delete")}
          >
            <Trash2 className="size-3.5" strokeWidth={2} />
          </TTButton>
        </span>
      </div>
    </article>
  );
}
