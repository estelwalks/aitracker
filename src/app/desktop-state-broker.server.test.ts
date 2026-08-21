import assert from "node:assert/strict";
import test from "node:test";

import { assertAppPreferenceValueSafe } from "../platform/database/privacy-guard.server.ts";
import {
  DESKTOP_HISTORY_KEY,
  projectDesktopSecurityHistory,
} from "./desktop-state-broker.server.ts";

function historyEntry(index: number, categories: Record<string, unknown> = {}) {
  return {
    id: `scan:${String(index).padStart(8, "0")}-0000-0000-0000-000000000000:skill-${index}`,
    scanId: `scan:${String(index).padStart(8, "0")}-0000-0000-0000-000000000000`,
    skillRef: `skill:${String(index).padStart(64, "0")}`,
    skillName: `skill-${index}`,
    mode: "full",
    trigger: "manual",
    locale: "zh-CN",
    status: "complete",
    startedAt: "2026-08-21T00:00:00.000Z",
    finishedAt: "2026-08-21T00:00:01.000Z",
    report: {
      status: "complete",
      mode: "full",
      verdict: "warn",
      riskScore: 10,
      rulesVersion: "rules",
      engineVersion: "engine",
      locale: "zh-CN",
      contentHash: String(index),
      scannedFiles: 1,
      threatLevel: "medium",
      categories,
    },
  };
}

test("security history projection drops privacy-sensitive category keys", () => {
  const projected = projectDesktopSecurityHistory([
    historyEntry(1, {
      secret_access: { count: 1 },
      sensitive_file_access: { count: 2 },
    }),
  ]) as readonly { report: { categories: unknown } }[];

  assert.deepEqual(projected[0]?.report.categories, {});
  assert.doesNotThrow(() =>
    assertAppPreferenceValueSafe(DESKTOP_HISTORY_KEY, projected),
  );
});

test("security history projection retains the newest entries below the preference limit", () => {
  const projected = projectDesktopSecurityHistory(
    Array.from({ length: 200 }, (_, index) => historyEntry(index)),
  ) as readonly { skillName: string }[];

  assert.ok(projected.length < 200);
  assert.equal(projected[0]?.skillName, "skill-0");
  assert.equal(projected.at(-1)?.skillName, `skill-${projected.length - 1}`);
  assert.doesNotThrow(() =>
    assertAppPreferenceValueSafe(DESKTOP_HISTORY_KEY, projected),
  );
});
