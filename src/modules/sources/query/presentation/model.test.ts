import assert from "node:assert/strict";
import test from "node:test";

import { toSourcesQuerySummary } from "./model";

test("sources query projection excludes probe paths", () => {
  const result = toSourcesQuerySummary({
    generatedAt: "2026-08-07T00:00:00.000Z",
    entries: [
      {
        id: "codex",
        nameZh: "Codex",
        status: "has-data",
        events: 2,
        malformedLines: 0,
        lastScannedAt: "2026-08-07T00:00:00.000Z",
        usageLogParsing: "native",
        paths: ["/Users/alice/.codex"],
      },
    ],
    totals: {
      toolCount: 1,
      connectedCount: 1,
      noLogsCount: 0,
      notInstalledCount: 0,
      eventCount: 2,
      malformedCount: 0,
    },
  });
  assert.equal("paths" in result.entries[0]!, false);
  assert.equal(JSON.stringify(result).includes("/Users/alice"), false);
});
