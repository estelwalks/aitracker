import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FolderOpen, Search, X } from "lucide-react";

import { BrandIcon, brandColorOf } from "../../../../components/BrandIcon";
import { EmptyState, TTButton } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import type { DistillationSessionItem } from "../index.ts";
import {
  groupDistillationSessionsByProject,
  materialKeyOf,
  type DistillationMaterialGranularity,
} from "./materials.ts";

const MAX_SELECTION = 8;

/**
 * Full-screen material library matching the prototype's workspace hierarchy.
 * The right pane intentionally shows only the real, renderer-safe metadata
 * exposed by the session projection. Message bodies are never requested or
 * invented to imitate the prototype's per-message range picker.
 */
export function MaterialDrawer({
  sessions,
  selected,
  granularity,
  onToggle,
  onToggleProject,
  onClose,
}: {
  sessions: readonly DistillationSessionItem[];
  selected: ReadonlySet<string>;
  granularity: DistillationMaterialGranularity;
  onToggle: (item: DistillationSessionItem) => void;
  onToggleProject: (items: readonly DistillationSessionItem[]) => void;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(
    () => sessions[0] && materialKeyOf(sessions[0]),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return sessions;
    return sessions.filter(
      (item) =>
        item.title.toLocaleLowerCase().includes(needle) ||
        item.source.toLocaleLowerCase().includes(needle) ||
        item.projectKey.toLocaleLowerCase().includes(needle),
    );
  }, [sessions, query]);
  const active =
    sessions.find((item) => materialKeyOf(item) === activeKey) ??
    filtered[0] ??
    null;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={t("common.distillation.materialDrawerTitle")}
    >
      <button
        type="button"
        aria-label={t("common.close")}
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
      />
      <section className="relative flex h-[86vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-3xl bg-card shadow-2xl ring-1 ring-border/70">
        <header className="relative flex items-center gap-3 overflow-hidden px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <FolderOpen className="size-4.5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight">
              {t("common.distillation.materialDrawerTitle")}
            </h2>
            <p className="text-[12px] text-muted-foreground">
              {t("common.distillation.materialSegmentUnavailable")}
            </p>
          </div>
          <span className="hidden rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10px] text-muted-foreground sm:inline">
            ESC
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r border-border/60">
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("common.distillation.materialSearch")}
                  aria-label={t("common.search")}
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <div className="tt-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {filtered.length === 0 ? (
                <EmptyState
                  title={t("common.distillation.noSessions")}
                  desc={t("common.distillation.noSessionsDesc")}
                />
              ) : (
                <ul className="space-y-1">
                  {filtered.map((item) => {
                    const key = materialKeyOf(item);
                    const checked = selected.has(key);
                    const disabled = !checked && selected.size >= MAX_SELECTION;
                    const activeItem = activeKey === key;
                    const color = brandColorOf(item.source);
                    return (
                      <li key={key} className="relative">
                        <button
                          type="button"
                          onClick={() => setActiveKey(key)}
                          className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 pr-24 text-left transition-colors ${
                            activeItem
                              ? "bg-surface-2"
                              : "hover:bg-foreground/[0.04]"
                          }`}
                          style={
                            activeItem
                              ? { boxShadow: `inset 2px 0 0 ${color}` }
                              : undefined
                          }
                        >
                          <BrandIcon
                            name={item.source}
                            className="mt-1 size-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px]">
                              {item.title}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-muted-foreground">
                              {item.projectKey} ·{" "}
                              {t("common.distillation.selectedTurns", {
                                count: item.turns,
                              })}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onToggle(item)}
                          className="absolute top-1/2 right-2 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1.5 font-mono text-[10px] disabled:opacity-35"
                          style={
                            checked
                              ? { background: color, color: "white" }
                              : undefined
                          }
                        >
                          <span className="grid size-3.5 place-items-center rounded border border-current/25">
                            {checked && (
                              <Check className="size-2.5" strokeWidth={3} />
                            )}
                          </span>
                          {checked
                            ? t("distill.materialAdded")
                            : t("distill.materialAdd")}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="tt-scroll hidden min-h-0 overflow-y-auto md:block">
            {active ? (
              <div className="p-6">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2">
                    <BrandIcon name={active.source} className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-semibold">
                      {active.title}
                    </h3>
                    <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                      {active.source}:{active.sessionId}
                    </p>
                  </div>
                  <TTButton
                    variant={
                      selected.has(materialKeyOf(active))
                        ? "default"
                        : "primary"
                    }
                    disabled={
                      !selected.has(materialKeyOf(active)) &&
                      selected.size >= MAX_SELECTION
                    }
                    onClick={() => onToggle(active)}
                  >
                    <Check className="size-3.5" />
                    {selected.has(materialKeyOf(active))
                      ? t("distill.materialRemove")
                      : t("distill.materialAdd")}
                  </TTButton>
                </div>
                <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    [t("distill.materialProject"), active.projectKey],
                    [t("distill.materialSource"), active.source],
                    [t("distill.materialTurns"), String(active.turns)],
                    [
                      t("distill.materialModel"),
                      active.model ?? t("common.unknown"),
                    ],
                    [
                      t("distill.materialStarted"),
                      format.formatDateTime(active.startedAt, false),
                    ],
                    [
                      t("distill.materialEnded"),
                      format.formatDateTime(active.endedAt, false),
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-xl bg-surface-2 px-4 py-3"
                    >
                      <dt className="font-mono text-[10px] text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="mt-1 truncate text-[12.5px]">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-5 rounded-xl border border-border/60 bg-surface-2/40 p-4">
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    {t("distill.materialPrivacyNote")}
                  </p>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<FolderOpen className="size-6" />}
                title={t("common.distillation.noSessions")}
                desc={t("common.distillation.noSessionsDesc")}
              />
            )}
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 bg-surface-2/50 px-5 py-3">
          <span className="font-mono text-[11px] text-muted-foreground">
            {t("common.distillation.selected", { count: selected.size })} /{" "}
            {MAX_SELECTION}
          </span>
          <span className="ml-auto text-[10.5px] text-muted-foreground">
            {granularity === "project"
              ? t("distill.projectAtomicHint")
              : t("distill.sessionSelectionHint")}
          </span>
          <TTButton variant="primary" onClick={onClose}>
            {t("common.confirm")}
          </TTButton>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/** Compact session/project card grid shared by quick mode and the page. */
export function MaterialPicker({
  sessions,
  selected,
  granularity,
  onToggle,
  onToggleProject,
  compact = false,
}: {
  sessions: readonly DistillationSessionItem[];
  selected: ReadonlySet<string>;
  granularity: DistillationMaterialGranularity;
  onToggle: (item: DistillationSessionItem) => void;
  onToggleProject: (items: readonly DistillationSessionItem[]) => void;
  compact?: boolean;
}) {
  const { t, format } = useI18n();
  if (sessions.length === 0) {
    return (
      <EmptyState
        title={t("common.distillation.noSessions")}
        desc={t("common.distillation.noSessionsDesc")}
      />
    );
  }

  if (granularity === "project") {
    return (
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {groupDistillationSessionsByProject(sessions).map((project) => {
          const keys = project.sessions.map(materialKeyOf);
          const selectedCount = keys.filter((key) => selected.has(key)).length;
          const checked = selectedCount === keys.length;
          const disabled =
            !checked &&
            selected.size + keys.length - selectedCount > MAX_SELECTION;
          const turns = project.sessions.reduce(
            (sum, item) => sum + item.turns,
            0,
          );
          return (
            <li key={project.key}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggleProject(project.sessions)}
                aria-pressed={checked}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-all disabled:opacity-35 ${
                  checked
                    ? "bg-primary/10 ring-1 ring-primary/70"
                    : "bg-surface-2 hover:bg-accent"
                }`}
              >
                <BrandIcon name={project.source} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]">
                    {project.projectKey}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {t("distill.projectSessions", { count: keys.length })} ·{" "}
                    {t("common.distillation.selectedTurns", { count: turns })}
                  </span>
                </span>
                {checked && (
                  <Check className="size-3.5 shrink-0 text-primary" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul
      className={`${compact ? "max-h-[280px] overflow-y-auto pr-1" : ""} space-y-1.5`}
    >
      {sessions.map((item) => {
        const key = materialKeyOf(item);
        const checked = selected.has(key);
        const disabled = !checked && selected.size >= MAX_SELECTION;
        return (
          <li key={key}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onToggle(item)}
              aria-pressed={checked}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-all disabled:opacity-35 ${
                checked
                  ? "bg-primary/10 ring-1 ring-primary/70"
                  : "bg-surface-2 hover:bg-accent"
              }`}
            >
              <BrandIcon name={item.source} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px]">
                  {item.title}
                </span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  {item.projectKey} ·{" "}
                  {format.formatDateTime(item.startedAt, false)} ·{" "}
                  {t("common.distillation.selectedTurns", {
                    count: item.turns,
                  })}
                </span>
              </span>
              {checked && <Check className="size-3.5 shrink-0 text-primary" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
