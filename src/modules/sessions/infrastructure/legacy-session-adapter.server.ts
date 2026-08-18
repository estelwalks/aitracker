import { isResumeSafeId } from "../../../lib/local-sessions/resume-id.ts";
import { scanLocalSessions } from "../../../lib/local-sessions/scanner.server.ts";
import type { SessionRecord } from "../../../lib/local-sessions/types.ts";
import { err, ok, type Result } from "../../../shared/result.ts";
import { toPublicSession } from "../application/public-projection.ts";
import type {
  ResumeSessionErrorCode,
  ResumeSessionPort,
  ResumeSessionRequest,
  ResumeSessionResult,
  SessionRepository,
} from "../contracts.ts";

export { toPublicSession } from "../application/public-projection.ts";

export function createLegacySessionRepository(): SessionRepository {
  return {
    async list(signal) {
      if (signal?.aborted) return [];
      // P5-T5-03: propagate the signal into the scanner so directory loops and
      // file reads stop promptly on cancellation.
      const summary = await scanLocalSessions({ signal });
      return summary.sessions.map(toPublicSession);
    },
  };
}

export interface ResumeCommandExecutor {
  /**
   * Executes a resume request from a trusted source/session pair. The adapter
   * never accepts a command, cwd, or other launch parameter from a renderer.
   */
  execute(
    request: Pick<ResumeSessionRequest, "source" | "sessionId">,
    signal?: AbortSignal,
  ): Promise<void>;
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
      if (!record || !record.resumeSafe)
        return err("errors.sessions.resumeUnavailable");
      try {
        await executor.execute(
          { source: record.source, sessionId: record.sessionId },
          request.signal,
        );
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
