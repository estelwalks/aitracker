import {
  buildResumeCommand,
  isResumeSafeId,
} from "../../../lib/local-sessions/resume-id.ts";
import { scanLocalSessions } from "../../../lib/local-sessions/scanner.server.ts";
import type { SessionRecord } from "../../../lib/local-sessions/types.ts";
import { err, ok, type Result } from "../../../shared/result.ts";
import type {
  ResumeSessionErrorCode,
  ResumeSessionPort,
  ResumeSessionRequest,
  ResumeSessionResult,
  SessionRepository,
  SessionSummary,
} from "../contracts.ts";

export function toPublicSession(record: SessionRecord): SessionSummary {
  return {
    sessionId: record.sessionId,
    source: record.source,
    title: record.title,
    projectKey: record.projectKey,
    model: record.model,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: record.durationMs,
    turns: record.turns,
    editTurns: record.editTurns,
    retryTurns: record.retryTurns,
    totals: record.totals,
    cost: record.cost,
    subagentCalls: record.subagentCalls,
    status: record.status,
    statusReason: record.statusReason,
    resumeAvailable: record.resumeSafe,
  };
}

export function createLegacySessionRepository(): SessionRepository {
  return {
    async list(signal) {
      if (signal?.aborted) return [];
      const summary = await scanLocalSessions();
      return summary.sessions.map(toPublicSession);
    },
  };
}

export interface ResumeCommandExecutor {
  execute(command: readonly string[], signal?: AbortSignal): Promise<void>;
}

export interface LegacySessionScan {
  scan(): Promise<readonly SessionRecord[]>;
}

export interface LegacyResumeSessionPortOptions {
  readonly scanner?: LegacySessionScan;
}

/** Server-only adapter. Commands and cwd never appear in ResumeSessionResult. */
export function createLegacyResumeSessionPort(
  executor: ResumeCommandExecutor,
  options: LegacyResumeSessionPortOptions = {},
): ResumeSessionPort {
  const scanner = options.scanner ?? {
    scan: async () => (await scanLocalSessions()).sessions,
  };
  return {
    async resume(
      request: ResumeSessionRequest,
    ): Promise<Result<ResumeSessionResult, ResumeSessionErrorCode>> {
      if (request.signal?.aborted)
        return err("errors.sessions.resumeCancelled");
      if (!isResumeSafeId(request.sessionId))
        return err("errors.sessions.resumeInvalid");
      const records = await scanner.scan();
      const record = records.find(
        (item) =>
          item.source === request.source &&
          item.sessionId === request.sessionId,
      );
      const command = record
        ? buildResumeCommand(record.source, record.sessionId)
        : null;
      if (!record || !command || !record.resumeSafe)
        return err("errors.sessions.resumeUnavailable");
      try {
        await executor.execute(command.split(" "), request.signal);
        return ok({
          accepted: true,
          source: request.source,
          sessionId: request.sessionId,
        });
      } catch {
        return err(
          request.signal?.aborted
            ? "errors.sessions.resumeCancelled"
            : "errors.sessions.resumeFailed",
        );
      }
    },
  };
}
