/**
 * Shared presentational wrapper that wires `usePageInsight` into the existing
 * `JarvisInsight` card. Routes pass a `surfaceId` (+ optional `scope`) and get
 * a localized hero/inline card with a loading placeholder — no per-route
 * boilerplate.
 *
 * The card is intentionally minimal: title + severity/增强 marks + typed
 * insight line. Page-level cards expose the same "换一条" rotate control by
 * default; surfaces can opt out when their own action column is already full.
 */
import { Link } from "@tanstack/react-router";
import { Sparkles, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { JarvisInsight } from "../../../../components/JarvisInsight";
import { useI18n } from "../../../../lib/i18n/context";
import type { InsightScope, InsightSurfaceId } from "../contracts";
import {
  insightFallbackStatusLabel,
  insightSeverityLabelKey,
  usePageInsight,
} from "./use-page-insight";

function InsightSkeleton({ variant }: { variant: "hero" | "inline" }) {
  const hero = variant === "hero";
  return (
    <div
      className={`dashboard-insight-hero${hero ? "" : " dashboard-insight-inline"}`}
      aria-hidden="true"
    >
      <div
        className={`relative flex min-w-0 items-center ${hero ? "gap-4" : "gap-3"}`}
      >
        <span
          className={`shrink-0 animate-pulse rounded-full bg-surface-2 ${hero ? "size-10" : "size-8"}`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-24 animate-pulse rounded-sm bg-surface-2" />
          <div
            className={`animate-pulse rounded-sm bg-surface-2 ${
              hero ? "h-4 w-3/4" : "h-3.5 w-1/2"
            }`}
          />
        </div>
      </div>
    </div>
  );
}

export function InsightCard({
  surfaceId,
  scope,
  variant = "hero",
  title,
  accent,
  icon,
  dotsLabel,
  rotateLabel,
  headingLevel = 1,
  showSeverity = true,
  showRotate = true,
  showFallbackStatus = true,
  actions,
}: {
  readonly surfaceId: InsightSurfaceId;
  readonly scope?: InsightScope;
  readonly variant?: "hero" | "inline";
  readonly title?: string;
  readonly accent?: string;
  readonly icon?: LucideIcon;
  readonly dotsLabel?: string;
  readonly rotateLabel?: string;
  readonly headingLevel?: 1 | 2;
  readonly showSeverity?: boolean;
  /** Hide the rotate control on surfaces with a dedicated action column. */
  readonly showRotate?: boolean;
  /** Hide the fallback status on surfaces whose header should stay minimal. */
  readonly showFallbackStatus?: boolean;
  /** Optional right-hand actions kept outside the shared insight copy. */
  readonly actions?: ReactNode;
}) {
  const { locale, t } = useI18n();
  const { lines, loading, envelope } = usePageInsight({
    surfaceId,
    scope,
    locale,
  });

  if (loading && lines.length === 0) {
    return <InsightSkeleton variant={variant} />;
  }
  if (lines.length === 0) return null;

  const textLines = lines.map((line) => line.text);
  // Neutral informational lines should not add a distracting “提示” pill;
  // reserve the badge for actionable attention/risk states.
  const topSeverity =
    showSeverity && lines[0]?.severity !== "info"
      ? lines[0]?.severity
      : undefined;
  const fallbackStatusKey = envelope
    ? insightFallbackStatusLabel(envelope.status)
    : null;
  const renderMessage = t as unknown as (key: string) => string;
  const shouldShowFallbackStatus =
    showFallbackStatus && fallbackStatusKey !== null;
  const fallbackStatus =
    shouldShowFallbackStatus && fallbackStatusKey ? (
      envelope?.status === "enhancer-unavailable" ? (
        <span className="inline-flex min-h-7 items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/[0.08] px-3 text-[11px] font-semibold tracking-normal text-foreground/85">
          <Sparkles
            className="size-2.5 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          {renderMessage(fallbackStatusKey)}
          <Link
            to="/settings"
            search={{ section: "model" }}
            className="border-l border-foreground/20 pl-2 font-semibold text-foreground underline decoration-foreground/30 underline-offset-2 transition-colors hover:text-emerald-200"
          >
            {t("settings.insight.configureModel")}
          </Link>
        </span>
      ) : (
        <span
          role="status"
          className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[9px] tracking-[0.04em] text-muted-foreground"
        >
          {renderMessage(fallbackStatusKey)}
        </span>
      )
    ) : undefined;

  return (
    <JarvisInsight
      variant={variant}
      title={title ?? t("insights.title")}
      lines={textLines}
      icon={icon}
      accent={accent}
      severity={topSeverity}
      severityLabel={
        topSeverity ? t(insightSeverityLabelKey(topSeverity)) : undefined
      }
      source={envelope?.source}
      enhancedLabel={t("settings.insight.enhanced")}
      pills={fallbackStatus}
      actions={actions}
      dotsLabel={dotsLabel ?? t("insights.dots")}
      rotateLabel={showRotate ? (rotateLabel ?? t("insights.rotate")) : null}
      headingLevel={headingLevel}
    />
  );
}
