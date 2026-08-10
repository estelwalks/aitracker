import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS, parseSettings } from "./store.ts";

test("returns defaults for invalid persisted settings", () => {
  assert.deepEqual(parseSettings("{"), DEFAULT_SETTINGS);
});

test("returns default retentionDays when value is invalid", () => {
  const settings = parseSettings(JSON.stringify({ retentionDays: -1 }));
  assert.equal(settings.retentionDays, DEFAULT_SETTINGS.retentionDays);
});

test("accepts zero retentionDays (forever)", () => {
  const settings = parseSettings(JSON.stringify({ retentionDays: 0 }));
  assert.equal(settings.retentionDays, 0);
});

test("parses valid retentionDays", () => {
  const settings = parseSettings(JSON.stringify({ retentionDays: 30 }));
  assert.equal(settings.retentionDays, 30);
});

test("keeps valid dataPath", () => {
  const settings = parseSettings(JSON.stringify({ dataPath: "/custom/path" }));
  assert.equal(settings.dataPath, "/custom/path");
});

test("rejects empty dataPath and uses default", () => {
  const settings = parseSettings(JSON.stringify({ dataPath: "" }));
  assert.equal(settings.dataPath, DEFAULT_SETTINGS.dataPath);
});

test("rejects non-string dataPath and uses default", () => {
  const settings = parseSettings(JSON.stringify({ dataPath: 123 }));
  assert.equal(settings.dataPath, DEFAULT_SETTINGS.dataPath);
});

test("preserves launchAtLoginRequested", () => {
  const settings = parseSettings(
    JSON.stringify({ launchAtLoginRequested: true }),
  );
  assert.equal(settings.launchAtLoginRequested, true);
});

test("ignores removed legacy fields silently", () => {
  const settings = parseSettings(
    JSON.stringify({
      dailyBudget: 88,
      providerBudgets: [{ provider: "OpenAI", dailyBudget: 10 }],
      securityRules: [
        { id: "x", name: "X", kind: "密钥泄露", pattern: "key", enabled: true },
      ],
      memoryDirectories: ["/tmp"],
      trashMinutes: 99,
    }),
  );
  assert.equal(settings.retentionDays, DEFAULT_SETTINGS.retentionDays);
  assert.equal(settings.dataPath, DEFAULT_SETTINGS.dataPath);
});
