import { err, ok, type Result } from "../../../shared/result.ts";
import type {
  SessionFilter,
  SessionPage,
  SessionPageRequest,
  SessionQueryPort,
  SessionRepository,
  SessionSummary,
} from "../contracts.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_PAGE_SIZE = 100;

function matches(
  session: SessionSummary,
  filter: SessionFilter,
  now: number,
): boolean {
  if (filter.source && session.source !== filter.source) return false;
  if (filter.status && session.status !== filter.status) return false;
  if (filter.projectId && session.projectKey !== filter.projectId) return false;
  if (filter.range && filter.range !== "all") {
    const days = filter.range === "7d" ? 7 : filter.range === "30d" ? 30 : 90;
    const started = Date.parse(session.startedAt);
    if (!Number.isFinite(started) || started < now - days * DAY_MS)
      return false;
  }
  if (filter.keyword) {
    const needle = filter.keyword.toLocaleLowerCase();
    // The id is a validated opaque public identifier, so including it enables
    // a direct detail lookup without giving the transport access to raw files.
    const haystack = [
      session.sessionId,
      session.title,
      session.model ?? "",
      session.projectKey,
    ]
      .join(" ")
      .toLocaleLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function compare(
  a: SessionSummary,
  b: SessionSummary,
  request: SessionPageRequest,
): number {
  const field = request.sort?.field ?? "startedAt";
  const direction = request.sort?.direction === "asc" ? 1 : -1;
  const left =
    field === "totalTokens"
      ? a.totals.totalTokens
      : field === "durationMs"
        ? a.durationMs
        : Date.parse(field === "endedAt" ? a.endedAt : a.startedAt);
  const right =
    field === "totalTokens"
      ? b.totals.totalTokens
      : field === "durationMs"
        ? b.durationMs
        : Date.parse(field === "endedAt" ? b.endedAt : b.startedAt);
  return (left - right) * direction;
}

export function createSessionQueryService(
  repository: SessionRepository,
): SessionQueryPort {
  return {
    async query(request = {}): Promise<Result<SessionPage>> {
      if (request.signal?.aborted)
        return err("errors.sessions.resumeCancelled");
      const page = Math.max(1, Math.trunc(request.page ?? 1));
      const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, Math.trunc(request.pageSize ?? 25)),
      );
      const all = [...(await repository.list(request.signal))];
      const now = Date.now();
      const filtered = all.filter((item) =>
        matches(item, request.filter ?? {}, now),
      );
      filtered.sort((a, b) => compare(a, b, request));
      const start = (page - 1) * pageSize;
      return ok({
        generatedAt: new Date().toISOString(),
        sessions: filtered.slice(start, start + pageSize),
        total: filtered.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
        sources: [...new Set(all.map((item) => item.source))].sort(),
      });
    },
  };
}
