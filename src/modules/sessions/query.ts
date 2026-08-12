import { createServerFn } from "@tanstack/react-start";

import { AppError } from "../../lib/errors.ts";
import { PUBLIC_TOOL_MANIFEST } from "../../lib/tool-registry/public-manifest.generated.ts";
import type {
  SessionFilter,
  SessionSortDirection,
  SessionSortField,
  SessionStatus,
} from "./contracts.ts";
import type {
  ResumeSessionInput,
  SessionDetailInput,
  SessionsPageInput,
} from "./api.server.ts";

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SESSION_SOURCES = new Set(
  PUBLIC_TOOL_MANIFEST.tools
    .filter((tool) => tool.capabilities.sessions === "resume")
    .map((tool) => tool.id),
);
const RANGE_VALUES = new Set<NonNullable<SessionFilter["range"]>>([
  "all",
  "7d",
  "30d",
  "90d",
]);
const STATUS_VALUES = new Set<SessionStatus>([
  "available",
  "interrupted",
  "lost",
  "unavailable",
]);
const SORT_FIELDS = new Set<SessionSortField>([
  "startedAt",
  "endedAt",
  "durationMs",
  "totalTokens",
]);
const SORT_DIRECTIONS = new Set<SessionSortDirection>(["asc", "desc"]);
const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

function record(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    throw new AppError("errors.sessions.filterInvalid");
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new AppError("errors.sessions.filterInvalid");
}

function optionalText(value: unknown, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value.includes("\0")
  )
    throw new AppError("errors.sessions.filterInvalid");
  const normalized = value.trim();
  return normalized || undefined;
}

function positiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maximum
  )
    throw new AppError("errors.sessions.filterInvalid");
  return value as number;
}

function parseFilter(value: unknown): SessionFilter {
  if (value === undefined) return {};
  const input = record(value);
  onlyKeys(input, ["source", "projectId", "range", "keyword", "status"]);

  const source = optionalText(input.source, 80);
  const projectId = optionalText(input.projectId, 120);
  const keyword = optionalText(input.keyword, 160);
  if (source !== undefined && !SESSION_SOURCES.has(source))
    throw new AppError("errors.sessions.filterInvalid");
  const range = input.range;
  if (
    range !== undefined &&
    (typeof range !== "string" ||
      !RANGE_VALUES.has(range as NonNullable<SessionFilter["range"]>))
  )
    throw new AppError("errors.sessions.filterInvalid");
  const status = input.status;
  if (
    status !== undefined &&
    (typeof status !== "string" || !STATUS_VALUES.has(status as SessionStatus))
  )
    throw new AppError("errors.sessions.filterInvalid");

  return {
    ...(source === undefined ? {} : { source }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(range === undefined ? {} : { range: range as SessionFilter["range"] }),
    ...(keyword === undefined ? {} : { keyword }),
    ...(status === undefined ? {} : { status: status as SessionStatus }),
  };
}

/** Exposed for route tests; returns only a renderer-safe query contract. */
export function validateSessionsPageInput(value: unknown): SessionsPageInput {
  const input = value === undefined ? {} : record(value);
  onlyKeys(input, ["filter", "page", "pageSize", "sort"]);
  const sortInput = input.sort === undefined ? {} : record(input.sort);
  onlyKeys(sortInput, ["field", "direction"]);
  const field = sortInput.field ?? "startedAt";
  const direction = sortInput.direction ?? "desc";
  if (typeof field !== "string" || !SORT_FIELDS.has(field as SessionSortField))
    throw new AppError("errors.sessions.filterInvalid");
  if (
    typeof direction !== "string" ||
    !SORT_DIRECTIONS.has(direction as SessionSortDirection)
  )
    throw new AppError("errors.sessions.filterInvalid");
  return {
    filter: parseFilter(input.filter),
    page: positiveInteger(input.page, 1, 1_000_000),
    pageSize: positiveInteger(input.pageSize, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX),
    sort: {
      field: field as SessionSortField,
      direction: direction as SessionSortDirection,
    },
  };
}

function validateSessionDetailInput(value: unknown): SessionDetailInput {
  const input = record(value);
  onlyKeys(input, ["sessionId"]);
  if (
    typeof input.sessionId !== "string" ||
    !SAFE_SESSION_ID.test(input.sessionId)
  )
    throw new AppError("errors.sessions.filterInvalid");
  return { sessionId: input.sessionId };
}

function validateResumeSessionInput(value: unknown): ResumeSessionInput {
  const input = record(value);
  onlyKeys(input, ["source", "sessionId"]);
  if (
    typeof input.source !== "string" ||
    !SESSION_SOURCES.has(input.source) ||
    typeof input.sessionId !== "string" ||
    !SAFE_SESSION_ID.test(input.sessionId)
  ) {
    throw new AppError("errors.sessions.filterInvalid");
  }
  return { source: input.source, sessionId: input.sessionId };
}

/** Browser-safe server-function facade for paged local-session queries. */
export const getSessionsQuery = createServerFn({ method: "GET" })
  .validator(validateSessionsPageInput)
  .handler(async ({ data }) => {
    const { loadSessionsPage } = await import("./api.server.ts");
    return loadSessionsPage(data);
  });

/** Refresh is explicit for UI feedback; it runs the same real scanner query. */
export const refreshSessionsQuery = createServerFn({ method: "POST" })
  .validator(validateSessionsPageInput)
  .handler(async ({ data }) => {
    const { loadSessionsPage } = await import("./api.server.ts");
    return loadSessionsPage(data);
  });

export const getSessionDetailQuery = createServerFn({ method: "GET" })
  .validator(validateSessionDetailInput)
  .handler(async ({ data }) => {
    const { loadSessionDetail } = await import("./api.server.ts");
    return loadSessionDetail(data);
  });

/** Starts the constrained server-side recovery path; no command data is returned. */
export const resumeSession = createServerFn({ method: "POST" })
  .validator(validateResumeSessionInput)
  .handler(async ({ data }) => {
    const { resumeLocalSession } = await import("./api.server.ts");
    return resumeLocalSession(data);
  });
