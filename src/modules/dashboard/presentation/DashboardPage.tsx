import type { DashboardSummaryReadModel } from "../summary-contracts.ts";
import { DashboardV2Page } from "./DashboardV2Page.tsx";

/** Public presentation boundary for the compact dashboard summary (P1-T1-04). */
export function DashboardPage({ data }: { data: DashboardSummaryReadModel }) {
  return <DashboardV2Page data={data} />;
}
