/**
 * Reports mutation/read server functions. Kept separate from `query.ts`
 * because `query.ts` re-exports the page component; importing these from the
 * page directly (rather than via `query`) avoids a query → page → query import
 * cycle that the architecture verifier blocks. The heavy server work lives in
 * `api.server.ts` and is dynamically imported so it never reaches the browser.
 */
import { createServerFn } from "@tanstack/react-start";

import type { ReportContent } from "./contracts.ts";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface GenerateReportNowResult {
  readonly triggered: boolean;
  readonly errorCode?: string;
}

/**
 * Trigger a manual report generation for a builtin definition. Honest gate:
 * when no LLM is configured the transport returns `{ triggered: false }` and
 * the UI keeps the button disabled with a hint — generation is never faked.
 * Unknown definition ids degrade to `{ triggered: false }` (the page only ever
 * sends `reports.daily`/`reports.weekly`).
 */
export const generateReportNow = createServerFn({ method: "POST" })
  .validator((input: unknown): { definitionId?: string } => {
    if (input != null && typeof input === "object") {
      const candidate = (input as { definitionId?: unknown }).definitionId;
      if (typeof candidate === "string") return { definitionId: candidate };
    }
    return {};
  })
  .handler(async ({ data }): Promise<GenerateReportNowResult> => {
    if (
      data.definitionId !== "reports.daily" &&
      data.definitionId !== "reports.weekly"
    ) {
      return { triggered: false };
    }
    const { generateReport } = await import("./api.server.ts");
    return generateReport(data.definitionId);
  });

/**
 * Read a report's redacted generated body for the inline preview/editor. Only
 * the body of a persisted report is returned; unknown/malformed ids resolve to
 * null (the renderer then shows an empty draft state).
 */
export const getReportBody = createServerFn({ method: "GET" })
  .validator((input: unknown): { reportId?: string } => {
    if (input != null && typeof input === "object") {
      const candidate = (input as { reportId?: unknown }).reportId;
      if (typeof candidate === "string") return { reportId: candidate };
    }
    return {};
  })
  .handler(async ({ data }): Promise<ReportContent | null> => {
    if (!data.reportId || !OPAQUE_ID.test(data.reportId)) return null;
    const { getReportBody: read } = await import("./api.server.ts");
    return read(data.reportId);
  });
