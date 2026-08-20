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
      sort: { field: "startedAt", direction: "desc" },
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
    const { loadSessionTranscript: readTranscript } =
      await import("./infrastructure/transcript-reader.server.ts");
    return await readTranscript(input);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("errors.sessions.transcriptUnavailable");
  }
}
