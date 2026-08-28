import { z } from "zod";

import { SECURITY_CSRF_HEADER } from "../../../lib/app-config";
import type {
  SecurityRuntimeCapability,
  SecurityScanHistoryEntry,
  SecurityScanReportDto,
  SecurityScanStartRequest,
  SecurityScanState,
  SecuritySkillTarget,
} from "../../../../electron/contracts";
import type {
  SecurityRuntimeCapabilityView,
  SecurityScanScheduleView,
  SecurityScanScheduleStatusView,
} from "../presentation/security-view";
import {
  historyView,
  reportView,
  stateView,
  type SecurityClient,
} from "./desktop-client";

const API_PREFIX = "/api/security";
const CSRF_VALUE = "1";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface BrowserLocation {
  readonly hostname: string;
  readonly origin: string;
  readonly protocol: string;
}

const localeSchema = z.enum(["zh-CN", "en-US", "ja-JP", "ko-KR"]);
const modeSchema = z.enum(["quick", "full"]);
const triggerSchema = z.enum(["manual", "automatic"]);
const riskKindSchema = z.enum([
  "remote_execution",
  "command_injection",
  "data_exfiltration",
  "secret_access",
  "persistence",
  "destructive",
  "obfuscation",
  "privilege_escalation",
  "sensitive_file_access",
  "network_abuse",
  "prompt_injection",
]);
const severitySchema = z.enum(["critical", "high", "medium", "low"]);

const skillSchema = z
  .object({
    skillRef: z.string().regex(/^skill:/u),
    name: z.string(),
    agents: z.array(z.string()),
    modifiedAt: z.string(),
    source: z.enum(["discovered", "selected"]),
  })
  .strict();

const progressSchema = z
  .object({
    discovered: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    started: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100),
  })
  .strict();

