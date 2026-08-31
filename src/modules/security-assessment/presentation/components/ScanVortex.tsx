import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bomb,
  Bot,
  Check,
  Clock,
  FolderClosed,
  Globe,
  Key,
  Loader2,
  Maximize2,
  Minimize2,
  ShieldCheck,
  ShieldX,
  Syringe,
  Terminal,
  Unlock,
  Upload,
  VenetianMask,
  X,
} from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import {
  clampPercent,
  hitDimensionsOf,
  securityHistoryEntryIsSafe,
  type SecurityHistoryView,
  type SecurityRiskKind,
  type SecurityScanStateView,
  type SecuritySkillView,
} from "../security-view";

const ICONS: Record<SecurityRiskKind, typeof Terminal> = {
  remote_execution: Terminal,
  command_injection: Syringe,
  data_exfiltration: Upload,
  secret_access: Key,
  persistence: Clock,
  destructive: Bomb,
  obfuscation: VenetianMask,
  privilege_escalation: Unlock,
  sensitive_file_access: FolderClosed,
  network_abuse: Globe,
  prompt_injection: Bot,
};

const DIMENSION_STEP = 190;
const FLY_DURATION_MS = 220;
const DIMENSION_DURATION_MS = 130;
const EXIT_DURATION_MS = 900;
const MIN_VISIBLE_DURATION_MS = 2000;
const MINIMIZED_STORAGE_KEY = "aitracker.security-scan.minimized";

