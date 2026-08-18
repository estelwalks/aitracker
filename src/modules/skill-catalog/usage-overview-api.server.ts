import type { AgentUsageOverviewQueryInput } from "./usage-overview-contracts.ts";
import type { AgentUsageOverviewReadModel } from "./usage-overview-contracts.ts";
import { buildToolOverview } from "./application/tool-overview.ts";
import { createProjectorCache } from "../../lib/read-model/projector-cache.ts";
import type { Locale } from "../../lib/i18n/locale.ts";

/**
 * P1-T1-06: server adapter for the compact agent usage overview.
 *
 * Reuses the dashboard's browser-safe V2 snapshot (shared scan) and pre-builds
 * the tool overview view server-side. The renderer receives only the compact
 * view — never raw events — and interaction changes request a new projection.
 */

const cache = createProjectorCache<AgentUsageOverviewReadModel>({
  maxEntries: 16,
});

export async function loadAgentUsageOverview(
  input: AgentUsageOverviewQueryInput,
): Promise<AgentUsageOverviewReadModel> {
  const { buildDashboardV2Snapshot } =
    await import("../dashboard/api.server.ts");
  const { v2 } = await buildDashboardV2Snapshot(input.locale as Locale);
  const revision = v2.generatedAt;
  const params = {
    toolId: input.toolId ?? "",
    period: input.period ?? "30d",
    from: input.from ?? "",
    to: input.to ?? "",
  };
  const cached = cache.get(revision, params);
  if (cached) return cached;

  const startedAt = performance.now();
  const view = buildToolOverview(
    v2,
    input.toolId ?? null,
    input.period ?? "30d",
    input.from,
    input.to,
  );
  const model: AgentUsageOverviewReadModel = {
    locale: input.locale,
    view,
    meta: {
      name: "agents.tool-overview",
      revision,
      generatedAt: v2.generatedAt,
      durationMs: performance.now() - startedAt,
      dtoBytes: 0,
      status: "fresh",
    },
  };
  let dtoBytes = 0;
  try {
    dtoBytes = Buffer.byteLength(JSON.stringify(model), "utf8");
  } catch {
    dtoBytes = 0;
  }
  const withBytes: AgentUsageOverviewReadModel = {
    ...model,
    meta: { ...model.meta, dtoBytes },
  };
  cache.set(revision, params, withBytes);
  return withBytes;
}

/** Clears the in-memory projection cache (tests only). */
export function clearAgentUsageOverviewCache(): void {
  cache.clear();
}
