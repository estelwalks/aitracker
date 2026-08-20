/**
 * Shared presentational wrapper that wires `usePageInsight` into the existing
 * `JarvisInsight` card. Routes pass a `surfaceId` (+ optional `scope`) and get
 * a localized hero/inline card with a loading placeholder — no per-route
 * boilerplate.
 *
 * The card is intentionally minimal: title + severity/增强 marks + typed
 * insight line. Action buttons, the enhance control, the "换一条" rotate
 * control and the unavailable hint are no longer surfaced here — pages show the
 * insight as a passive read-only caption.
 */
import type { LucideIcon } from "lucide-react";

import { JarvisInsight } from "../../../../components/JarvisInsight";
import { useI18n } from "../../../../lib/i18n/context";
import type { InsightScope, InsightSurfaceId } from "../contracts";
import { insightSeverityLabelKey, usePageInsight } from "./use-page-insight";

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
}: {
  readonly surfaceId: InsightSurfaceId;
  readonly scope?: InsightScope;
  readonly variant?: "hero" | "inline";
  readonly title?: string;
  readonly accent?: string;
  readonly icon?: LucideIcon;
  readonly dotsLabel?: string;
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
  const topSeverity = lines[0]?.severity;

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
      dotsLabel={dotsLabel}
    />
  );
}
