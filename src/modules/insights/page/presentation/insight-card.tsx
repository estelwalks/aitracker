/**
 * Shared presentational wrapper that wires `usePageInsight` into the existing
 * `JarvisInsight` card. Routes pass a `surfaceId` (+ optional `scope`) and get
 * a localized hero/inline card with a loading placeholder — no per-route
 * boilerplate.
 *
 * The card is intentionally minimal: title + severity/增强 marks + typed
 * insight line. Every page-level card exposes the same "换一条" rotate
 * control, while a missing model is surfaced as a link to model settings.
 */
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

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
  showFallbackStatus = true,
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
  /** Hide the fallback status on surfaces whose header should stay minimal. */
  readonly showFallbackStatus?: boolean;
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
  const topSeverity = showSeverity ? lines[0]?.severity : undefined;
  const fallbackStatusKey = envelope
    ? insightFallbackStatusLabel(envelope.status)
    : null;
  const renderMessage = t as unknown as (key: string) => string;
  const shouldShowFallbackStatus =
    fallbackStatusKey !== null &&
    (showFallbackStatus || envelope?.status === "enhancer-unavailable");
  const fallbackStatus =
    shouldShowFallbackStatus && fallbackStatusKey ? (
      envelope?.status === "enhancer-unavailable" ? (
        <Link
          to="/settings"
          search={{ section: "model" }}
          className="inline-flex h-5 items-center rounded-full border border-border px-2 text-[9px] tracking-[0.04em] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          {renderMessage(fallbackStatusKey)}
        </Link>
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
      dotsLabel={dotsLabel ?? t("insights.dots")}
      rotateLabel={rotateLabel ?? t("insights.rotate")}
      headingLevel={headingLevel}
    />
  );
}
