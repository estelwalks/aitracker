/**
 * Shared presentational wrapper that wires `usePageInsight` into the existing
 * `JarvisInsight` card. Routes pass a `surfaceId` (+ optional `scope`) and get
 * a localized, enhanceable, action-aware hero/inline card with a loading
 * placeholder — no per-route boilerplate.
 */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { JarvisInsight } from "../../../../components/JarvisInsight";
import { useI18n } from "../../../../lib/i18n/context";
import type {
  InsightActionId,
  InsightScope,
  InsightSurfaceId,
} from "../contracts";
import {
  insightActionPath,
  insightSeverityLabelKey,
  usePageInsight,
  type InsightActionPath,
} from "./use-page-insight";

export interface InsightCardAction {
  readonly id: InsightActionId;
  readonly label: string;
}

function InsightSkeleton({ variant }: { variant: "hero" | "inline" }) {
  const hero = variant === "hero";
  return (
    <div
      className={`dashboard-insight-hero${hero ? "" : " dashboard-insight-inline"}`}
      aria-hidden="true"
    >
      <div className={`relative flex min-w-0 items-center ${hero ? "gap-4" : "gap-3"}`}>
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
  onAction,
}: {
  readonly surfaceId: InsightSurfaceId;
  readonly scope?: InsightScope;
  readonly variant?: "hero" | "inline";
  readonly title?: string;
  readonly accent?: string;
  readonly icon?: LucideIcon;
  readonly dotsLabel?: string;
  readonly rotateLabel?: string;
  /** Optional custom action handler; defaults to a Link to `insightActionPath`. */
  readonly onAction?: (
    action: InsightCardAction,
    path: InsightActionPath,
  ) => void;
}) {
  const { locale, t } = useI18n();
  const { lines, loading, envelope, canEnhance, enhancing, enhance } =
    usePageInsight({ surfaceId, scope, locale });

  if (loading && lines.length === 0) {
    return <InsightSkeleton variant={variant} />;
  }
  if (lines.length === 0) return null;

  const textLines = lines.map((line) => line.text);
  const topSeverity = lines[0]?.severity;
  const actionLines = lines.filter((line) => line.action != null);

  const actions =
    actionLines.length === 0 ? undefined : (
      <div className="flex flex-col items-end gap-1.5">
        {actionLines.map((line) => {
          const action = line.action as NonNullable<
            (typeof line)["action"]
          >;
          const path = insightActionPath(action.id);
          const content = (
            <>
              {action.label}
              <ArrowUpRight className="size-3" strokeWidth={2} />
            </>
          );
          return onAction ? (
            <button
              key={line.id}
              type="button"
              onClick={() =>
                onAction({ id: action.id, label: action.label }, path)
              }
              className="dashboard-hero-refresh"
            >
              {content}
            </button>
          ) : (
            <Link key={line.id} to={path} className="dashboard-hero-refresh">
              {content}
            </Link>
          );
        })}
      </div>
    );

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
      onEnhance={canEnhance ? () => void enhance("manual") : undefined}
      enhanceLabel={t("settings.insight.enhance")}
      enhanceBusy={enhancing}
      dotsLabel={dotsLabel}
      rotateLabel={rotateLabel}
      actions={actions}
    />
  );}
