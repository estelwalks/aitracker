import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

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

export function createSessionRepository(): SessionRepository {
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
   * never accepts a command, cwd, or other launch parameter from a renderer;
   * `cwd` is selected from the scanned local session record.
   */
  execute(request: ResumeCommandRequest, signal?: AbortSignal): Promise<void>;
}

export interface ResumeCommandRequest {
  readonly source: ResumeSessionRequest["source"];
  readonly sessionId: ResumeSessionRequest["sessionId"];
  /** Server-only absolute project directory for the child process, when known. */
  readonly cwd?: string;
}

export interface SessionScan {
  scan(): Promise<readonly SessionRecord[]>;
}

export interface ResumeSessionPortOptions {
  readonly scanner?: SessionScan;
}

function resumeCwdFor(record: SessionRecord): string | null {
  const candidate = record.resumeCwd ?? record.projectRef;
  if (isAbsolute(candidate)) return candidate;

  // Keep compatibility with records created before `resumeCwd` was added.
  // The normal scanner supplies an absolute raw cwd, so this fallback is only
  // for older/test records whose projectRef is already HOME-relative.
  if (candidate === "~") return homedir();
  if (candidate.startsWith("~/")) return join(homedir(), candidate.slice(2));
  return null;
}

/** Server-only adapter. Commands and cwd never appear in ResumeSessionResult. */
export function createSessionResumePort(
  executor: ResumeCommandExecutor,
  options: ResumeSessionPortOptions = {},
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
      const cwd = record == null ? null : resumeCwdFor(record);
      // Claude Code resolves session files relative to the project directory;
      // without the original cwd its `--resume` command cannot target the
      // right local session. Other registered tools can resume by id alone.
      if (
        !record ||
        !record.resumeSafe ||
        (record.source === "claude-code" && cwd == null)
      )
        return err("errors.sessions.resumeUnavailable");
      try {
        await executor.execute(
          {
            source: record.source,
            sessionId: record.sessionId,
            ...(cwd == null ? {} : { cwd }),
          },
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
