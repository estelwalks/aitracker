import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FolderOpen, Loader2, Search, X } from "lucide-react";

import { BrandIcon, brandColorOf } from "../../../../components/BrandIcon";
import { EmptyState, TTButton } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import type { SessionTranscriptMessage } from "../../../../modules/sessions/contracts";
import { getSessionTranscript } from "../../../../modules/sessions/query";
import type { SegmentRef } from "../../contracts";
import type { DistillationSessionItem } from "../index.ts";
import {
  groupDistillationSessionsByProject,
  materialKeyOf,
  type DistillationMaterialGranularity,
} from "./materials.ts";

const MAX_SELECTION = 8;
const MAX_SEGMENTS = 8;

type TranscriptState = {
  messages: SessionTranscriptMessage[];
  status: "loading" | "ready" | "error";
};

/**
 * Full-screen material library matching the prototype's workspace hierarchy.
 * The right pane is a per-message segment picker: the user clicks conversation
 * bubbles to set a start/end range (prototype 1552-1684), "select whole
 * session" for the full transcript, and clears the range to revert. Committed
 * ranges are lifted to the page as `SegmentRef`s and, on start, loaded into
 * memory server-side for the current AI request only.
 *
 * PRIVACY: the transcript is fetched through the server fn, which reads the
 * user's own local logs into memory for this page render. It is never
 * persisted and only reaches the selected model as part of the user's own
 * distillation run — surfaced in the disclosure note below.
 */
