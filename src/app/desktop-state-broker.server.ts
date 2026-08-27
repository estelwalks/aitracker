import { timingSafeEqual } from "node:crypto";

import { ENV, STORAGE_KEY_PREFIX } from "../lib/app-config.ts";
import type { PreferenceValue } from "../modules/settings/infrastructure/sqlite-preference-repository.server.ts";
import type {
  SecurityScanRunRecord,
  SecurityScanScheduleRuntime,
} from "../../electron/contracts.ts";
import { getCompositionRoot } from "./composition.server.ts";
import {
  STARTUP_FAILURE_CODE_HEADER,
  startupFailureCode,
} from "./startup-diagnostics.server.ts";

export const DESKTOP_STATE_API_PREFIX = "/api/desktop-state";
export const DESKTOP_HISTORY_KEY = `${STORAGE_KEY_PREFIX}security.desktop-history.v1`;
export const DESKTOP_SCHEDULE_KEY = `${STORAGE_KEY_PREFIX}security.scan-schedule.v1`;
export const DESKTOP_SCHEDULE_RUNTIME_KEY = `${STORAGE_KEY_PREFIX}security.scan-schedule-runtime.v1`;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// app_preferences rejects JSON documents larger than 64 KiB. Security history
// is intentionally a compact summary, so keep a little headroom for schema
// and serialization changes while retaining the newest entries.
const MAX_PERSISTED_SECURITY_HISTORY_JSON_LENGTH = 60_000;

function authorized(request: Request): boolean {
  const expected = process.env[ENV.DESKTOP_BROKER_TOKEN];
  const actual = request.headers.get("x-aitracker-desktop-broker");
  if (!expected || !actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(
  value: unknown,
  status = 200,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
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

/** Preserve a renderer-safe Skill name without ever persisting a filesystem path. */
function safeSkillName(value: unknown): string {
  const cleaned = Array.from(String(value ?? ""), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? " " : character;
  })
    .join("")
    .trim();
  if (!cleaned || cleaned.includes("/") || cleaned.includes("\\")) {
    return "Skill";
  }
  return cleaned.slice(0, 160);
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
  const projected = value.slice(0, 200).map((raw) => {
    const entry = raw as Record<string, unknown>;
    const report = entry.report as Record<string, unknown> | undefined;
    return {
      id: String(entry.id ?? "").slice(0, 160),
      scanId: String(entry.scanId ?? "").slice(0, 80),
      skillRef: String(entry.skillRef ?? "").slice(0, 80),
      skillName: safeSkillName(entry.skillName),
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
              // Category names are risk-kind identifiers (for example
              // `secret_access`). The preference privacy guard deliberately
              // rejects keys that look like credential fields, so category
              // details must not be persisted in this summary document.
              categories: {},
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

  // The database stores this whole array in one app_preferences row. Drop the
  // oldest entries until the compact summary fits the repository's limit; the
  // array is newest-first, so the current scan is always retained.
  while (
    projected.length > 1 &&
    JSON.stringify(projected).length >
      MAX_PERSISTED_SECURITY_HISTORY_JSON_LENGTH
  ) {
    projected.pop();
  }
  return projected;
}

export function projectSecurityScheduleRuntime(
  value: unknown,
): SecurityScanScheduleRuntime {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Security schedule runtime is required");
  const item = value as Record<string, unknown>;
  if (
    typeof item.scheduleFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/u.test(item.scheduleFingerprint)
  )
    throw new TypeError("Invalid security schedule fingerprint");
  if (
    item.nextRunAt !== null &&
    (typeof item.nextRunAt !== "string" ||
      !Number.isFinite(Date.parse(item.nextRunAt)))
  )
    throw new TypeError("Invalid next security scan time");
  if (typeof item.pending !== "boolean")
    throw new TypeError("Invalid pending security scan state");
  if (
    typeof item.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(item.updatedAt))
  )
    throw new TypeError("Invalid security schedule update time");
  return {
    scheduleFingerprint: item.scheduleFingerprint,
    nextRunAt: item.nextRunAt,
    pending: item.pending,
    updatedAt: item.updatedAt,
  };
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
    if (request.method === "GET" && route === "/scan-schedule-runtime") {
      return json(preferences.get(DESKTOP_SCHEDULE_RUNTIME_KEY)?.value ?? null);
    }
    if (request.method === "PUT" && route === "/scan-schedule-runtime") {
      const input = await body(request);
      preferences.set({
        key: DESKTOP_SCHEDULE_RUNTIME_KEY,
        value: projectSecurityScheduleRuntime(
          input.runtime,
        ) as unknown as PreferenceValue,
        updatedAtMs: Date.now(),
      });
      return json({ ok: true });
    }
    if (request.method === "GET" && route === "/security-scan-run/latest") {
      return json(await root.database.features.securityScanRuns.latest());
    }
    if (request.method === "PUT" && route === "/security-scan-run") {
      const input = await body(request);
      await root.database.features.securityScanRuns.save(
        input.run as unknown as SecurityScanRunRecord,
      );
      return json({ ok: true });
    }
    if (request.method === "POST" && route === "/security-scan-run/recover") {
      const input = await body(request);
      if (
        typeof input.finishedAt !== "string" ||
        !Number.isFinite(Date.parse(input.finishedAt))
      )
        throw new TypeError("Valid recovery time is required");
      return json({
        recovered:
          await root.database.features.securityScanRuns.recoverInterrupted(
            input.finishedAt,
          ),
      });
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
    return json({ error: "desktop_state_failed" }, 500, {
      [STARTUP_FAILURE_CODE_HEADER]: startupFailureCode(error),
    });
  }
}
