import type { ReportScheduleStatus } from "../server-fns.ts";
import type { ReportScheduleKind, ReportSchedulesConfig } from "../schedule.ts";

const SCHEDULE_KINDS = ["daily", "weekly", "monthly"] as const;

export type CompactScheduleSummaryItem =
  | {
      readonly kind: ReportScheduleKind;
      readonly state: "pending" | "loading";
    }
  | {
      readonly kind: ReportScheduleKind;
      readonly state: "scheduled";
      readonly nextRunAt: string;
    };

/**
 * Builds the collapsed card's status model from the scheduler's real state.
 * Disabled plans are represented separately by compactDisabledScheduleKinds;
 * an empty result lets the card render its single "all disabled" fallback.
 */
export function compactScheduleSummaryItems(
  schedule: ReportSchedulesConfig,
  statuses: Readonly<
    Partial<Record<ReportScheduleKind, ReportScheduleStatus>>
  > | null,
): readonly CompactScheduleSummaryItem[] {
  return SCHEDULE_KINDS.filter((kind) => schedule[kind].enabled).map((kind) => {
    const status = statuses?.[kind];
    if (status?.pending) return { kind, state: "pending" };
    if (status?.nextRunAt) {
      return { kind, state: "scheduled", nextRunAt: status.nextRunAt };
    }
    return { kind, state: "loading" };
  });
}

export function compactDisabledScheduleKinds(
  schedule: ReportSchedulesConfig,
): readonly ReportScheduleKind[] {
  return SCHEDULE_KINDS.filter((kind) => !schedule[kind].enabled);
}
