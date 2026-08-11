import assert from "node:assert/strict";
import test from "node:test";

import { toSourcesQuerySummary } from "./model";

test("sources query projection keeps only HOME-relative display paths", () => {
  const result = toSourcesQuerySummary({
    generatedAt: "2026-08-07T00:00:00.000Z",
    entries: [
      {
        id: "codex",
        name: "Codex",
        status: "has-data",
        events: 2,
        malformedLines: 0,
        lastScannedAt: "2026-08-07T00:00:00.000Z",
        usageLogParsing: "native",
        paths: ["~/.codex", "/Users/alice/.codex"],
        toolSurface: "cli",
        officialDownloadUrl: "https://developers.openai.com/codex/cli/",
        filesRead: 2,
        filesConsidered: 3,
        skillCount: 1,
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
  assert.deepEqual(result.entries[0]!.paths, ["~/.codex"]);
  assert.equal(JSON.stringify(result).includes("/Users/alice"), false);
});
