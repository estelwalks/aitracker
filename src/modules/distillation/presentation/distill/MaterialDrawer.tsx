import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  FolderOpen,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { BrandIcon, brandColorOf } from "../../../../components/BrandIcon";
import { EmptyState } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import type { SessionTranscriptMessage } from "../../../../modules/sessions/contracts";
import { getSessionTranscript } from "../../../../modules/sessions/query";
import type { SegmentRef } from "../../contracts";
import type { DistillationSessionItem } from "../index.ts";
import {
  groupDistillationSessionsByProject,
  materialKeyOf,
  EST_TOKENS_PER_TURN,
  type DistillationMaterialGranularity,
} from "./materials.ts";

type TranscriptState = {
  messages: SessionTranscriptMessage[];
  status: "loading" | "ready" | "error";
};

/**
 * Full-screen material library matching the prototype's workspace hierarchy
 * (prototype distill.tsx 1401-1741).
 *
 * The left column lists sessions (filter/search + per-session join pill); the
 * right pane is a per-message range picker: clicking a bubble sets start/end
 * in turn (prototype pickAt), hover buttons pin the exact start/end, and the
 * footer "select whole session" commits the full transcript. Committed ranges
 * are lifted to the page as `SegmentRef`s and, on start, loaded into memory
 * server-side for the current AI request only.
 *
 * PRIVACY: the transcript is fetched through the server fn, which reads the
 * user's own local logs into memory for this page render. It is never
 * persisted and only reaches the selected model as part of the user's own
 * distillation run.
 */