const stateSchema = z
  .object({
    scanId: z
      .string()
      .regex(/^scan:/u)
      .nullable(),
    status: z.enum([
      "idle",
      "running",
      "cancelling",
      "complete",
      "partial",
      "failed",
      "cancelled",
      "model-required",
    ]),
    mode: modeSchema.nullable(),
    trigger: triggerSchema.nullable(),
    locale: localeSchema.nullable(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    currentSkill: skillSchema.pick({ skillRef: true, name: true }).optional(),
    progress: progressSchema,
    resultIds: z.array(z.string()),
    errorCode: z.string().optional(),
  })
  .strict();

const findingSchema = z
  .object({
    id: z.string(),
    kind: riskKindSchema,
    severity: severitySchema,
    source: z.enum(["static", "model"]),
    kindDisplay: z.string(),
    severityDisplay: z.string(),
    ruleId: z.string().optional(),
    ruleName: z.string(),
    message: z.string(),
    remediation: z.string(),
    weight: z.number(),
    cweId: z.string().optional(),
    bypassVerification: z.boolean().optional(),
    path: z.string(),
    line: z.number().int().positive().optional(),
    excerpt: z.string().optional(),
    fileHash: z.string().optional(),
    reasoning: z.string().optional(),
  })
  .strict();

const matchSchema = z
  .object({
    path: z.string(),
    line: z.number().int().positive().optional(),
    excerpt: z.string().optional(),
    fileHash: z.string().optional(),
  })
  .strict();

const tokenUsageBreakdownSchema = z
  .object({
    status: z.enum(["not_applicable", "complete", "partial", "unavailable"]),
    requestCount: z.number().int().nonnegative(),
    reportedRequestCount: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
  })
  .strict();

const tokenUsageSchema = tokenUsageBreakdownSchema.extend({
  byModel: z.record(z.string(), tokenUsageBreakdownSchema),
  byBranch: z.record(
    z.enum([
      "ruleReview",
      "singleFileAnalysis",
      "multiFileAnalysis",
      "semanticDedup",
    ]),
    tokenUsageBreakdownSchema,
  ),
});

const reportSchema = z
  .object({
    status: z.enum(["complete", "partial"]),
    mode: modeSchema,
    verdict: z.enum(["allow", "warn", "block", "unknown"]),
    riskScore: z.number().min(0).max(100),
    rulesVersion: z.string(),
    engineVersion: z.string(),
    locale: localeSchema,
    contentHash: z.string(),
    scannedFiles: z.number().int().nonnegative(),
    threatLevel: z.enum(["critical", "high", "medium", "low", "none"]),
    threatLevelDisplay: z.string(),
    categories: z.record(
      riskKindSchema,
      z
        .object({
          count: z.number().int().nonnegative(),
          highestSeverity: severitySchema,
          totalWeight: z.number(),
          display: z.string(),
        })
        .strict(),
    ),
    summary: z.string(),
    findings: z.array(findingSchema),
    rules: z.array(
      z
        .object({
          ruleId: z.string(),
          ruleName: z.string(),
          kind: riskKindSchema,
          severity: severitySchema,
          weight: z.number(),
          cweId: z.string().optional(),
          count: z.number().int().nonnegative(),
          matches: z.array(matchSchema),
        })
        .strict(),
    ),
    branches: z.array(
      z
        .object({
          name: z.enum([
            "static",
            "ruleReview",
            "singleFileAnalysis",
            "multiFileAnalysis",
          ]),
          status: z.enum(["complete", "skipped", "failed"]),
          detail: z.string().optional(),
        })
        .strict(),
    ),
    skippedFiles: z.array(
      z
        .object({
          path: z.string(),
          reasonCode: z.enum([
            "unavailable",
            "symlink",
            "depth-limit",
            "file-limit",
            "skill-size-limit",
            "file-size-limit",
            "binary",
            "scanner-skip",
          ]),
          reason: z.string(),
        })
        .strict(),
    ),
    tokenUsage: tokenUsageSchema.optional(),
  })
  .strict();

const historySchema = z.array(
  z
    .object({
      id: z.string(),
      scanId: z.string().regex(/^scan:/u),
      skillRef: z.string().regex(/^skill:/u),
      skillName: z.string(),
      mode: modeSchema,
      trigger: triggerSchema,
      locale: localeSchema,
      status: z.enum(["complete", "partial", "failed", "skipped", "cancelled"]),
      startedAt: z.string(),
      finishedAt: z.string(),
      report: reportSchema.optional(),
      errorCode: z.string().optional(),
    })
    .strict(),
);

const scanCycleSchema = z.enum(["hourly", "daily", "weekly"]);

const scanScheduleSchema = z
  .object({
    enabled: z.boolean(),
    cycle: scanCycleSchema,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
    scope: z.enum(["all", "agent", "dir"]),
    notify: z.boolean(),
    agents: z.array(z.string()),
    dir: z.string().nullable(),
  })
  .strict();

const scanRunSchema = z
  .object({
    scanId: z.string().regex(/^scan:/u),
    mode: modeSchema,
    trigger: triggerSchema,
    locale: localeSchema,
    status: z.enum([
      "queued",
      "running",
      "complete",
      "partial",
      "failed",
      "cancelled",
    ]),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    discoveredCount: z.number().int().nonnegative(),
    queuedCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    errorCode: z.string().optional(),
    ruleVersion: z.string().optional(),
  })
  .strict();

const scanScheduleStatusSchema = z
  .object({
    lastRun: scanRunSchema.nullable(),
    nextRunAt: z.string().nullable(),
    pending: z.boolean(),
  })
  .strict();

const scanStartSchema = z
  .object({
    scope: z.enum(["single", "all"]),
    skillRef: z
      .string()
      .regex(/^skill:/u)
      .optional(),
    skillName: z.string().trim().min(1).max(160).optional(),
    mode: modeSchema,
    trigger: z.literal("manual").optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.scope === "single" &&
      value.skillRef == null &&
      value.skillName == null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "single scan requires skillRef or skillName",
      });
    }
    if (
      value.scope === "all" &&
      (value.skillRef != null || value.skillName != null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "all scan cannot include skillRef",
      });
    }
  });

const runtimeSchema = z
  .object({
    capability: z.literal("detection-only"),
    activeDefense: z.literal(false),
    monitorAvailable: z.literal(true),
    evidence: z.literal("local-static-and-model-analysis"),
    cancellation: z.literal("between-skills"),
    riskKinds: z.array(riskKindSchema),
  })
  .strict();

const errorSchema = z
  .object({ error: z.object({ code: z.string() }).strict() })
  .strict();

export class CompanionSecurityClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "CompanionSecurityClientError";
  }
}

