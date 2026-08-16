import { Link } from "@tanstack/react-router";
import {
  Brain,
  FlaskConical,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { JarvisInsight } from "../../../components/JarvisInsight";
import {
  EmptyState,
  Panel,
  SearchInput,
  Segmented,
  TTButton,
} from "../../../components/tt";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import type { MessageKey } from "../../../lib/i18n/messages";
import {
  archiveMemory,
  createMemory,
  getMemoryAssets,
  updateMemory,
} from "../query";
import type { MemoryCreateInput, MemoryEntry, MemoryType } from "./index";

type TypeFilter = "all" | MemoryType;

/** 类型色标（与原型 memoryTypeMeta 一致的 chart 色）。 */
const TYPE_COLORS: Record<MemoryType, string> = {
  profile: "var(--chart-2)",
  task: "var(--chart-4)",
};

function sourceLabel(item: MemoryEntry, t: ReturnType<typeof useI18n>["t"]) {
  if (item.source === "distill") return t("memory.sourceDistill");
  if (item.source === "unknown") return t("memory.sourceUnknown");
  return item.source;
}

/**
 * 记忆库整页（V3.0 原型对齐）：JarvisInsight 概览、搜索 + 类型筛选 + 新增/
 * 去蒸馏入口、按来源分组侧栏与记忆卡片网格、新增/编辑表单与删除确认。所有
 * 数据来自 knowledge 模块的 renderer-safe server fns —— 仅投影元数据与
 * provenance 摘要，绝不返回对话正文（CLEAN_ROOM）。
 */
export function MemoryPage() {
  const { t, format } = useI18n();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [source, setSource] = useState<string>("all");
  const [editing, setEditing] = useState<MemoryEntry | "new" | null>(null);
  const [confirmDel, setConfirmDel] = useState<MemoryEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const rows = await getMemoryAssets();
      setEntries(rows);
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

  const counts = useMemo(
    () => ({
      total: entries.length,
      profile: entries.filter((item) => item.type === "profile").length,
      task: entries.filter((item) => item.type === "task").length,
    }),
    [entries],
  );

  const sources = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const item of entries) {
      const label = sourceLabel(item, t);
      const row = map.get(item.source) ?? { label, count: 0 };
      row.count += 1;
      map.set(item.source, row);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
  }, [entries, t]);

  const list = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return entries
      .filter((item) => (type === "all" ? true : item.type === type))
      .filter((item) => (source === "all" ? true : item.source === source))
      .filter((item) => {
        if (!keyword) return true;
        return [item.title, item.summary, sourceLabel(item, t), item.project]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      });
  }, [entries, q, type, source, t]);

  const jarvisLines = useMemo(() => {
    if (counts.total === 0) return [t("memory.insightEmpty")];
    return [
      t("memory.insightTotal", {
        total: counts.total,
        profile: counts.profile,
        task: counts.task,
      }),
      t("memory.insightMeaning"),
      t("memory.insightDistill"),
    ];
  }, [counts, t]);

  function errorMessage(errorCode?: string): string {
    return errorCode ? t(errorCode as MessageKey) : t("common.failed");
  }

  async function handleCreate(input: MemoryCreateInput) {
    setBusy(true);
    try {
      const result = await createMemory({ data: input });
      if (!result.ok || !result.entry) {
        toast.error(errorMessage(result.errorCode));
        return;
      }
      setEntries((prev) => [result.entry!, ...prev]);
      setEditing(null);
      toast.success(t("memory.added"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
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

  async function handleDelete(assetId: string) {
    setBusy(true);
    try {
      const result = await archiveMemory({ data: { assetId } });
      if (!result.ok) {
        toast.error(errorMessage(result.errorCode));
        return;
      }
      setEntries((prev) => prev.filter((item) => item.assetId !== assetId));
      setConfirmDel(null);
      toast.success(t("memory.removed"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pb-12">
      <JarvisInsight
        title={t("memory.title")}
        lines={jarvisLines}
        rotateLabel={t("memory.insightRotate")}
        dotsLabel={t("memory.insightDots")}
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder={t("memory.searchPlaceholder")}
            ariaLabel={t("memory.searchPlaceholder")}
          />
          <div className="ml-auto flex items-center gap-2">
            <Segmented
              value={type}
              onChange={setType}
              options={[
                {
                  value: "all",
                  label: `${t("memory.typeAll")} ${counts.total}`,
                },
                {
                  value: "profile",
                  label: `${t("memory.typeProfile")} ${counts.profile}`,
                },
                {
                  value: "task",
                  label: `${t("memory.typeTask")} ${counts.task}`,
                },
              ]}
            />
            <TTButton
              onClick={() => setEditing("new")}
              disabled={busy}
              title={t("memory.add")}
            >
              <Plus className="size-3.5" strokeWidth={2} />
              {t("memory.add")}
            </TTButton>
            <Link to="/distill">
              <TTButton>
                <FlaskConical className="size-3.5" strokeWidth={1.8} />
                {t("memory.goDistill")}
              </TTButton>
            </Link>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[196px_minmax(0,1fr)]">
        <aside className="h-fit rounded-[var(--radius)] bg-card p-2">
          <p className="px-2 py-1.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70 uppercase">
            {t("memory.source")}
          </p>
          <ul className="space-y-0.5">
            <SourceRow
              label={t("memory.allSources")}
              count={counts.total}
              on={source === "all"}
              onClick={() => setSource("all")}
            />
            {sources.map(([key, row]) => (
              <SourceRow
                key={key}
                label={row.label}
                count={row.count}
                on={source === key}
                onClick={() => setSource(key)}
              />
            ))}
          </ul>
        </aside>

        {loading ? (
          <Panel>
            <EmptyState
              icon={<Sparkles className="size-5" strokeWidth={1.8} />}
              title={t("common.loading")}
            />
          </Panel>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Brain className="size-5" strokeWidth={1.8} />}
            title={t("memory.empty")}
            desc={t("memory.emptyDesc")}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
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
        )}
      </div>

      {editing && (
        <MemoryForm
          item={editing === "new" ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSubmit={
            editing === "new"
              ? (input) => handleCreate(input)
              : (input) => handleUpdate(editing.assetId, input)
          }
        />
      )}

      {confirmDel && (
        <Dialog open onOpenChange={(open) => !open && setConfirmDel(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("memory.deleteTitle")}</DialogTitle>
              <DialogDescription>
                {t("memory.deleteConfirm", { title: confirmDel.title })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <TTButton
                variant="ghost"
                onClick={() => setConfirmDel(null)}
                disabled={busy}
              >
                {t("memory.cancel")}
              </TTButton>
              <button
                type="button"
                onClick={() => void handleDelete(confirmDel.assetId)}
                disabled={busy}
                className="rounded-sm bg-[var(--chart-5)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {t("memory.delete")}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function SourceRow({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
          on
            ? "bg-primary/12 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="font-mono text-[10.5px] opacity-70">{count}</span>
      </button>
    </li>
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
  const color = TYPE_COLORS[item.type];
  const typeLabel =
    item.type === "profile" ? t("memory.typeProfile") : t("memory.typeTask");
  const label = sourceLabel(item, t);
  const originLabel =
    item.origin === "distill"
      ? t("memory.originDistill")
      : t("memory.originManual");
  const meta = [
    label,
    ...(item.project ? [item.project] : []),
    // 蒸馏条目 source 已显示「蒸馏」，origin 标签不再重复。
    ...(item.origin === "manual" ? [originLabel] : []),
    format.formatDateTime(item.createdAt),
  ].join(" · ");

  return (
    <div className="group rounded-[var(--radius)] bg-card p-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2">
          <Sparkles className="size-4" style={{ color }} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]"
              style={{
                background: `color-mix(in oklab, ${color} 16%, transparent)`,
                color,
              }}
            >
              {typeLabel}
            </span>
            <p
              className="min-w-0 flex-1 truncate text-[13.5px] font-semibold"
              title={item.title}
            >
              {item.title}
            </p>
          </div>
          <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-foreground/85">
            {item.summary || "—"}
          </p>
          <p className="mt-2 truncate font-mono text-[10.5px] text-muted-foreground">
            {meta}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Pencil className="size-3" strokeWidth={2} />
          {t("memory.edit")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-[var(--chart-5)] disabled:opacity-40"
        >
          <Trash2 className="size-3" strokeWidth={2} />
          {t("memory.delete")}
        </button>
      </div>
    </div>
  );
}

function MemoryForm({
  item,
  busy,
  onClose,
  onSubmit,
}: {
  item: MemoryEntry | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: MemoryCreateInput) => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<MemoryType>(item?.type ?? "profile");
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.summary ?? "");
  const [source, setSource] = useState(item?.source ?? "Claude Code");
  const [project, setProject] = useState(item?.project ?? "");
  const ok = title.trim().length > 0 && body.trim().length > 0;
  const editingExisting = item != null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editingExisting ? t("memory.editTitle") : t("memory.add")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {editingExisting ? (
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                style={{
                  background: `color-mix(in oklab, ${TYPE_COLORS[item.type]} 16%, transparent)`,
                  color: TYPE_COLORS[item.type],
                }}
              >
                {item.type === "profile"
                  ? t("memory.typeProfile")
                  : t("memory.typeTask")}
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {item.type === "profile"
                  ? t("memory.form.typeProfileDesc")
                  : t("memory.form.typeTaskDesc")}
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {(["profile", "task"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setType(candidate)}
                  className="rounded-lg px-3 py-1.5 text-[12px] transition-colors"
                  style={
                    type === candidate
                      ? {
                          background: `color-mix(in oklab, ${TYPE_COLORS[candidate]} 16%, transparent)`,
                          color: TYPE_COLORS[candidate],
                        }
                      : undefined
                  }
                >
                  {candidate === "profile"
                    ? t("memory.typeProfile")
                    : t("memory.typeTask")}
                </button>
              ))}
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {type === "profile"
                  ? t("memory.form.typeProfileDesc")
                  : t("memory.form.typeTaskDesc")}
              </span>
            </div>
          )}

          <label className="block space-y-1">
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {t("memory.form.title")}
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={256}
              placeholder={t("memory.form.titlePlaceholder")}
              className="w-full rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {t("memory.form.body")}
            </span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={5}
              maxLength={4000}
              placeholder={t("memory.form.bodyPlaceholder")}
              className="w-full resize-y rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-6 outline-none"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {t("memory.form.source")}
              </span>
              <input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                maxLength={128}
                placeholder={t("memory.form.sourcePlaceholder")}
                className="w-full rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {t("memory.form.project")}
              </span>
              <input
                value={project}
                onChange={(event) => setProject(event.target.value)}
                maxLength={128}
                placeholder={t("memory.form.projectPlaceholder")}
                className="w-full rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] outline-none"
              />
            </label>
          </div>
        </div>
        <DialogFooter>
          <TTButton variant="ghost" onClick={onClose} disabled={busy}>
            {t("memory.cancel")}
          </TTButton>
          <button
            type="button"
            disabled={!ok || busy}
            onClick={() =>
              onSubmit({
                type,
                title: title.trim(),
                body: body.trim(),
                source: source.trim() || "manual",
                ...(project.trim() ? { project: project.trim() } : {}),
              })
            }
            className="rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            {t("memory.form.save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
