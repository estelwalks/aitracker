import type {
  DashboardSummaryCore,
  DashboardWindowSummary,
} from "../summary-contracts.ts";

/**
 * P1-T1-08: unified shadow comparison between the compact summary read model
 * and the legacy golden path (`createDashboardV2View`).
 *
 * The projector tests already assert exact equality against the golden views;
 * this module provides the shared diff shape and a strict comparison used by
 * both the unit tests and the shadow stage of the rollout. Only scalar
 * aggregates are compared — never raw events or server types.
 */

export interface SummaryDiff {
  readonly name: string;
  readonly expected: number | string | null;
  readonly actual: number | string | null;
}

/** Compares one window's scalar aggregates; returns every mismatch. */
export function compareWindow(
  name: string,
  window: DashboardWindowSummary,
  golden: DashboardWindowSummary,
): SummaryDiff[] {
  const diffs: SummaryDiff[] = [];
  const scalarFields: ReadonlyArray<{
    key:
      | "totals"
      | "estimatedCostUsd"
      | "cacheRate"
      | "sessions"
      | "skills"
      | "activeTools"
      | "modelCount"
      | "projectCount";
    path: string;
  }> = [
    { key: "totals", path: "totals" },
    { key: "estimatedCostUsd", path: "estimatedCostUsd" },
    { key: "cacheRate", path: "cacheRate" },
    { key: "sessions", path: "sessions" },
    { key: "skills", path: "skills" },
    { key: "activeTools", path: "activeTools" },
    { key: "modelCount", path: "modelCount" },
    { key: "projectCount", path: "projectCount" },
  ];
  for (const field of scalarFields) {
    const expected =
      field.key === "totals"
        ? JSON.stringify(window.totals)
        : String(window[field.key] ?? "null");
    const actual =
      field.key === "totals"
        ? JSON.stringify(golden.totals)
        : String(golden[field.key] ?? "null");
    if (expected !== actual)
      diffs.push({ name: `${name}.${field.path}`, expected, actual });
  }
  return diffs;
}

/**
 * Compares the compact summary against golden windows built from the legacy
 * path. Returns an empty array when the two are numerically identical.
 * `golden.tools` must be the all-window tool cards from the legacy view.
 */
export function compareSummaryToGolden(
  summary: DashboardSummaryCore,
  golden: Readonly<{
    windows: Readonly<{
      today: DashboardWindowSummary;
      "7d": DashboardWindowSummary;
      "30d": DashboardWindowSummary;
      all: DashboardWindowSummary;
    }>;
    tools: ReadonlyArray<{
      readonly id: string;
      readonly tokens: number;
      readonly events: number;
    }>;
  }>,
): SummaryDiff[] {
  const diffs: SummaryDiff[] = [];
  for (const period of ["today", "7d", "30d", "all"] as const) {
    diffs.push(
      ...compareWindow(
        `window.${period}`,
        summary.windows[period],
        golden.windows[period],
      ),
    );
  }
  // Tool cards: tokens/events per tool must agree with the all-window view.
  const goldenTools = golden.tools ?? [];
  const summaryTools = summary.tools ?? [];
  if (goldenTools.length !== summaryTools.length) {
    diffs.push({
      name: "tools.length",
      expected: summaryTools.length,
      actual: goldenTools.length,
    });
  } else {
    for (let index = 0; index < summaryTools.length; index += 1) {
      const summaryTool = summaryTools[index];
      const goldenTool = goldenTools[index];
      if (
        summaryTool.tokens !== goldenTool.tokens ||
        summaryTool.events !== goldenTool.events
      )
        diffs.push({
          name: `tools[${index}].${summaryTool.id}`,
          expected: `${summaryTool.tokens}/${summaryTool.events}`,
          actual: `${goldenTool.tokens}/${goldenTool.events}`,
        });
    }
  }
  return diffs;
}