export function isCompanionOrigin(location: BrowserLocation): boolean {
  if (location.protocol !== "http:") return false;
  const hostname = location.hostname.toLowerCase();
  // Loopback only. `localhost` is accepted alongside `127.0.0.1` so the browser
  // dev server (which often binds/prints `localhost`) can reach the companion
  // API; both names resolve to the loopback interface, and the server side
  // (Electron `local-web-server.ts` / the dev handler) still enforces its own
  // capability token / Origin+CSRF gates for mutations.
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  );
}

async function parseResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CompanionSecurityClientError(
      "security.http.invalid_response",
      response.status,
    );
  }
  if (!response.ok) {
    const error = errorSchema.safeParse(payload);
    throw new CompanionSecurityClientError(
      error.success ? error.data.error.code : "security.http.request_failed",
      response.status,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new CompanionSecurityClientError(
      "security.http.invalid_response",
      response.status,
    );
  }
  return parsed.data;
}

function createCompanionClient(
  fetchFn: FetchLike,
  initialCapability: SecurityRuntimeCapability,
): SecurityClient {
  let capability = initialCapability;

  const request = async <T>(
    route: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> => {
    const mutation = body !== undefined;
    const response = await fetchFn(`${API_PREFIX}${route}`, {
      method: mutation ? "POST" : "GET",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(mutation
          ? {
              "Content-Type": "application/json",
              [SECURITY_CSRF_HEADER]: CSRF_VALUE,
            }
          : {}),
      },
      ...(mutation ? { body: JSON.stringify(body) } : {}),
    });
    return parseResponse(response, schema);
  };

  return {
    transport: "companion",
    supportsDirectorySelection: false,
    async listSkills() {
      return (await request("/skills", z.array(skillSchema))).map((skill) => ({
        ...skill,
      }));
    },
    async selectSkillDirectory() {
      return null;
    },
    async startScan(input: SecurityScanStartRequest) {
      const requestBody = scanStartSchema.parse(input);
      return stateView(
        (await request(
          "/start",
          stateSchema,
          requestBody,
        )) as SecurityScanState,
      );
    },
    async getStatus() {
      return stateView(
        (await request("/status", stateSchema)) as SecurityScanState,
      );
    },
    async getHistory() {
      return (
        (await request("/history", historySchema)) as SecurityScanHistoryEntry[]
      ).map(historyView);
    },
    async cancelScan() {
      return (
        await request(
          "/cancel",
          z.object({ cancelled: z.boolean() }).strict(),
          {},
        )
      ).cancelled;
    },
    async getScanSchedule() {
      return (await request(
        "/scan-schedule",
        scanScheduleSchema,
      )) as SecurityScanScheduleView;
    },
    async getScanScheduleStatus() {
      return (await request(
        "/scan-schedule-status",
        scanScheduleStatusSchema,
      )) as SecurityScanScheduleStatusView;
    },
    async setScanSchedule(schedule: SecurityScanScheduleView) {
      const requestBody = scanScheduleSchema.parse(schedule);
      return (await request(
        "/scan-schedule",
        scanScheduleSchema,
        requestBody,
      )) as SecurityScanScheduleView;
    },
    async getRuntimeCapability() {
      capability = (await request(
        "/capability",
        runtimeSchema,
      )) as SecurityRuntimeCapability;
      return { ...capability } satisfies SecurityRuntimeCapabilityView;
    },
  };
}

export async function connectBrowserSecurityClient(options: {
  readonly location: BrowserLocation;
  readonly fetchFn: FetchLike;
}): Promise<SecurityClient | null> {
  if (!isCompanionOrigin(options.location)) return null;
  try {
    const response = await options.fetchFn(`${API_PREFIX}/capability`, {
      method: "GET",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const capability = (await parseResponse(
      response,
      runtimeSchema,
    )) as SecurityRuntimeCapability;
    return createCompanionClient(options.fetchFn, capability);
  } catch {
    return null;
  }
}

export async function getBrowserSecurityClient(): Promise<SecurityClient | null> {
  if (typeof window === "undefined") return null;
  return connectBrowserSecurityClient({
    location: window.location,
    fetchFn: window.fetch.bind(window),
  });
}

export const browserClientTestKit = {
  reportSchema: reportSchema as z.ZodType<SecurityScanReportDto>,
  skillSchema: skillSchema as z.ZodType<SecuritySkillTarget>,
};
