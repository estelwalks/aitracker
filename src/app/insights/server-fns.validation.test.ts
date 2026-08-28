import assert from "node:assert/strict";
import test from "node:test";

import {
  parseEnhancePageInsightInput,
  parseGetPageInsightInput,
  parseSetInsightPreferencesInput,
  parseGetInsightPreferencesInput,
} from "../../modules/insights/page/server-fns.ts";

const VALID_BASE = { surfaceId: "dashboard", locale: "zh-CN", scope: {} };

test("getPageInsight accepts valid surface/locale/scope", () => {
  assert.deepEqual(parseGetPageInsightInput(VALID_BASE), VALID_BASE);
  assert.deepEqual(
    parseGetPageInsightInput({
      surfaceId: "chat-detail",
      locale: "en-US",
      scope: { range: "7d", entityId: "session-abc.123:_-x" },
    }),
    {
      surfaceId: "chat-detail",
      locale: "en-US",
      scope: { range: "7d", entityId: "session-abc.123:_-x" },
    },
  );
});

test("getPageInsight rejects invalid surface ids and locales", () => {
  assert.throws(
    () => parseGetPageInsightInput({ ...VALID_BASE, surfaceId: "bogus" }),
    /AppError/,
  );
  assert.throws(
    () => parseGetPageInsightInput({ ...VALID_BASE, locale: "xx-XX" }),
    /AppError/,
  );
  assert.throws(() => parseGetPageInsightInput(null), /AppError/);
  assert.throws(() => parseGetPageInsightInput(undefined), /AppError/);
});

test("getPageInsight rejects invalid scope range and entityId", () => {
  assert.throws(
    () => parseGetPageInsightInput({ ...VALID_BASE, scope: { range: "9d" } }),
    /AppError/,
  );
  // Too long (> 128 chars)
  assert.throws(
    () =>
      parseGetPageInsightInput({
        ...VALID_BASE,
        scope: { entityId: "x".repeat(129) },
      }),
    /AppError/,
  );
  // Invalid characters (path/space/unicode)
  assert.throws(
    () =>
      parseGetPageInsightInput({
        ...VALID_BASE,
        scope: { entityId: "../../etc/passwd" },
      }),
    /AppError/,
  );
  assert.throws(
    () =>
      parseGetPageInsightInput({
        ...VALID_BASE,
        scope: { entityId: "session id" },
      }),
    /AppError/,
  );
});

test("enhancePageInsight rejects invalid reason", () => {
  assert.throws(
    () => parseEnhancePageInsightInput({ ...VALID_BASE, reason: "sometimes" }),
    /AppError/,
  );
  assert.deepEqual(
    parseEnhancePageInsightInput({ ...VALID_BASE, reason: "manual" }),
    { ...VALID_BASE, reason: "manual" },
  );
  assert.deepEqual(
    parseEnhancePageInsightInput({ ...VALID_BASE, reason: "auto" }),
    { ...VALID_BASE, reason: "auto" },
  );
});

test("setInsightPreferences accepts valid input and defaults mode to rules", () => {
  assert.deepEqual(parseSetInsightPreferencesInput({}), {
    mode: "rules",
    profileId: null,
    consentVersion: null,
    dailyCallLimit: null,
    refreshIntervalMs: undefined,
    surfaceId: undefined,
  });
  assert.deepEqual(
    parseSetInsightPreferencesInput({
      mode: "enhanced-manual",
      profileId: "profile-1",
      consentVersion: "v1",
      dailyCallLimit: 10,
      refreshIntervalMs: undefined,
      surfaceId: "dashboard",
    }),
    {
      mode: "enhanced-manual",
      profileId: "profile-1",
      consentVersion: "v1",
      dailyCallLimit: 10,
      refreshIntervalMs: undefined,
      surfaceId: "dashboard",
    },
  );
});

test("getInsightPreferences accepts an optional registered surface only", () => {
  assert.deepEqual(parseGetInsightPreferencesInput(undefined), {});
  assert.deepEqual(parseGetInsightPreferencesInput({}), {});
  assert.deepEqual(parseGetInsightPreferencesInput({ surfaceId: "settings" }), {
    surfaceId: "settings",
  });
  assert.throws(
    () => parseGetInsightPreferencesInput({ surfaceId: "bogus" }),
    /AppError/,
  );
});

test("setInsightPreferences rejects invalid mode/profileId/dailyCallLimit/surfaceId", () => {
  assert.throws(
    () => parseSetInsightPreferencesInput({ mode: "enhanced-always" }),
    /AppError/,
  );
  assert.throws(
    () => parseSetInsightPreferencesInput({ profileId: 42 }),
    /AppError/,
  );
  assert.throws(
    () => parseSetInsightPreferencesInput({ dailyCallLimit: -1 }),
    /AppError/,
  );
  assert.throws(
    () => parseSetInsightPreferencesInput({ dailyCallLimit: 1.5 }),
    /AppError/,
  );
  assert.throws(
    () =>
      parseSetInsightPreferencesInput({
        refreshIntervalMs: 59 * 60 * 1000,
      }),
    /AppError/,
  );
  assert.equal(
    parseSetInsightPreferencesInput({ refreshIntervalMs: 60 * 60 * 1000 })
      .refreshIntervalMs,
    60 * 60 * 1000,
  );
  assert.equal(
    parseSetInsightPreferencesInput({
      refreshIntervalMs: 24 * 60 * 60 * 1000,
    }).refreshIntervalMs,
    24 * 60 * 60 * 1000,
  );
  assert.throws(
    () =>
      parseSetInsightPreferencesInput({
        refreshIntervalMs: 24 * 60 * 60 * 1000 + 60_000,
      }),
    /AppError/,
  );
  assert.throws(
    () => parseSetInsightPreferencesInput({ surfaceId: "bogus" }),
    /AppError/,
  );
  assert.throws(() => parseSetInsightPreferencesInput(null), /AppError/);
});
