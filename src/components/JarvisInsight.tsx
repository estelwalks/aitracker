import { RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Shared Jarvis insight card: a rounded hero with an orb, a typewriter
 * message, a dot carousel and a rotate control. Visually mirrors the V3.0
 * prototype. The shared page-level default is `variant="hero"`; the compact
 * `variant="inline"` remains available only for embedded surfaces. The
 * component stays i18n-free — callers pass fully localized `lines` and labels.
 *
 * `lines` are short, real-data-derived insights; the card types the active
 * one character-by-character and auto-rotates (hero: 9s, inline: 6s;
 * reduced-motion aware).
 *
 * Optional extensions keep every existing caller unchanged:
 * - `icon` swaps the orb glyph (defaults to Sparkles).
 * - `actions` renders into the right-hand action column (before the rotate
 *   button), mirroring the dashboard's `flex shrink-0 flex-col items-end`
 *   column. When omitted the rotate/refresh controls stay in the title row.
 * - `pills` renders extra chips in the title row (after the title), matching
 *   the homepage's `dashboard-hero-pill` status pills.
 */
const TYPE_INTERVAL_MS = 18;
const ROTATE_AFTER_MS = 6000;
const HERO_TYPE_INTERVAL_MS = 22;
const HERO_ROTATE_AFTER_MS = 9000;

export function JarvisInsight({
  title,
  lines,
  accent,
  onRefresh,
  refreshLabel,
  rotateLabel,
  dotsLabel,
  icon: Icon = Sparkles,
  actions,
  pills,
  variant = "hero",
}: {
  title?: string;
  lines: readonly string[];
  /** Optional orb/glow accent override (CSS color). */
  accent?: string;
  /** Optional data-refresh action; renders a second button when provided. */
  onRefresh?: () => void;
  refreshLabel?: string;
  /** Localized label for the rotate-to-next-insight button. */
  rotateLabel?: string;
  /** Localized accessible label for the dot rail. */
  dotsLabel?: string;
  /** Orb icon override; defaults to Sparkles. */
  icon?: LucideIcon;
  /** Right-hand action column content, rendered before the rotate button. */
  actions?: ReactNode;
  /** Extra chips rendered in the title row, after the title. */
  pills?: ReactNode;
  /** hero = the shared page-level prototype card; inline = compact embedding. */
  variant?: "hero" | "inline";
}) {
  const hero = variant === "hero";
  const safeLines = useMemo(
    () => lines.filter((line) => line.length > 0),
    [lines],
  );
  const [index, setIndex] = useState(0);
  const activeIndex = safeLines.length ? index % safeLines.length : 0;
  const line = safeLines[activeIndex] ?? "";
  const [typed, setTyped] = useState("");

  useEffect(() => setIndex(0), [safeLines]);

  useEffect(() => {
    if (safeLines.length === 0) {
      setTyped("");
      return;
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setTyped(line);
      return;
    }
    setTyped("");
    let cursor = 0;
    const typer = window.setInterval(
      () => {
        cursor += 1;
        setTyped(line.slice(0, cursor));
        if (cursor >= line.length) window.clearInterval(typer);
      },
      hero ? HERO_TYPE_INTERVAL_MS : TYPE_INTERVAL_MS,
    );
    const rotate = window.setTimeout(
      () => {
        setIndex((current) =>
          safeLines.length ? (current + 1) % safeLines.length : 0,
        );
      },
      hero ? HERO_ROTATE_AFTER_MS : ROTATE_AFTER_MS,
    );
    return () => {
      window.clearInterval(typer);
      window.clearTimeout(rotate);
    };
  }, [hero, line, safeLines.length]);

  if (safeLines.length === 0) return null;

  const orbStyle = accent
    ? {
        color: accent,
        background: `color-mix(in oklab, ${accent} 14%, var(--color-surface))`,
        boxShadow: `0 0 28px ${accent}40`,
      }
    : undefined;

  const rotateNext = () =>
    setIndex((current) =>
      safeLines.length ? (current + 1) % safeLines.length : 0,
    );

  const refreshButton = onRefresh ? (
    <button
      type="button"
      onClick={onRefresh}
      className="dashboard-hero-refresh"
    >
      <RefreshCw className="size-3" strokeWidth={2} />
      {refreshLabel}
    </button>
  ) : null;

  const rotateButton = (
    <button
      type="button"
      onClick={rotateNext}
      disabled={safeLines.length < 2}
      className="dashboard-hero-refresh"
    >
      <RefreshCw className="size-3" strokeWidth={2} />
      {rotateLabel}
    </button>
  );

  return (
    <section
      className={`dashboard-insight-hero${hero ? "" : " dashboard-insight-inline"}`}
      aria-label={title}
    >
      <div className={`relative flex min-w-0 ${hero ? "gap-4" : "gap-3"}`}>
        <span className="relative mt-0.5 shrink-0">
          <span
            className={`dashboard-insight-logo-shell tt-breathe relative flex shrink-0 ${
              hero ? "size-10" : "size-8"
            }`}
          >
            <span className="dashboard-insight-logo-halo absolute inset-0 rounded-full" />
            <span
              className="dashboard-insight-logo relative flex size-full items-center justify-center rounded-full bg-surface-2"
              style={orbStyle}
            >
              <Icon
                className={hero ? "size-5" : "size-4"}
                style={hero ? { color: "var(--color-ok)" } : undefined}
                strokeWidth={1.7}
              />
            </span>
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {title ? (
              <h1
                className={`${hero ? "text-[15px]" : "text-[13px]"} font-semibold tracking-tight`}
              >
                {title}
              </h1>
            ) : null}
            {pills}
            {actions == null ? (
              <div className="ml-auto flex items-center gap-2">
                {refreshButton}
                {rotateButton}
              </div>
            ) : null}
          </div>
          <p
            className={
              hero
                ? "mt-2 min-h-[62px] text-[17px] leading-[1.65] font-medium tracking-tight text-foreground/90 md:text-[19px]"
                : "mt-2 min-h-[42px] text-[14px] leading-relaxed text-foreground/90"
            }
            aria-label={line}
          >
            {typed}
            <span
              className={`ml-1 inline-block bg-foreground/60 ${
                hero
                  ? "h-[17px] w-[8px] translate-y-[3px]"
                  : "h-[15px] w-[7px] translate-y-[2px]"
              }`}
            />
          </p>
          <div
            className={`flex gap-1.5 ${hero ? "mt-3.5" : "mt-3"}`}
            role="tablist"
            aria-label={dotsLabel}
          >
            {safeLines.map((item, itemIndex) => (
              <button
                key={`${itemIndex}-${item}`}
                type="button"
                role="tab"
                aria-selected={itemIndex === activeIndex}
                aria-label={`${itemIndex + 1}`}
                onClick={() => setIndex(itemIndex)}
                className={
                  itemIndex === activeIndex
                    ? "dashboard-insight-dot dashboard-insight-dot-active"
                    : "dashboard-insight-dot"
                }
              />
            ))}
          </div>
        </div>
        {actions != null ? (
          <div className="flex shrink-0 flex-col items-end gap-2">
            {actions}
            {refreshButton}
            {rotateButton}
          </div>
        ) : null}
      </div>
    </section>
  );
}
