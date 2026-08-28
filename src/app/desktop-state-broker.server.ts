import { timingSafeEqual } from "node:crypto";

import { ENV, STORAGE_KEY_PREFIX } from "../lib/app-config.ts";
import type { PreferenceValue } from "../modules/settings/infrastructure/sqlite-preference-repository.server.ts";
import type {
  SecurityFindingDto,
  SecurityScanHistoryEntry,
  SecurityScanRunRecord,
  SecurityScanScheduleRuntime,
  SecurityTokenUsageBreakdownDto,
} from "../../electron/contracts.ts";
import { SECURITY_LLM_REVIEW_PREF_KEY } from "../modules/security-assessment/llm-review.contracts.ts";
import { assertAppPreferenceValueSafe } from "../platform/database/privacy-guard.server.ts";
import { getCompositionRoot } from "./composition.server.ts";
import { getActiveModelProfileForExecution } from "../modules/ai-orchestration/model-profile.server.ts";
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

/** Retain useful local evidence while replacing privacy-guarded raw text. */
function safeEvidenceText(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  const text = String(value ?? "")
    .trim()
    .slice(0, maxLength);
  if (!text) return fallback;
  try {
    assertAppPreferenceValueSafe("securityEvidence", text);
    return text;
  } catch {
    return fallback;
  }
}

function safeFiniteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function projectSecurityFinding(
  raw: unknown,
  index: number,
): SecurityFindingDto {
  const finding =
    raw != null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const severity = enumValue(
    finding.severity,
    ["critical", "high", "medium", "low"],
    "low",
  ) as SecurityFindingDto["severity"];
  const kind = safeEvidenceText(
    finding.kind,
    "data_exfiltration",
    80,
  ) as SecurityFindingDto["kind"];
  return {
    id: safeEvidenceText(finding.id, `finding-${index + 1}`, 180),
    kind,
    severity,
    source: finding.source === "model" ? "model" : "static",
    kindDisplay: safeEvidenceText(finding.kindDisplay, kind, 120),
    severityDisplay: safeEvidenceText(finding.severityDisplay, severity, 80),
    ...(typeof finding.ruleId === "string"
      ? { ruleId: safeEvidenceText(finding.ruleId, "unknown", 128) }
      : {}),
    ruleName: safeEvidenceText(finding.ruleName, "", 240),
    message: safeEvidenceText(finding.message, "", 240),
    remediation: safeEvidenceText(finding.remediation, "", 240),
    weight: safeFiniteNumber(finding.weight),
    ...(typeof finding.cweId === "string"
      ? { cweId: safeEvidenceText(finding.cweId, "", 64) }
      : {}),
    ...(typeof finding.bypassVerification === "boolean"
      ? { bypassVerification: finding.bypassVerification }
      : {}),
    path: safeEvidenceText(finding.path, `file-${index + 1}`, 256),
    ...(Number.isSafeInteger(finding.line) && Number(finding.line) > 0
      ? { line: Number(finding.line) }
      : {}),
    ...(typeof finding.fileHash === "string"
      ? { fileHash: safeEvidenceText(finding.fileHash, "", 128) }
      : {}),
  };
}

function projectTokenUsageBreakdown(
  raw: unknown,
): SecurityTokenUsageBreakdownDto {
  const value =
    raw != null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    status: enumValue(
      value.status,
      ["not_applicable", "complete", "partial", "unavailable"],
      "unavailable",
    ) as SecurityTokenUsageBreakdownDto["status"],
    requestCount: Math.max(0, Math.trunc(safeFiniteNumber(value.requestCount))),
    reportedRequestCount: Math.max(
      0,
      Math.trunc(safeFiniteNumber(value.reportedRequestCount)),
    ),
    inputTokens: Math.max(0, Math.trunc(safeFiniteNumber(value.inputTokens))),
    outputTokens: Math.max(0, Math.trunc(safeFiniteNumber(value.outputTokens))),
    totalTokens: Math.max(0, Math.trunc(safeFiniteNumber(value.totalTokens))),
    cachedInputTokens: Math.max(
      0,
      Math.trunc(safeFiniteNumber(value.cachedInputTokens)),
    ),
  };
}

interface StoredUsageBreakdown {
  readonly status: SecurityTokenUsageBreakdownDto["status"];
  readonly requestCount: number;
  readonly reportedRequestCount: number;
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly totalUnits: number;
  readonly cachedInputUnits: number;
}

interface StoredUsageAccounting extends StoredUsageBreakdown {
  readonly models: readonly {
    readonly label: string;
    readonly usage: StoredUsageBreakdown;
  }[];
  readonly branches: readonly {
    readonly name:
      | "ruleReview"
      | "singleFileAnalysis"
      | "multiFileAnalysis"
      | "semanticDedup";
    readonly usage: StoredUsageBreakdown;
  }[];
}

function storedUsageBreakdown(raw: unknown): StoredUsageBreakdown {
  const usage = projectTokenUsageBreakdown(raw);
  return {
    status: usage.status,
    requestCount: usage.requestCount,
    reportedRequestCount: usage.reportedRequestCount,
    inputUnits: usage.inputTokens,
    outputUnits: usage.outputTokens,
    totalUnits: usage.totalTokens,
    cachedInputUnits: usage.cachedInputTokens,
  };
}

