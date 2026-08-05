import { createServerFn } from "@tanstack/react-start";

import { AppError } from "../errors";

import type {
  SessionFilter,
  SessionSource,
  SessionStatus,
  SessionSummary,
} from "./types.ts";

const ALLOWED_SOURCES: readonly SessionSource[] = [
  "claude-code",
  "codex",
  "grok",
];
const ALLOWED_RANGES: readonly SessionFilter["range"][] = [
  "all",
  "7d",
  "30d",
  "90d",
];
const ALLOWED_STATUSES: readonly SessionStatus[] = [
  "available",
  "interrupted",
  "lost",
  "unavailable",
];
const DAY_IN_MS = 24 * 60 * 60 * 1_000;
const RANGE_DAYS: Record<NonNullable<SessionFilter["range"]>, number> = {
  all: Number.POSITIVE_INFINITY,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const sessionFilterValidator = (input: unknown): SessionFilter => {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("errors.sessions.filterInvalid");
  }
  const value = input as Record<string, unknown>;
  const source =
    typeof value.source === "string" &&
    (ALLOWED_SOURCES as readonly string[]).includes(value.source)
      ? (value.source as SessionSource)
      : undefined;
  const projectId =
    typeof value.projectId === "string" && value.projectId.length > 0
      ? value.projectId
      : undefined;
  const range =
    typeof value.range === "string" &&
    (ALLOWED_RANGES as readonly string[]).includes(value.range)
      ? (value.range as SessionFilter["range"])
      : undefined;
  const keyword =
    typeof value.keyword === "string" && value.keyword.length > 0
      ? value.keyword
      : undefined;
  const status =
    typeof value.status === "string" &&
    (ALLOWED_STATUSES as readonly string[]).includes(value.status)
      ? (value.status as SessionStatus)
      : undefined;
  const filter: SessionFilter = {};
  if (source != null) filter.source = source;
  if (projectId != null) filter.projectId = projectId;
  if (range != null) filter.range = range;
  if (keyword != null) filter.keyword = keyword;
  if (status != null) filter.status = status;
  return filter;
};

function filterSessions(
  summary: SessionSummary,
  filter: SessionFilter,
  now: Date,
): SessionSummary {
  const cutoff =
    filter.range != null && filter.range !== "all"
      ? now.getTime() - RANGE_DAYS[filter.range] * DAY_IN_MS
      : Number.NEGATIVE_INFINITY;
  const keyword =
    filter.keyword != null ? filter.keyword.toLowerCase() : undefined;
  const sessions = summary.sessions.filter((session) => {
    if (filter.source != null && session.source !== filter.source) {
      return false;
    }
    if (filter.status != null && session.status !== filter.status) {
      return false;
    }
    if (
      filter.projectId != null &&
      session.projectKey !== filter.projectId &&
      session.projectRef !== filter.projectId
    ) {
      return false;
    }
    if (cutoff !== Number.NEGATIVE_INFINITY) {
      const startedAt = Date.parse(session.startedAt);
      if (Number.isNaN(startedAt) || startedAt < cutoff) return false;
    }
    if (keyword != null) {
      const haystack = [
        session.title,
        session.model ?? "",
        session.projectKey,
        session.projectRef,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
  return {
    generatedAt: summary.generatedAt,
    sessions,
    total: sessions.length,
  };
}

export const getLocalSessions = createServerFn({ method: "GET" })
  .validator(sessionFilterValidator)
  .handler(async ({ data }): Promise<SessionSummary> => {
    const { scanLocalSessions } = await import("./scanner.server.ts");
    const summary = await scanLocalSessions();
    return filterSessions(summary, data, new Date());
  });

export const refreshLocalSessions = createServerFn({ method: "POST" })
  .validator(sessionFilterValidator)
  .handler(async ({ data }): Promise<SessionSummary> => {
    const { scanLocalSessions } = await import("./scanner.server.ts");
    const summary = await scanLocalSessions();
    return filterSessions(summary, data, new Date());
  });
