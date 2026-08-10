import type { DashboardReadModel } from "../contracts.ts";
import { DashboardV2Page } from "./DashboardV2Page.tsx";

/** Public presentation boundary for the renderer-safe dashboard V2. */
export function DashboardPage({ data }: { data: DashboardReadModel }) {
  return <DashboardV2Page data={data} />;
}
