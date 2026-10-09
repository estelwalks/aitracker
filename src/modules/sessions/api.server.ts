import { AppError } from "../../lib/errors.ts";
import type {
  ResumeSessionResult,
  SessionFilter,
  SessionPage,
  SessionPageRequest,
  SessionSortDirection,
  SessionSortField,
  SessionSummary,
  SessionTranscript,
  SessionExport,
} from "./contracts.ts";

/** Renderer-safe page request after the transport validator has normalized it. */
export interface SessionsPageInput {
  readonly filter: SessionFilter;
  readonly page: number;
  readonly pageSize: number;
  readonly sort: {
    readonly field: SessionSortField;
    readonly direction: SessionSortDirection;
  };
}

/** A detail lookup is intentionally limited to a safe opaque session id. */
export interface SessionDetailInput {
  readonly sessionId: string;
}

export interface ResumeSessionInput {
  readonly source: string;
  readonly sessionId: string;
}

/** Transcript lookup — source + sessionId only, validated by the transport. */
export interface TranscriptInput {
  readonly source: string;
  readonly sessionId: string;
}

export interface SessionsExportInput {
  readonly sessions?: readonly {
    readonly source: string;
    readonly sessionId: string;
  }[];
}

function requestFor(input: SessionsPageInput): SessionPageRequest {
  return {
    filter: input.filter,
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort,
  };
}

async function sessionsPort() {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  return (await getCompositionRoot()).sessions;
}

/** Loads one privacy-safe, filtered page from the real local scanner. */
export async function loadSessionsPage(
  input: SessionsPageInput,
): Promise<SessionPage> {
  try {
    const result = await (await sessionsPort()).query(requestFor(input));
    if (!result.ok) throw new AppError("errors.sessions.queryFailed");
    return result.value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("errors.sessions.queryFailed");
  }
}

/** Runs the real session collector before returning the refreshed page. */
export async function refreshSessionsPage(
  input: SessionsPageInput,
): Promise<SessionPage> {
  try {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();
    await root.sessionSnapshot.requestRefresh({ reason: "manual" });
    return await loadSessionsPage(input);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("errors.sessions.queryFailed");
  }
}

/**
 * Finds one session through the public query port. The scanner/query service
 * remains the authority; this transport never reads a session file directly.
 */
export async function loadSessionDetail(
  input: SessionDetailInput,
): Promise<SessionSummary | null> {
  try {
    const query = await (
      await sessionsPort()
    ).query({
      filter: { keyword: input.sessionId },
      page: 1,
      pageSize: 100,
      sort: { field: "endedAt", direction: "desc" },
    });
    if (!query.ok) throw new AppError("errors.sessions.queryFailed");
    return (
      query.value.sessions.find(
        (session) => session.sessionId === input.sessionId,
      ) ?? null
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("errors.sessions.queryFailed");
  }
}

/**
 * Starts recovery through the composition root's server-only port. Its result
 * contains only accepted/source/sessionId — never a command, cwd, path, or
 * any conversation data.
 */
export async function resumeLocalSession(
  input: ResumeSessionInput,
): Promise<ResumeSessionResult> {
  try {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();
    const result = await root.resumeSession.resume(input);
    if (!result.ok) throw new AppError(result.error.code);
    return result.value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("errors.sessions.resumeFailed");
  }
}

/**
 * Loads one session's local transcript for the CURRENT page render only.
 * The transcript reader runs server-side; messages are held in memory and
 * serialized into this page's response — they are never persisted to any
 * store and never uploaded (S-300 privacy boundary).
 */
export async function loadSessionTranscript(
  input: TranscriptInput,
): Promise<SessionTranscript> {
  try {
    const { readSessionContent } =
      await import("./infrastructure/session-content-reader.server.ts");
    return await readSessionContent(input);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("errors.sessions.transcriptUnavailable");
  }
}

async function loadAllSessions(): Promise<readonly SessionSummary[]> {
  const port = await sessionsPort();
  const results: SessionSummary[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await port.query({
      page,
      pageSize: 100,
      sort: { field: "endedAt", direction: "desc" },
    });
    if (!result.ok) throw new AppError("errors.sessions.queryFailed");
    results.push(...result.value.sessions);
    totalPages = result.value.totalPages;
    page += 1;
  } while (page <= totalPages);
  return results;
}

/** Export selected sessions or the complete local session snapshot. */
export async function exportSessions(
  input: SessionsExportInput,
): Promise<SessionExport> {
  try {
    const sessions = await loadAllSessions();
    const selected = input.sessions;
    const key = (source: string, sessionId: string) =>
      `${source}\u0000${sessionId}`;
    const selectedKeys =
      selected == null
        ? null
        : new Set(selected.map((item) => key(item.source, item.sessionId)));
    const targets = sessions.filter(
      (session) =>
        selectedKeys == null ||
        selectedKeys.has(key(session.source, session.sessionId)),
    );
    const entries: SessionExport["sessions"][number][] = [];
    // Read transcripts one at a time. The final JSON still contains every
    // requested session, but this avoids opening and parsing the entire local
    // corpus concurrently during a full export.
    for (const summary of targets) {
      let transcript: SessionTranscript | null = null;
      try {
        transcript = await loadSessionTranscript({
          source: summary.source,
          sessionId: summary.sessionId,
        });
      } catch {
        // A stale/deleted local log should not prevent the remaining export.
      }
      entries.push({ summary, transcript });
    }
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      sessions: entries,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("errors.sessions.queryFailed");
  }
}
