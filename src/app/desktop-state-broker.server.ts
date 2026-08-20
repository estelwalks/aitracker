import { timingSafeEqual } from "node:crypto";

import { ENV, STORAGE_KEY_PREFIX } from "../lib/app-config.ts";
import type { PreferenceValue } from "../modules/settings/infrastructure/sqlite-preference-repository.server.ts";
import { getCompositionRoot } from "./composition.server.ts";

export const DESKTOP_STATE_API_PREFIX = "/api/desktop-state";
export const DESKTOP_HISTORY_KEY = `${STORAGE_KEY_PREFIX}security.desktop-history.v1`;
export const DESKTOP_SCHEDULE_KEY = `${STORAGE_KEY_PREFIX}security.scan-schedule.v1`;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function authorized(request: Request): boolean {
  const expected = process.env[ENV.DESKTOP_BROKER_TOKEN];
  const actual = request.headers.get("x-trusttools-desktop-broker");
  if (!expected || !actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function enumValue(
  value: unknown,
  allowed: readonly string[],
  fallback: string,
): string {
  return typeof value === "string" && allowed.includes(value)
    ? value
    : fallback;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    throw new RangeError("Desktop state request is too large");
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES)
    throw new RangeError("Desktop state request is too large");
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Desktop state object is required");
  return value as Record<string, unknown>;
}

export function projectDesktopSecurityHistory(value: unknown): PreferenceValue {
  if (!Array.isArray(value)) throw new TypeError("History array is required");
  return value.slice(0, 200).map((raw) => {
    const entry = raw as Record<string, unknown>;
    const report = entry.report as Record<string, unknown> | undefined;
    return {
      id: String(entry.id ?? "").slice(0, 160),
      scanId: String(entry.scanId ?? "").slice(0, 80),
      skillRef: String(entry.skillRef ?? "").slice(0, 80),
      skillName: "Skill",
      mode: entry.mode === "full" ? "full" : "quick",
      trigger: entry.trigger === "automatic" ? "automatic" : "manual",
      locale: enumValue(
        entry.locale,
        ["zh-CN", "en-US", "ja-JP", "ko-KR"],
        "zh-CN",
      ),
      status: String(entry.status ?? "failed").slice(0, 32),
      startedAt: String(entry.startedAt ?? "").slice(0, 40),
      finishedAt: String(entry.finishedAt ?? "").slice(0, 40),
      ...(typeof entry.errorCode === "string"
        ? { errorCode: entry.errorCode.slice(0, 160) }
        : {}),
      ...(report
        ? {
            report: {
              status: report.status === "partial" ? "partial" : "complete",
              mode: report.mode === "full" ? "full" : "quick",
              verdict: enumValue(
                report.verdict,
                ["allow", "warn", "block", "unknown"],
                "unknown",
              ),
              riskScore: Number(report.riskScore) || 0,
              rulesVersion: String(report.rulesVersion ?? "unknown").slice(
                0,
                128,
              ),
              engineVersion: String(report.engineVersion ?? "unknown").slice(
                0,
                128,
              ),
              locale: enumValue(
                report.locale,
                ["zh-CN", "en-US", "ja-JP", "ko-KR"],
                "zh-CN",
              ),
              contentHash: String(report.contentHash ?? "").slice(0, 128),
              scannedFiles: Number(report.scannedFiles) || 0,
              threatLevel: enumValue(
                report.threatLevel,
                ["critical", "high", "medium", "low", "none"],
                "none",
              ),
              threatLevelDisplay: String(report.threatLevel ?? "none"),
              categories: (report.categories as PreferenceValue) ?? {},
              summary: "Persisted security scan summary",
              findings: [],
              rules: [],
              branches: [],
              skippedFiles: [],
            },
          }
        : {}),
    } as PreferenceValue;
  });
}

export async function handleDesktopStateBrokerRequest(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${DESKTOP_STATE_API_PREFIX}/`)) return null;
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  try {
    const root = await getCompositionRoot();
    const preferences = root.database.features.appPreferences;
    const route = url.pathname.slice(DESKTOP_STATE_API_PREFIX.length);
    if (request.method === "GET" && route === "/preferences") {
      return json(
        Object.fromEntries(
          preferences.list().map((item) => [item.key, item.value]),
        ),
      );
    }
    if (request.method === "POST" && route === "/preference") {
      const input = await body(request);
      if (typeof input.key !== "string" || input.key.length === 0)
        throw new TypeError("Preference key is required");
      preferences.set({
        key: input.key,
        value: input.value as PreferenceValue,
        updatedAtMs: Date.now(),
      });
      return json({ ok: true });
    }
    if (request.method === "POST" && route === "/preferences/reset") {
      const keys = preferences.list().map((item) => item.key);
      return json({
        removedKeys: keys.filter((key) => preferences.remove(key)).length,
      });
    }
    if (request.method === "GET" && route === "/security-history") {
      return json(preferences.get(DESKTOP_HISTORY_KEY)?.value ?? []);
    }
    if (request.method === "PUT" && route === "/security-history") {
      const input = await body(request);
      preferences.set({
        key: DESKTOP_HISTORY_KEY,
        value: projectDesktopSecurityHistory(input.entries),
        updatedAtMs: Date.now(),
      });
      return json({ ok: true });
    }
    if (request.method === "GET" && route === "/scan-schedule") {
      return json(preferences.get(DESKTOP_SCHEDULE_KEY)?.value ?? null);
    }
    if (request.method === "PUT" && route === "/scan-schedule") {
      const input = await body(request);
      preferences.set({
        key: DESKTOP_SCHEDULE_KEY,
        value: input.schedule as PreferenceValue,
        updatedAtMs: Date.now(),
      });
      return json({ ok: true });
    }
    if (request.method === "GET" && route === "/model-profile") {
      const active = await root.modelProfiles.getActiveView();
      if (!active) return json(null);
      return json(
        (await root.modelProfiles.getProfileForExecution(active.id)) ?? null,
      );
    }
    return json({ error: "not_found" }, 404);
  } catch (error) {
    console.error("Desktop state broker failed", error);
    return json({ error: "desktop_state_failed" }, 500);
  }
}