function readMinimizedState(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(MINIMIZED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistMinimizedState(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(MINIMIZED_STORAGE_KEY, String(value));
  } catch {
    // Session storage can be unavailable in privacy-restricted contexts.
  }
}

/** Reference-design radar/track animation driven by real scanner state. */
export function ScanVortex({
  active,
  state,
  skills,
  history,
  riskKinds,
  onCancel,
}: {
  active: boolean;
  state: SecurityScanStateView;
  skills: readonly SecuritySkillView[];
  history: readonly SecurityHistoryView[];
  riskKinds: readonly SecurityRiskKind[];
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(active);
  const [exiting, setExiting] = useState(false);
  const [mini, setMiniState] = useState(readMinimizedState);
  const [dimension, setDimension] = useState(-1);
  const [sidebarInset, setSidebarInset] = useState(0);
  const visibleStartedAt = useRef(active ? Date.now() : 0);

  useEffect(() => {
    if (active) {
      if (!visible) visibleStartedAt.current = Date.now();
      setVisible(true);
      setExiting(false);
      return;
    }
    if (!visible) return;
    const remaining = Math.max(
      0,
      MIN_VISIBLE_DURATION_MS - (Date.now() - visibleStartedAt.current),
    );
    const exit = window.setTimeout(() => setExiting(true), remaining);
    const hide = window.setTimeout(() => {
      setVisible(false);
      setExiting(false);
    }, remaining + EXIT_DURATION_MS);
    return () => {
      window.clearTimeout(exit);
      window.clearTimeout(hide);
    };
  }, [active, visible]);

  const setMini = (value: boolean) => {
    setMiniState(value);
    persistMinimizedState(value);
  };

  useEffect(() => {
    const sidebar = document.querySelector<HTMLElement>(".aitracker-sidebar");
    if (!sidebar) return;
    const update = () =>
      setSidebarInset(Math.round(sidebar.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active || riskKinds.length === 0) return;
    setDimension(-1);
    let interval = 0;
    const fly = window.setTimeout(() => {
      setDimension(0);
      interval = window.setInterval(
        () =>
          setDimension((current) =>
            current + 1 >= riskKinds.length ? 0 : current + 1,
          ),
        DIMENSION_DURATION_MS,
      );
    }, FLY_DURATION_MS);
    return () => {
      window.clearTimeout(fly);
      window.clearInterval(interval);
    };
  }, [active, riskKinds.length, state.currentSkill]);

  const total = state.progress.queued || skills.length;
  const settled =
    state.progress.completed + state.progress.failed + state.progress.skipped;
  const currentIndex = Math.min(settled, Math.max(0, total - 1));
  const currentSkill =
    state.currentSkill ?? skills[currentIndex]?.name ?? skills[0]?.name;
  const progress = clampPercent(state.progress.percent);
  const currentDimension = dimension >= 0 ? riskKinds[dimension] : undefined;
  const riskEntries = useMemo(
    () =>
      history.filter(
        (entry) =>
          entry.scanId === state.scanId && !securityHistoryEntryIsSafe(entry),
      ),
    [history, state.scanId],
  );
  const ok = "var(--ok)";
  const danger = "var(--danger)";

  if (!visible) return null;

  if (mini && !exiting) {
    return (
      <div className="fixed right-6 bottom-14 z-50 flex items-center gap-3 rounded-full bg-card px-4 py-2.5 shadow-xl shadow-black/30 ring-1 ring-border/60">
        <span
          className="aitracker-breathe size-2 shrink-0 rounded-full"
          style={{ background: ok }}
        />
        <span className="text-[12.5px] font-medium">
          {t("security.center.vortex.scanning")}
        </span>
        <span className="aitracker-num font-mono text-[11px] text-muted-foreground">
          {Math.round(progress)}% · {settled}/{total}
        </span>
        <span className="h-1 w-24 overflow-hidden rounded-full bg-surface-2">
          <span
            className="block h-full rounded-full transition-[width] duration-300"
            style={{ width: `${Math.max(4, progress)}%`, background: ok }}
          />
        </span>
        <button
          type="button"
          onClick={() => setMini(false)}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
          title={t("security.center.vortex.expand")}
        >
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={state.status === "cancelling"}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          title={t("security.center.vortex.cancel")}
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  const current = Math.max(0, dimension);

  return (
    // Self-drawn title bar height 36px (z-60): radar overlay starts below the title bar to avoid shrinking
    // The window obscures the title bar's minimize/close and the radar's own minimize/cancel buttons.
    <div
      className="fixed top-9 right-0 bottom-0 z-50 flex flex-col overflow-hidden bg-background"
      style={{
        left: sidebarInset,
        animation: exiting
          ? "aitracker-vx-out .9s ease-in forwards"
          : "aitracker-vx-in .5s ease-out",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("security.center.vortex.title", {
        dimensions: riskKinds.length,
      })}
    >
      <div className="relative flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <span
            className="aitracker-breathe size-2 rounded-full"
            style={{ background: ok }}
          />
          <span className="text-[13px] font-semibold tracking-tight">
            {t("security.center.vortex.heading")}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            · {riskKinds.length} {t("security.center.vortex.dimensions")} ·{" "}
            {total} Skill
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMini(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-card px-3.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Minimize2 className="size-3.5" />
            {t("security.center.vortex.minimize")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={state.status === "cancelling" || exiting}
            className="inline-flex items-center gap-1.5 rounded-full bg-card px-3.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <X className="size-3.5" />
            {t("security.center.vortex.cancel")}
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center">
        <div className="relative flex h-[420px] w-full items-center justify-center">
          <div
            className="pointer-events-none absolute size-[324px]"
            style={{
              opacity: exiting ? 0 : 1,
              transition: "opacity .5s ease",
            }}
          >
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--ok) calc(5% * var(--scan-a)), transparent), transparent 70%)",
              }}
            />
            {[
              [100, 26],
              [68, 19],
              [38, 14],
            ].map(([size, opacity]) => (
              <span
                key={size}
                className="absolute rounded-full"
                style={{
                  width: `${size}%`,
                  height: `${size}%`,
                  left: `${(100 - size) / 2}%`,
                  top: `${(100 - size) / 2}%`,
                  boxShadow: `0 0 0 1px ${
                    opacity > 20 ? "var(--scan-line)" : "var(--scan-line-soft)"
                  }`,
                }}
              />
            ))}
            <span
              className="absolute top-1/2 left-0 h-px w-full"
              style={{ background: "var(--scan-line-soft)" }}
            />
            <span
              className="absolute top-0 left-1/2 h-full w-px"
              style={{ background: "var(--scan-line-soft)" }}
            />
            <div
              className="absolute inset-0 overflow-hidden rounded-full"
              style={{ animation: "aitracker-radar-spin 4.2s linear infinite" }}
            >
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    "conic-gradient(from 330deg, transparent 0deg, color-mix(in oklab, var(--ok) calc(6% * var(--scan-a)), transparent) 14deg, color-mix(in oklab, var(--ok) calc(12% * var(--scan-a)), transparent) 30deg, transparent 30.2deg)",
                  maskImage:
                    "radial-gradient(circle at 50% 50%, #000 0%, rgba(0,0,0,.8) 72%, transparent 98%)",
                }}
              />
              <span
                className="absolute top-1/2 left-1/2 h-px w-1/2 origin-left -rotate-90"
                style={{
                  background:
                    "linear-gradient(90deg, color-mix(in oklab, var(--ok) 85%, transparent), color-mix(in oklab, var(--ok) 45%, transparent) 70%, transparent)",
                  boxShadow:
                    "0 0 10px color-mix(in oklab, var(--ok) 35%, transparent)",
                }}
              />
            </div>
            {[
              [64, 34],
              [38, 62],
              [58, 58],
            ].map(([left, top], index) => (
              <span
                key={`${left}-${top}`}
                className="absolute size-[3px] rounded-full"
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  background: ok,
                  boxShadow: `0 0 6px ${ok}`,
                  opacity: 0,
                  animation: `aitracker-blip 4.2s linear ${(index * 1.3) % 4.2}s infinite`,
                }}
              />
            ))}
            {riskEntries.length > 0 && (
              <span
                key={riskEntries.length}
                className="absolute"
                style={{ left: "62%", top: "64%" }}
              >
                <span
                  className="absolute size-1.5 rounded-full"
                  style={{
                    background: danger,
                    boxShadow: `0 0 10px ${danger}`,
                    animation:
                      "aitracker-risk-fly 1.3s cubic-bezier(.5,0,.7,1) forwards",
                  }}
                />
                <span
                  className="absolute size-1.5 rounded-full"
                  style={{
                    border: `1px solid ${danger}`,
                    animation: "aitracker-risk-ping .9s ease-out forwards",
                  }}
                />
              </span>
            )}
          </div>

          <div className="absolute inset-0 overflow-hidden">
            <div
              className="pointer-events-none absolute inset-0 z-20"
              style={{
                background:
                  "linear-gradient(90deg, var(--background) 0%, transparent 26%, transparent 74%, var(--background) 100%)",
              }}
            />
            <div
              className="absolute top-1/2 left-1/2 flex items-center"
              style={{
                transform: `translate(${-(current * DIMENSION_STEP + DIMENSION_STEP / 2)}px, -50%)`,
                transition: "transform .28s cubic-bezier(.22,.8,.24,1)",
              }}
            >
              {riskKinds.map((kind, index) => {
                const selected = active && dimension === index;
                const passed = active && dimension > index;
                const distance = Math.abs(index - current);
                const base =
                  distance === 1
                    ? 0.48
                    : distance === 2
                      ? 0.42
                      : distance === 3
                        ? 0.16
                        : 0.06;
                const opacity = selected
                  ? 1
                  : passed
                    ? Math.max(base, 0.7 - distance * 0.07)
                    : base;
                const blur = selected
                  ? 0
                  : passed
                    ? Math.min(0.9, distance * 0.2)
                    : distance <= 2
                      ? distance * 0.35
                      : Math.min(2.4, distance * 0.8);
                const Icon = ICONS[kind];
                return (
                  <div
                    key={kind}
                    className="relative flex shrink-0 items-center justify-center"
                    style={{ width: DIMENSION_STEP }}
                  >
                    <div
                      className="relative flex justify-center"
                      style={{
                        opacity,
                        filter: blur ? `blur(${blur}px)` : undefined,
                        transform: selected ? "scale(1)" : "scale(.92)",
                        transition:
                          "opacity .4s ease, filter .4s ease, transform .4s ease",
                      }}
                    >
                      <span
                        className="relative grid place-items-center rounded-full"
                        style={{
                          width: selected ? 52 : 34,
                          height: selected ? 52 : 34,
                          border: `1px solid ${
                            selected
                              ? "color-mix(in oklab, var(--ok) 65%, transparent)"
                              : passed
                                ? "color-mix(in oklab, var(--ok) 35%, transparent)"
                                : "var(--border-strong)"
                          }`,
                          background: "var(--card)",
                          boxShadow: selected
                            ? "0 0 0 4px color-mix(in oklab, var(--ok) 7%, transparent), 0 0 26px color-mix(in oklab, var(--ok) 22%, transparent)"
                            : undefined,
                          transition:
                            "width .35s ease, height .35s ease, border-color .35s ease, box-shadow .35s ease",
                        }}
                      >
                        {selected && (
                          <span
                            className="pointer-events-none absolute inset-0 rounded-full"
                            style={{
                              border:
                                "1px solid color-mix(in oklab, var(--ok) 45%, transparent)",
                              animation:
                                "aitracker-ripple 1.8s ease-out infinite",
                            }}
                          />
                        )}
                        <Icon
                          style={{
                            width: selected ? 19 : 15,
                            height: selected ? 19 : 15,
                            color: selected
                              ? ok
                              : passed
                                ? "color-mix(in oklab, var(--ok) 70%, var(--muted-foreground))"
                                : "var(--muted-foreground)",
                          }}
                          strokeWidth={1.8}
                        />
                      </span>
                      <span
                        className="absolute top-full mt-2.5 flex items-center gap-1 whitespace-nowrap"
                        style={{
                          fontSize: selected ? 13 : 12,
                          color: selected
                            ? "var(--foreground)"
                            : "var(--muted-foreground)",
                          fontWeight: selected ? 600 : 400,
                        }}
                      >
                        {passed && (
                          <Check className="size-3" style={{ color: ok }} />
                        )}
                        {t(`security.center.risk.${kind}`)}
                      </span>
                    </div>
                    {index < riskKinds.length - 1 && (
                      <span
                        className="absolute top-1/2 h-px w-10 overflow-visible"
                        style={{
                          left: "calc(50% + 28px)",
                          background: passed
                            ? "color-mix(in oklab, var(--ok) 55%, transparent)"
                            : "var(--border-strong)",
                          opacity: distance > 3 ? 0.25 : 1,
                        }}
                      >
                        {active && dimension === index + 1 && (
                          <span
                            className="absolute top-1/2 left-0 size-[3px] -translate-y-1/2 rounded-full"
                            style={{
                              background: ok,
                              boxShadow: `0 0 6px ${ok}`,
                              animation:
                                "aitracker-signal .9s ease-in infinite",
                            }}
                          />
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="pointer-events-none absolute flex w-[360px] flex-col items-center"
            style={{ top: "calc(50% + 56px)" }}
          >
            <span
              className="flex h-4 items-center font-mono text-[11px]"
              style={{ color: ok }}
            >
              {!exiting && (
                <span key={`${currentDimension}-${currentSkill}`}>
                  {currentDimension
                    ? `${t(`security.center.risk.${currentDimension}`)} · ${
                        currentSkill ?? t("security.center.vortex.waiting")
                      }`
                    : t("security.center.vortex.waiting")}
                  <span className="aitracker-breathe">_</span>
                </span>
              )}
            </span>
          </div>

          <div
            className="pointer-events-none absolute flex items-center gap-2 font-mono text-[11px] text-muted-foreground"
            style={{ top: "calc(50% + 178px)" }}
          >
            <span className="aitracker-num text-[15px] leading-none font-semibold tracking-tight text-foreground">
              {Math.round(progress)}%
            </span>
            <span>
              · {settled} / {total}
            </span>
            {!exiting ? (
              <Loader2 className="size-3 animate-spin" style={{ color: ok }} />
            ) : (
              <span style={{ color: ok }}>
                {t("security.center.vortex.complete")}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="relative px-6 pt-3 pb-5">
        <div className="flex items-center justify-between text-[12px]">
          <span className="flex items-center gap-3 font-mono text-muted-foreground">
            <span>
              {t("security.center.vortex.progress", {
                completed: settled,
                total,
              })}
            </span>
            {currentDimension && !exiting && (
              <span style={{ color: ok }}>
                {t("security.center.vortex.currentDimension", {
                  name: t(`security.center.risk.${currentDimension}`),
                })}
              </span>
            )}
          </span>
          <span
            className="font-mono font-medium"
            style={{ color: riskEntries.length ? danger : ok }}
          >
            {t("security.center.vortex.risks", {
              count: riskEntries.length,
            })}
          </span>
        </div>

        <div className="mt-3 flex max-h-24 flex-wrap gap-2 overflow-auto">
          {riskEntries.length === 0 ? (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5" style={{ color: ok }} />
              {t("security.center.vortex.noRisks")}
            </span>
          ) : (
            riskEntries.map((entry) => (
              <span
                key={entry.id}
                className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px]"
                style={{
                  animation: "aitracker-result-pop .3s ease-out",
                  color: danger,
                }}
              >
                <ShieldX className="size-3.5" />
                {entry.skillName}
                <span className="text-muted-foreground">
                  {hitDimensionsOf(entry).slice(0, 2).join(" / ") ||
                    t("security.center.result.multipleAnomalies")}
                </span>
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
