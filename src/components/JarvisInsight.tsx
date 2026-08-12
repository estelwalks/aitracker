import { RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/**
 * Shared Jarvis insight card: a big rounded hero with an orb, a typewriter
 * message, a dot carousel and a rotate control. Visually mirrors the V3.0
 * prototype and the dashboard's `DashboardJarvisInsight` (same CSS classes),
 * but stays i18n-free — callers pass fully localized `lines` and labels.
 *
 * `lines` are short, real-data-derived insights; the card types the active
 * one character-by-character and auto-rotates every 6s (reduced-motion aware).
 */
const TYPE_INTERVAL_MS = 18;
const ROTATE_AFTER_MS = 6000;

export function JarvisInsight({
  title,
  lines,
  accent,
  onRefresh,
  refreshLabel,
  rotateLabel,
  dotsLabel,
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
}) {
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
    const typer = window.setInterval(() => {
      cursor += 1;
      setTyped(line.slice(0, cursor));
      if (cursor >= line.length) window.clearInterval(typer);
    }, TYPE_INTERVAL_MS);
    const rotate = window.setTimeout(() => {
      setIndex((current) =>
        safeLines.length ? (current + 1) % safeLines.length : 0,
      );
    }, ROTATE_AFTER_MS);
    return () => {
      window.clearInterval(typer);
      window.clearTimeout(rotate);
    };
  }, [line, safeLines.length]);

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

  return (
    <section className="dashboard-insight-hero" aria-label={title}>
      <div className="relative flex min-w-0 gap-5">
        <span className="dashboard-insight-orb tt-breathe" style={orbStyle}>
          <Sparkles className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {title ? (
              <h1 className="text-[15px] font-semibold tracking-tight">
                {title}
              </h1>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {onRefresh ? (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="dashboard-hero-refresh"
                >
                  <RefreshCw className="size-3" strokeWidth={2} />
                  {refreshLabel}
                </button>
              ) : null}
              <button
                type="button"
                onClick={rotateNext}
                disabled={safeLines.length < 2}
                className="dashboard-hero-refresh"
              >
                <RefreshCw className="size-3" strokeWidth={2} />
                {rotateLabel}
              </button>
            </div>
          </div>
          <p
            className="mt-3 min-h-20 max-w-5xl text-[19px] leading-[1.7] font-medium tracking-tight md:text-[22px]"
            aria-label={line}
          >
            {typed}
            <span className="tt-breathe ml-1 inline-block h-[15px] w-[7px] translate-y-[2px] bg-foreground/60" />
          </p>
          <div
            className="mt-5 flex gap-1.5"
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
      </div>
    </section>
  );
}