export function MaterialDrawer({
  sessions,
  segments,
  onSegmentsChange,
  onClose,
}: {
  sessions: readonly DistillationSessionItem[];
  segments: readonly SegmentRef[];
  onSegmentsChange: (next: SegmentRef[]) => void;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [range, setRange] = useState("all");
  const [proj, setProj] = useState("all");
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

  const sources = useMemo(
    () => [...new Set(sessions.map((item) => item.source))].sort(),
    [sessions],
  );
  const projects = useMemo(
    () => [...new Set(sessions.map((item) => item.projectKey))].sort(),
    [sessions],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const limitDays = range === "all" ? Infinity : Number(range);
    const cutoff =
      limitDays === Infinity ? -Infinity : Date.now() - limitDays * 86400000;
    return sessions.filter((item) => {
      if (source !== "all" && item.source !== source) return false;
      if (proj !== "all" && item.projectKey !== proj) return false;
      if (
        limitDays !== Infinity &&
        new Date(item.startedAt).getTime() < cutoff
      ) {
        return false;
      }
      if (!needle) return true;
      return (
        item.title.toLocaleLowerCase().includes(needle) ||
        item.source.toLocaleLowerCase().includes(needle) ||
        item.projectKey.toLocaleLowerCase().includes(needle)
      );
    });
  }, [sessions, query, source, range, proj]);
  // 按日期分组（原型 1480-1484：sticky 日期头），按数值排序保证各语言正确。
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      { label: string; items: DistillationSessionItem[] }
    >();
    for (const item of filtered) {
      const date = new Date(item.startedAt);
      // 零填充保证字典序 = 时间序（"2026-08-19" > "2026-08-09"）。
      const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const entry = map.get(dayKey) ?? {
        label: format.formatDate(item.startedAt),
        items: [],
      };
      entry.items.push(item);
      map.set(dayKey, entry);
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([, entry]) => entry);
  }, [filtered, format]);
  const byKey = useMemo(
    () => new Map(sessions.map((item) => [materialKeyOf(item), item])),
    [sessions],
  );
  const active = activeKey ? (byKey.get(activeKey) ?? null) : null;

  // Per-session transcript cache + the active session's live transcript.
  const cacheRef = useRef(new Map<string, TranscriptState>());
  const [activeTranscript, setActiveTranscript] = useState<TranscriptState>({
    messages: [],
    status: "loading",
  });
  const activeKeyRef = useRef<string | null>(null);
  // When the user clicks the left-column "add whole session" pill on a session
  // whose transcript is not loaded yet, remember it here; the load effect below
  // commits the full range as soon as the transcript arrives.
  const pendingFullRef = useRef<string | null>(null);
  useEffect(() => {
    const key = activeKey;
    if (!key) {
      activeKeyRef.current = null;
      return;
    }
    const item = byKey.get(key);
    if (!item) {
      activeKeyRef.current = null;
      return;
    }
    activeKeyRef.current = key;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setActiveTranscript(cached);
      return;
    }
    const entry: TranscriptState = { messages: [], status: "loading" };
    cacheRef.current.set(key, entry);
    setActiveTranscript(entry);
    getSessionTranscript({
      data: { source: item.source, sessionId: item.sessionId },
    })
      .then((result) => {
        const next: TranscriptState = {
          messages: [...result.messages],
          status: "ready",
        };
        cacheRef.current.set(key, next);
        if (activeKeyRef.current === key) setActiveTranscript(next);
        if (pendingFullRef.current === key) {
          pendingFullRef.current = null;
          if (next.messages.length > 0) {
            commitRange(key, 0, next.messages.length - 1);
          }
        }
      })
      .catch(() => {
        const next: TranscriptState = { messages: [], status: "error" };
        cacheRef.current.set(key, next);
        if (activeKeyRef.current === key) setActiveTranscript(next);
        if (pendingFullRef.current === key) pendingFullRef.current = null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, byKey]);

  // Committed per-session ranges, seeded from the page's carried-over segments
  // so a `?segment=` window survives into the drawer. Every commit lifts the
  // full list back to the page as SegmentRefs (the page stays authoritative).
  const [ranges, setRanges] = useState<
    Record<string, { s: number; e: number }>
  >(() => {
    const init: Record<string, { s: number; e: number }> = {};
    for (const segment of segments) {
      init[`${segment.source}:${segment.sessionId}`] = {
        s: segment.startIndex,
        e: segment.endIndex,
      };
    }
    return init;
  });
  function updateRanges(
    mutate: (
      current: Record<string, { s: number; e: number }>,
    ) => Record<string, { s: number; e: number }>,
  ) {
    // Compute the next ranges snapshot up-front, then notify the parent. Calling
    // `onSegmentsChange` (a parent setState) inside the `setRanges` updater
    // would run during the render phase and trigger React's
    // "Cannot update a component while rendering a different component" error.
    const next = mutate(ranges);
    setRanges(next);
    const list: SegmentRef[] = [];
    for (const [key, win] of Object.entries(next)) {
      const item = byKey.get(key);
      if (!item) continue;
      list.push({
        source: item.source,
        sessionId: item.sessionId,
        startIndex: win.s,
        endIndex: win.e,
      });
    }
    onSegmentsChange(list);
  }
  function commitRange(key: string, s: number, e: number) {
    updateRanges((current) => ({ ...current, [key]: { s, e } }));
  }

  // ── Range model: prototype pickAt / setStart / setEnd / clearChat ──────
  function inRange(key: string, index: number): boolean {
    const r = ranges[key];
    return !!r && index >= r.s && index <= r.e;
  }
  function pickAt(key: string, index: number) {
    updateRanges((current) => {
      const r = current[key];
      if (!r) return { ...current, [key]: { s: index, e: index } };
      if (r.s === r.e && r.s === index) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      if (index < r.s) return { ...current, [key]: { s: index, e: r.e } };
      return { ...current, [key]: { s: r.s, e: index } };
    });
  }
  function setStart(key: string, index: number) {
    updateRanges((current) => {
      const r = current[key];
      return {
        ...current,
        [key]: { s: index, e: r ? Math.max(r.e, index) : index },
      };
    });
  }
  function setEnd(key: string, index: number) {
    updateRanges((current) => {
      const r = current[key];
      return {
        ...current,
        [key]: { s: r ? Math.min(r.s, index) : index, e: index },
      };
    });
  }
  function clearChat(key: string) {
    updateRanges((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  function clearAllRanges() {
    updateRanges(() => ({}));
  }
  // "Select whole session": commit the full transcript once known (lazy load).
  function selectAllOf(key: string) {
    const cached = cacheRef.current.get(key);
    if (cached && cached.status === "ready" && cached.messages.length > 0) {
      commitRange(key, 0, cached.messages.length - 1);
      return;
    }
    pendingFullRef.current = key;
    setActiveKey(key);
  }
  function pillClick(item: DistillationSessionItem) {
    const key = materialKeyOf(item);
    if (ranges[key]) {
      clearChat(key);
      return;
    }
    selectAllOf(key);
  }

  const key = activeKey;
  const rangeWindow = key ? ranges[key] : undefined;
  const allOn =
    key !== null &&
    rangeWindow !== undefined &&
    activeTranscript.status === "ready" &&
    activeTranscript.messages.length > 0 &&
    rangeWindow.s === 0 &&
    rangeWindow.e === activeTranscript.messages.length - 1;
  const pickedSegs = Object.values(ranges).reduce(
    (sum, r) => sum + (r.e - r.s + 1),
    0,
  );
  const pickedTokens = [...Object.keys(ranges)].reduce((sum, k) => {
    const item = byKey.get(k);
    return item ? sum + item.turns * EST_TOKENS_PER_TURN : sum;
  }, 0);

  if (typeof document === "undefined") return null;

  const rightPane =
    active == null ? (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-surface-2">
          <FolderOpen
            className="size-6 text-muted-foreground"
            strokeWidth={1.5}
          />
        </span>
        <p className="max-w-[280px] text-[13px] leading-6 text-muted-foreground">
          {t("distill.segment.pickPrompt")}
        </p>
      </div>
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full"
            style={{
              background: `color-mix(in oklab, ${brandColorOf(active.source)} 18%, transparent)`,
              color: brandColorOf(active.source),
            }}
          >
            <BrandIcon name={active.source} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[14px] font-semibold tracking-tight">
              {active.title}
            </h3>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {active.source} · {active.projectKey} ·{" "}
              {t("distill.segment.totalMessages", {
                count: activeTranscript.messages.length,
              })}
              {rangeWindow
                ? ` · ${t("distill.segment.selectedRange", {
                    start: rangeWindow.s + 1,
                    end: rangeWindow.e + 1,
                    count: rangeWindow.e - rangeWindow.s + 1,
                  })}`
                : ""}
            </p>
          </div>
          {rangeWindow && (
            <button
              type="button"
              onClick={() => clearChat(materialKeyOf(active))}
              className="rounded-full bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("distill.segment.clearRange")}
            </button>
          )}
          <button
            type="button"
            onClick={() => selectAllOf(materialKeyOf(active))}
            className="rounded-full px-3 py-1.5 font-mono text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: brandColorOf(active.source) }}
          >
            {allOn
              ? t("distill.segment.cancelAll")
              : t("distill.segment.selectAll")}
          </button>
        </div>
        {activeTranscript.status === "ready" &&
        activeTranscript.messages.length > 0 ? (
          <div className="px-5 pb-1 pt-2">
            <p className="font-mono text-[10.5px] leading-5 text-muted-foreground">
              {t("distill.segment.startHint")}
            </p>
            <p className="mt-0.5 font-mono text-[10.5px] leading-5 text-muted-foreground">
              {t("distill.segment.crossHint")}
              {Object.keys(ranges).length > 1 &&
                t("distill.segment.crossCount", {
                  count: Object.keys(ranges).length,
                })}
            </p>
          </div>
        ) : null}

        <div className="tt-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {activeTranscript.status === "loading" ? (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : activeTranscript.status === "error" ||
            activeTranscript.messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-mono text-[11px] text-muted-foreground">
                {t("distill.segment.noTranscript")}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {activeTranscript.messages.map((message, index) => (
                <SegmentBubble
                  key={index}
                  text={message.text.trim() || message.thinking?.trim() || ""}
                  index={index}
                  mine={message.role === "user"}
                  source={active.source}
                  isStart={rangeWindow?.s === index}
                  isEnd={rangeWindow?.e === index}
                  inRange={key !== null && inRange(key, index)}
                  bc={brandColorOf(active.source)}
                  onPick={() => key !== null && pickAt(key, index)}
                  onStart={() => key !== null && setStart(key, index)}
                  onEnd={() => key !== null && setEnd(key, index)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={t("distill.drawerTitle")}
    >
      <button
        type="button"
        aria-label={t("common.close")}
        className="absolute inset-0 animate-fade-in backdrop-blur-md"
        style={{ background: "oklch(0 0 0 / 0.68)" }}
        onClick={onClose}
      />
      <section
        className="relative flex h-[86vh] w-full max-w-[1180px] animate-scale-in flex-col overflow-hidden rounded-3xl bg-card"
        style={{
          boxShadow:
            "0 40px 120px -30px rgba(0,0,0,.8), inset 0 0 0 1px color-mix(in oklab, var(--foreground) 8%, transparent)",
        }}
      >
        <header className="relative flex items-center gap-3 overflow-hidden px-5 py-4">
          <div
            className="pointer-events-none absolute -top-24 left-10 size-56 rounded-full opacity-[0.16] blur-3xl"
            style={{ background: "var(--chart-1)" }}
          />
          <span
            className="relative flex size-9 items-center justify-center rounded-full"
            style={{
              background:
                "color-mix(in oklab, var(--chart-1) 18%, transparent)",
              color: "var(--chart-1)",
            }}
          >
            <FolderOpen className="size-4.5" strokeWidth={1.8} />
          </span>
          <div className="relative min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight">
              {t("distill.drawerTitle")}
            </h2>
            <p className="text-[12.5px] text-muted-foreground">
              {t("distill.drawerSub")}
            </p>
          </div>
          <span className="relative hidden rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground sm:inline">
            {t("distill.drawerEsc")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="relative grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r border-border/60">
            <div className="space-y-2 px-4 py-3">
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
              <div className="grid grid-cols-3 gap-1.5">
                <FilterSelect
                  label={t("distill.materialSource")}
                  value={source}
                  onChange={setSource}
                  options={[
                    ["all", t("distill.materialSource")],
                    ...sources.map((item) => [item, item] as const),
                  ]}
                />
                <FilterSelect
                  label={t("distill.materialTime")}
                  value={range}
                  onChange={setRange}
                  options={[
                    ["all", t("distill.materialTime")],
                    ["7", t("distill.range7")],
                    ["30", t("distill.range30")],
                  ]}
                />
                <FilterSelect
                  label={t("distill.materialProject")}
                  value={proj}
                  onChange={setProj}
                  options={[
                    ["all", t("distill.materialProject")],
                    ...projects.map((item) => [item, item] as const),
                  ]}
                />
              </div>
            </div>
            <div className="tt-scroll min-h-0 flex-1 overflow-y-auto pb-2">
              {filtered.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <Search
                    className="mx-auto size-5 text-muted-foreground"
                    strokeWidth={1.6}
                  />
                  <p className="mt-3 text-[12.5px] text-muted-foreground">
                    {t("common.distillation.noSessions")}
                  </p>
                  <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                    {t("common.distillation.noSessionsDesc")}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setSource("all");
                      setRange("all");
                      setProj("all");
                    }}
                    className="mt-3 rounded-full bg-surface-2 px-3 py-1.5 font-mono text-[11px] transition-colors hover:text-foreground"
                  >
                    {t("distill.materialFilterReset")}
                  </button>
                </div>
              ) : (
                <div>
                  {grouped.map((group) => (
                    <div key={group.label}>
                      <div className="sticky top-0 z-1 bg-card/95 px-4 py-1.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase backdrop-blur">
                        {group.label}
                      </div>
                      <ul className="space-y-1 px-2 pb-1.5">
                        {group.items.map((item) => {
                          const itemKey = materialKeyOf(item);
                          const activeItem = activeKey === itemKey;
                          const color = brandColorOf(item.source);
                          const pillWindow = ranges[itemKey];
                          const on = pillWindow
                            ? pillWindow.e - pillWindow.s + 1
                            : 0;
                          const total =
                            cacheRef.current.get(itemKey)?.messages.length;
                          return (
                            <li key={itemKey} className="group/it relative">
                              <button
                                type="button"
                                onClick={() => setActiveKey(itemKey)}
                                aria-pressed={activeItem}
                                className={`flex w-full items-start gap-2.5 rounded-xl py-2.5 pr-[104px] pl-3 text-left transition-colors ${
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
                                  className="mt-1 size-3.5 shrink-0"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] leading-6">
                                    {item.title}
                                  </span>
                                  <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                                    {t("distill.durationMin", {
                                      min: durationMinOf(item),
                                    })}{" "}
                                    ·{" "}
                                    {t("common.distillation.selectedTurns", {
                                      count: item.turns,
                                    })}{" "}
                                    · {item.projectKey}
                                  </span>
                                </span>
                              </button>
                              <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => pillClick(item)}
                                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-mono text-[10.5px] font-semibold transition-colors"
                                  style={
                                    on > 0
                                      ? { background: color, color: "#fff" }
                                      : {
                                          background: "var(--color-surface-2)",
                                          color:
                                            "var(--color-muted-foreground)",
                                          boxShadow:
                                            "inset 0 0 0 1px var(--color-border)",
                                        }
                                  }
                                >
                                  <span
                                    className="grid size-3.5 place-items-center rounded-[4px]"
                                    style={
                                      on > 0
                                        ? {
                                            background:
                                              "color-mix(in oklab, #fff 22%, transparent)",
                                          }
                                        : {
                                            boxShadow:
                                              "inset 0 0 0 1px var(--color-border)",
                                          }
                                    }
                                  >
                                    {on > 0 && (
                                      <Check
                                        className="size-2.5"
                                        strokeWidth={3}
                                      />
                                    )}
                                  </span>
                                  {on > 0
                                    ? total
                                      ? `${on}/${total}`
                                      : t("distill.chipCount", { count: on })
                                    : t("distill.joinWhole")}
                                </button>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="hidden min-h-0 flex-col md:flex">{rightPane}</div>
        </div>

        <footer className="flex flex-col gap-2 bg-surface-2/50 px-5 py-3">
          {Object.keys(ranges).length > 0 && (
            <div className="tt-scroll flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
              {Object.entries(ranges).map(([cid, r]) => {
                const item = byKey.get(cid);
                if (!item) return null;
                const color = brandColorOf(item.source);
                return (
                  <button
                    key={cid}
                    type="button"
                    onClick={() => clearChat(cid)}
                    className="group inline-flex max-w-[260px] items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] transition-opacity hover:opacity-80"
                    style={{
                      background: `color-mix(in oklab, ${color} 16%, transparent)`,
                      color,
                    }}
                  >
                    <span className="truncate">{item.title.slice(0, 16)}</span>
                    <span className="shrink-0 opacity-80">
                      #{r.s + 1}→#{r.e + 1}
                    </span>
                    <X className="size-3 shrink-0 opacity-60 group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
            <span>
              {t("distill.footerSelected")}{" "}
              <b style={{ color: "var(--chart-1)" }}>
                {Object.keys(ranges).length}
              </b>{" "}
              {t("distill.footerSessions")} ·{" "}
              <b style={{ color: "var(--chart-1)" }}>{pickedSegs}</b>{" "}
              {t("distill.footerSegments")} · ~
              {format.formatTokens(pickedTokens)}
            </span>
            <button
              type="button"
              onClick={clearAllRanges}
              disabled={Object.keys(ranges).length === 0}
              className="ml-auto inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Trash2 className="size-3.5" /> {t("distill.footerClear")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-surface-2 px-4 py-1.5 transition-colors hover:bg-foreground/10"
            >
              {t("distill.footerCancel")}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pickedSegs === 0}
              className="rounded-full px-4 py-1.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{
                background: "var(--chart-1)",
                boxShadow: "0 10px 24px -14px var(--chart-1)",
              }}
            >
              {t("distill.footerConfirm")}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/** Prototype Select (distill.tsx 1436-1450): mono select + chevron. */
function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  label: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="w-full appearance-none rounded-lg bg-surface-2 py-1.5 pr-6 pl-2.5 font-mono text-[11px] text-foreground outline-none"
      >
        {options.map(([val, text]) => (
          <option key={val} value={val} className="bg-card text-foreground">
            {text}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function durationMinOf(item: DistillationSessionItem): number {
  const start = new Date(item.startedAt).getTime();
  const end = new Date(item.endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
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
      <ul className="tt-scroll max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
        {groupDistillationSessionsByProject(sessions).map((project) => {
          const keys = project.sessions.map(materialKeyOf);
          const selectedCount = keys.filter((key) => selected.has(key)).length;
          const checked = selectedCount === keys.length;
          const turns = project.sessions.reduce(
            (sum, item) => sum + item.turns,
            0,
          );
          const tokens = turns * EST_TOKENS_PER_TURN;
          return (
            <li key={project.key}>
              <button
                type="button"
                onClick={() => onToggleProject(project.sessions)}
                aria-pressed={checked}
                className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left transition-colors"
                style={
                  checked
                    ? {
                        background:
                          "color-mix(in oklab, var(--chart-1) 9%, transparent)",
                        boxShadow:
                          "inset 0 0 0 1px color-mix(in oklab, var(--chart-1) 42%, transparent)",
                      }
                    : {
                        background: "var(--color-surface)",
                        boxShadow: "inset 0 0 0 1px var(--color-border)",
                      }
                }
              >
                {/* 原型行头：最多 3 个来源 BrandIcon 叠放 */}
                <span className="flex -space-x-1">
                  {project.sources.slice(0, 3).map((source) => (
                    <BrandIcon
                      key={source}
                      name={source}
                      className="size-4 shrink-0"
                    />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]">
                    {project.projectKey}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                    {t("distill.projectSessions", {
                      count: project.sessions.length,
                    })}{" "}
                    · ~{format.formatTokens(tokens)} ·{" "}
                    {format.formatDateTime(project.last, false)}
                  </span>
                </span>
                {checked && (
                  <Check
                    className="size-3.5 shrink-0"
                    style={{ color: "var(--chart-1)" }}
                  />
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
      className={`tt-scroll ${compact ? "max-h-[260px] overflow-y-auto pr-1" : ""} space-y-1.5`}
    >
      {sessions.map((item) => {
        const itemKey = materialKeyOf(item);
        const checked = selected.has(itemKey);
        const tokens = item.turns * EST_TOKENS_PER_TURN;
        return (
          <li key={itemKey}>
            <button
              type="button"
              onClick={() => onToggle(item)}
              aria-pressed={checked}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left transition-colors"
              style={
                checked
                  ? {
                      background:
                        "color-mix(in oklab, var(--chart-1) 9%, transparent)",
                      boxShadow:
                        "inset 0 0 0 1px color-mix(in oklab, var(--chart-1) 42%, transparent)",
                    }
                  : {
                      background: "var(--color-surface)",
                      boxShadow: "inset 0 0 0 1px var(--color-border)",
                    }
              }
            >
              <BrandIcon name={item.source} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px]">
                  {item.title}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                  {item.projectKey} ·{" "}
                  {format.formatDateTime(item.startedAt, false)} · ~
                  {format.formatTokens(tokens)}
                </span>
              </span>
              {checked && (
                <Check
                  className="size-3.5 shrink-0"
                  style={{ color: "var(--chart-1)" }}
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Per-message bubble with start/end marks and hover pin buttons
 *  (prototype 1612-1676). */
function SegmentBubble({
  text,
  index,
  mine,
  source,
  isStart,
  isEnd,
  inRange,
  bc,
  onPick,
  onStart,
  onEnd,
}: {
  text: string;
  index: number;
  mine: boolean;
  source: string;
  isStart: boolean;
  isEnd: boolean;
  inRange: boolean;
  bc: string;
  onPick: () => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const { t } = useI18n();
  return (
    <li className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex max-w-[78%] min-w-0 flex-col ${mine ? "items-end" : "items-start"}`}
      >
        <div className="flex items-center gap-1.5 px-1 pb-1 font-mono text-[10px] text-muted-foreground">
          <span>#{index + 1}</span>
          <span>{mine ? t("distill.segment.me") : source}</span>
          {isStart && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold text-white"
              style={{ background: bc }}
            >
              {t("distill.segment.markStart")}
            </span>
          )}
          {isEnd && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold text-white"
              style={{ background: bc }}
            >
              {t("distill.segment.markEnd")}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onPick}
          className={`relative w-full rounded-2xl px-3.5 py-2.5 text-left text-[13px] leading-6 transition-colors ${
            mine ? "rounded-tr-sm" : "rounded-tl-sm"
          } ${inRange ? "" : "bg-surface-2/70 hover:bg-surface-2"}`}
          style={
            inRange
              ? {
                  background: `color-mix(in oklab, ${bc} 14%, transparent)`,
                  boxShadow: `inset 0 0 0 1px ${bc}`,
                }
              : undefined
          }
        >
          <span className="flex items-start gap-2.5">
            <span
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full"
              style={
                inRange
                  ? { background: bc, color: "#fff" }
                  : { boxShadow: "inset 0 0 0 1px var(--color-border)" }
              }
            >
              {inRange && <Check className="size-2.5" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{text}</span>
          </span>
        </button>
        <div
          className={`mt-1 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 ${
            mine ? "flex-row-reverse" : ""
          }`}
        >
          <button
            type="button"
            onClick={onStart}
            className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("distill.segment.start")}
          </button>
          <button
            type="button"
            onClick={onEnd}
            className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("distill.segment.end")}
          </button>
        </div>
      </div>
    </li>
  );
}
