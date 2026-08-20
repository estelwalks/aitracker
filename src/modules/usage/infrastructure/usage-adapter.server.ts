import { scanLocalUsage } from "../../../lib/local-usage/scanner.server.ts";
import type { LocalUsageScanOptions } from "../../../lib/local-usage/scanner.server.ts";
import type { UsageSnapshotDto } from "../contracts.ts";

/**
 * Usage scanner — an external-source read-only collection adapter. The local
 * scanner remains the only fact source for usage events; no route should
 * import it directly.
 */
export interface UsageScanner {
  scan(options?: LocalUsageScanOptions): Promise<UsageSnapshotDto>;
}

export function createUsageScanner(): UsageScanner {
  return { scan: scanLocalUsage };
}

/**
 * Removes filesystem probes and command-level context before a snapshot can
 * cross the feature boundary. Aggregates and token counts remain unchanged.
 */
export function toPublicUsageSnapshot(
  snapshot: UsageSnapshotDto,
): UsageSnapshotDto {
  return {
    ...snapshot,
    sources: snapshot.sources.map((source) => ({
      ...source,
      paths: undefined,
      diagnostics: source.diagnostics?.map((diagnostic) => ({
        ...diagnostic,
        path: undefined,
      })),
    })),
    details: snapshot.details.map((event) =>
      event.context == null
        ? event
        : { ...event, context: { ...event.context, commands: undefined } },
    ),
    recent: snapshot.recent.map((event) =>
      event.context == null
        ? event
        : { ...event, context: { ...event.context, commands: undefined } },
    ),
  };
}