function projectTokenUsage(raw: unknown): StoredUsageAccounting | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const rawModels =
    value.byModel != null &&
    typeof value.byModel === "object" &&
    !Array.isArray(value.byModel)
      ? (value.byModel as Record<string, unknown>)
      : {};
  const models = Object.entries(rawModels)
    .slice(0, 16)
    .map(([name, usage], index) => ({
      label: safeEvidenceText(name, `model-${index + 1}`, 128),
      usage: storedUsageBreakdown(usage),
    }));
  const rawBranches =
    value.byBranch != null &&
    typeof value.byBranch === "object" &&
    !Array.isArray(value.byBranch)
      ? (value.byBranch as Record<string, unknown>)
      : {};
  const branchNames = [
    "ruleReview",
    "singleFileAnalysis",
    "multiFileAnalysis",
    "semanticDedup",
  ] as const;
  const branches = branchNames
    .filter((name) => rawBranches[name] != null)
    .map((name) => ({
      name,
      usage: storedUsageBreakdown(rawBranches[name]),
    }));
  return {
    ...storedUsageBreakdown(value),
    models,
    branches,
  };
}

function restoreUsageBreakdown(raw: unknown): SecurityTokenUsageBreakdownDto {
  const value =
    raw != null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return projectTokenUsageBreakdown({
    status: value.status,
    requestCount: value.requestCount,
    reportedRequestCount: value.reportedRequestCount,
    inputTokens: value.inputUnits,
    outputTokens: value.outputUnits,
    totalTokens: value.totalUnits,
    cachedInputTokens: value.cachedInputUnits,
  });
}

/** Rehydrate privacy-safe persisted accounting names into the public DTO. */
export function restoreDesktopSecurityHistory(
  value: unknown,
): SecurityScanHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const entry = structuredClone(raw) as Record<string, unknown>;
    const report = entry.report as Record<string, unknown> | undefined;
    const accounting = report?.usageAccounting as
      | (Record<string, unknown> & {
          models?: unknown;
          branches?: unknown;
        })
      | undefined;
    if (!report || !accounting)
      return entry as unknown as SecurityScanHistoryEntry;
    const models = Array.isArray(accounting.models) ? accounting.models : [];
    const branches = Array.isArray(accounting.branches)
      ? accounting.branches
      : [];
    report.tokenUsage = {
      ...restoreUsageBreakdown(accounting),
      byModel: Object.fromEntries(
        models.flatMap((rawModel) => {
          const model = rawModel as Record<string, unknown>;
          return typeof model.label === "string"
            ? [[model.label, restoreUsageBreakdown(model.usage)]]
            : [];
        }),
      ),
      byBranch: Object.fromEntries(
        branches.flatMap((rawBranch) => {
          const branch = rawBranch as Record<string, unknown>;
          return typeof branch.name === "string"
            ? [[branch.name, restoreUsageBreakdown(branch.usage)]]
            : [];
        }),
      ),
    };
    delete report.usageAccounting;
    return entry as unknown as SecurityScanHistoryEntry;
  });
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
    const findings = Array.isArray(report?.findings)
      ? report.findings.slice(0, 50).map(projectSecurityFinding)
      : [];
    const branches = Array.isArray(report?.branches)
      ? report.branches.slice(0, 8).map((rawBranch) => {
          const branch = rawBranch as Record<string, unknown>;
          return {
            name: enumValue(
              branch.name,
              [
                "static",
                "ruleReview",
                "singleFileAnalysis",
                "multiFileAnalysis",
              ],
              "static",
            ),
            status: enumValue(
              branch.status,
              ["complete", "skipped", "failed"],
              "failed",
            ),
            ...(typeof branch.detail === "string"
              ? {
                  detail: safeEvidenceText(
                    branch.detail,
                    "details unavailable",
                    240,
                  ),
                }
              : {}),
          };
        })
      : [];
    const skippedFiles = Array.isArray(report?.skippedFiles)
      ? report.skippedFiles.slice(0, 500).map((rawFile, index) => {
          const file = rawFile as Record<string, unknown>;
          return {
            path: safeEvidenceText(file.path, `file-${index + 1}`, 256),
            reasonCode: enumValue(
              file.reasonCode,
              [
                "unavailable",
                "symlink",
                "depth-limit",
                "file-limit",
                "skill-size-limit",
                "file-size-limit",
                "binary",
                "scanner-skip",
              ],
              "scanner-skip",
            ),
            reason: safeEvidenceText(file.reason, "scanner-skip", 240),
          };
        })
      : [];
    const tokenUsage = projectTokenUsage(report?.tokenUsage);
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
              summary: safeEvidenceText(
                report.summary,
                findings.length > 0
                  ? "Security findings retained"
                  : "Security scan completed",
                500,
              ),
              findings,
              rules: [],
              branches,
              skippedFiles,
              ...(tokenUsage ? { usageAccounting: tokenUsage } : {}),
            },
          }
        : {}),
    } as unknown as PreferenceValue;
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
      return json(
        restoreDesktopSecurityHistory(
          preferences.get(DESKTOP_HISTORY_KEY)?.value ?? [],
        ),
      );
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
      const aiDetectionPreference = preferences.get(
        SECURITY_LLM_REVIEW_PREF_KEY,
      );
      if (
        aiDetectionPreference !== undefined &&
        aiDetectionPreference.value !== true
      ) {
        return json(null);
      }
      return json(
        (await getActiveModelProfileForExecution(root.modelProfiles)) ?? null,
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