export function MaterialDrawer({
  sessions,
  selected,
  granularity,
  segments,
  onSegmentsChange,
  onToggle,
  onToggleProject,
  onClose,
}: {
  sessions: readonly DistillationSessionItem[];
  selected: ReadonlySet<string>;
  granularity: DistillationMaterialGranularity;
  segments: readonly SegmentRef[];
  onSegmentsChange: (next: SegmentRef[]) => void;
  onToggle: (item: DistillationSessionItem) => void;
  onToggleProject: (items: readonly DistillationSessionItem[]) => void;
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
  const active =
    sessions.find((item) => materialKeyOf(item) === activeKey) ??
    filtered[0] ??
    null;
  const byKey = useMemo(
    () => new Map(sessions.map((item) => [materialKeyOf(item), item])),
    [sessions],
  );

  // Per-session transcript cache + the active session's live transcript.
  const cacheRef = useRef(new Map<string, TranscriptState>());
  const [activeTranscript, setActiveTranscript] = useState<TranscriptState>({
    messages: [],
    status: "loading",
  });
  const activeKeyRef = useRef<string | null>(null);
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
      })
      .catch(() => {
        const next: TranscriptState = { messages: [], status: "error" };
        cacheRef.current.set(key, next);
        if (activeKeyRef.current === key) setActiveTranscript(next);
      });
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
    for (const [key, window] of Object.entries(next)) {
      const item = byKey.get(key);
      if (!item) continue;
      list.push({
        source: item.source,
        sessionId: item.sessionId,
        startIndex: window.s,
        endIndex: window.e,
      });
    }
    onSegmentsChange(list);
  }

  // Transient point-to-point picker state for the active session (TranscriptPanel
  // model): first click sets the anchor, second click sets the end and commits.
  const [anchor, setAnchor] = useState<number | null>(null);
  const [pickEnd, setPickEnd] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!activeKey) {
      setAnchor(null);
      setPickEnd(null);
      setHover(null);
      return;
    }
    const committed = ranges[activeKey];
    setAnchor(committed ? committed.s : null);
    setPickEnd(committed ? committed.e : null);
    setHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const liveRange = useMemo(() => {
    if (anchor === null) return null;
    const other = pickEnd ?? hover;
    if (other === null) return { s: anchor, e: anchor, live: false };
    return {
      s: Math.min(anchor, other),
      e: Math.max(anchor, other),
      live: pickEnd === null,
    };
  }, [anchor, pickEnd, hover]);
  function inLiveRange(index: number): boolean {
    return liveRange !== null && index >= liveRange.s && index <= liveRange.e;
  }

  function pick(index: number) {
    if (!active) return;
    if (anchor === null || pickEnd !== null) {
      setAnchor(index);
      setPickEnd(null);
      return;
    }
    const s = Math.min(anchor, index);
    const e = Math.max(anchor, index);
    const key = materialKeyOf(active);
    if (ranges[key] == null && segments.length >= MAX_SEGMENTS) {
      setAnchor(null);
      setPickEnd(null);
      return;
    }
    setPickEnd(index);
    updateRanges((current) => ({ ...current, [key]: { s, e } }));
  }

  function selectAll() {
    if (!active || activeTranscript.messages.length === 0) return;
    const e = activeTranscript.messages.length - 1;
    const key = materialKeyOf(active);
    if (ranges[key] == null && segments.length >= MAX_SEGMENTS) return;
    setAnchor(0);
    setPickEnd(e);
    updateRanges((current) => ({ ...current, [key]: { s: 0, e } }));
  }

  function clearRange() {
    setAnchor(null);
    setPickEnd(null);
    setHover(null);
    if (!active) return;
    const key = materialKeyOf(active);
    updateRanges((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  const totalMessages = segments.reduce(
    (sum, segment) => sum + (segment.endIndex - segment.startIndex + 1),
    0,
  );

  // The picker lists only text-bearing messages: thinking/reasoning-only
  // messages carry no distillable content and just flood the picker with
  // collapsed "思考" toggles. Original transcript indices are preserved so
  // SegmentRef ranges stay aligned with the server's message slice.
  const visibleMessages = activeTranscript.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.text.trim().length > 0);

  if (typeof document === "undefined") return null;

  const rightPane =
    active == null ? (
      <EmptyState
        icon={<FolderOpen className="size-6" />}
        title={t("common.distillation.noSessions")}
        desc={t("common.distillation.noSessionsDesc")}
      />
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2">
            <BrandIcon name={active.source} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold">
              {active.title}
            </h3>
            <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
              {active.source}:{active.sessionId}
            </p>
          </div>
          <TTButton
            variant={
              selected.has(materialKeyOf(active)) ? "default" : "primary"
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

        {activeTranscript.status === "ready" &&
        activeTranscript.messages.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-5 py-2.5">
            <span className="text-[11px] text-muted-foreground">
              {anchor === null
                ? t("distill.segment.startHint")
                : t("distill.segment.selectedRange", {
                    start: (liveRange?.s ?? anchor) + 1,
                    end: (liveRange?.e ?? anchor) + 1,
                    count:
                      (liveRange?.e ?? anchor) - (liveRange?.s ?? anchor) + 1,
                  })}
            </span>
            {visibleMessages.length < activeTranscript.messages.length && (
              <span className="font-mono text-[10px] text-muted-foreground/70">
                {t("distill.segment.hiddenThinking", {
                  count:
                    activeTranscript.messages.length - visibleMessages.length,
                })}
              </span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={selectAll}
              className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] transition-opacity hover:opacity-80"
            >
              {t("distill.segment.selectAll")}
            </button>
            {anchor !== null && (
              <button
                type="button"
                onClick={clearRange}
                className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] transition-opacity hover:opacity-80"
              >
                {t("distill.segment.clearRange")}
              </button>
            )}
          </div>
        ) : null}

        <div
          className="tt-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4"
          onMouseLeave={() => setHover(null)}
        >
          {activeTranscript.status === "loading" ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<Loader2 className="size-5 animate-spin" />}
                title={t("sessions.transcript.loading")}
              />
            </div>
          ) : activeTranscript.status === "error" ||
            activeTranscript.messages.length === 0 ? (
            <EmptyState
              title={t("distill.segment.noTranscript")}
              desc={t("distill.materialPrivacyNote")}
            />
          ) : visibleMessages.length === 0 ? (
            <EmptyState
              title={t("distill.segment.thinkingOnly")}
              desc={t("distill.materialPrivacyNote")}
            />
          ) : (
            <div className="space-y-3">
              {visibleMessages.map(({ message, index }) => {
                const inRange =
                  ranges[materialKeyOf(active)] !== undefined
                    ? index >= ranges[materialKeyOf(active)].s &&
                      index <= ranges[materialKeyOf(active)].e
                    : inLiveRange(index);
                return (
                  <SegmentBubble
                    key={index}
                    message={message}
                    index={index}
                    isStart={liveRange !== null && liveRange.s === index}
                    isEnd={
                      liveRange !== null &&
                      liveRange.e === index &&
                      liveRange.e !== liveRange.s
                    }
                    inRange={inRange}
                    preview={liveRange?.live === true}
                    confirmed={pickEnd !== null}
                    onPick={() => pick(index)}
                    onHover={() => setHover(index)}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border/60 px-5 py-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("distill.segment.privacyNote")}
          </p>
        </div>
      </div>
    );

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
              {t("distill.segment.startHint")}
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
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  aria-label={t("distill.materialSource")}
                  className="tt-select w-full"
                >
                  <option value="all" className="bg-card text-foreground">
                    {t("distill.materialSource")}
                  </option>
                  {sources.map((item) => (
                    <option
                      key={item}
                      value={item}
                      className="bg-card text-foreground"
                    >
                      {item}
                    </option>
                  ))}
                </select>
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value)}
                  aria-label={t("distill.materialTime")}
                  className="tt-select w-full"
                >
                  <option value="all" className="bg-card text-foreground">
                    {t("distill.materialTime")}
                  </option>
                  <option value="7" className="bg-card text-foreground">
                    {t("distill.range7")}
                  </option>
                  <option value="30" className="bg-card text-foreground">
                    {t("distill.range30")}
                  </option>
                </select>
                <select
                  value={proj}
                  onChange={(event) => setProj(event.target.value)}
                  aria-label={t("distill.materialProject")}
                  className="tt-select w-full"
                >
                  <option value="all" className="bg-card text-foreground">
                    {t("distill.materialProject")}
                  </option>
                  {projects.map((item) => (
                    <option
                      key={item}
                      value={item}
                      className="bg-card text-foreground"
                    >
                      {item}
                    </option>
                  ))}
                </select>
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
                          const key = materialKeyOf(item);
                          const checked = selected.has(key);
                          const disabled =
                            !checked && selected.size >= MAX_SELECTION;
                          const activeItem = activeKey === key;
                          const color = brandColorOf(item.source);
                          const window = ranges[key];
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
                                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                                    <span className="truncate">
                                      {item.projectKey}
                                    </span>
                                    <span>·</span>
                                    <span>
                                      {t("common.distillation.selectedTurns", {
                                        count: item.turns,
                                      })}
                                    </span>
                                    {window ? (
                                      <span className="rounded-full bg-primary/10 px-1.5 py-px text-[9.5px] text-primary">
                                        #{window.s + 1}→#{window.e + 1}
                                      </span>
                                    ) : checked ? (
                                      <span className="rounded-full bg-surface-2 px-1.5 py-px text-[9.5px] text-muted-foreground">
                                        {t("distill.segment.onlyMeta")}
                                      </span>
                                    ) : null}
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
                                    <Check
                                      className="size-2.5"
                                      strokeWidth={3}
                                    />
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="hidden min-h-0 flex-col md:flex">{rightPane}</div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 bg-surface-2/50 px-5 py-3">
          <span className="font-mono text-[11px] text-muted-foreground">
            {t("common.distillation.selected", { count: selected.size })} /{" "}
            {MAX_SELECTION}
          </span>
          {segments.length > 0 && (
            <span className="font-mono text-[11px] text-primary">
              {t("distill.segment.summary", {
                segments: segments.length,
                messages: totalMessages,
              })}
            </span>
          )}
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

/** Per-message bubble with point-to-point range marks (prototype 1612-1676). */
function SegmentBubble({
  message,
  index,
  isStart,
  isEnd,
  inRange,
  preview,
  confirmed,
  onPick,
  onHover,
}: {
  message: SessionTranscriptMessage;
  index: number;
  isStart: boolean;
  isEnd: boolean;
  inRange: boolean;
  preview: boolean;
  confirmed: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const { t } = useI18n();

  const mark = (
    <span
      className={`mt-2.5 w-8 shrink-0 text-center text-[10px] transition-opacity ${
        isStart
          ? "font-semibold text-primary"
          : isEnd
            ? "font-semibold text-primary/70"
            : "text-muted-foreground opacity-0 group-hover:opacity-100"
      }`}
    >
      {isStart
        ? t("distill.segment.start")
        : isEnd
          ? t("distill.segment.end")
          : `#${index + 1}`}
    </span>
  );
  const ring = isStart
    ? "ring-1 ring-primary"
    : inRange
      ? preview
        ? "ring-1 ring-primary/40"
        : "ring-1 ring-primary/70"
      : "";

  if (message.role === "user") {
    return (
      <div
        className="group flex cursor-pointer items-start justify-end gap-2"
        onClick={onPick}
        onMouseEnter={onHover}
      >
        <div
          className={`max-w-[80%] rounded-xl rounded-tr-sm border px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground transition-all ${
            inRange
              ? "border-primary bg-primary/20"
              : "border-primary bg-primary/12"
          } ${ring}`}
        >
          {message.text}
        </div>
        {mark}
      </div>
    );
  }

  return (
    <div
      className="group flex cursor-pointer items-start justify-start gap-2"
      onClick={onPick}
      onMouseEnter={onHover}
    >
      {mark}
      <div
        className={`max-w-[85%] rounded-xl rounded-tl-sm border bg-surface-2 px-3.5 py-2.5 transition-all ${
          inRange ? "border-primary" : "border-border"
        } ${ring}`}
      >
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">
          {message.text}
        </p>
      </div>
    </div>
  );
}
