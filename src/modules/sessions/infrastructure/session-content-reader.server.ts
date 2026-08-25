/**
 * Unified in-memory session content boundary.
 * Session detail and distillation must use this entry point so source/path
 * resolution and transcript parsing cannot drift between the two features.
 */
import {
  loadSessionTranscript,
  type TranscriptReaderOptions,
} from "./transcript-reader.server.ts";
import type { SessionTranscript } from "../contracts.ts";

export interface SessionContentRef {
  readonly source: string;
  readonly sessionId: string;
}

export async function readSessionContent(
  ref: SessionContentRef,
  options?: TranscriptReaderOptions,
): Promise<SessionTranscript> {
  const primary = await loadSessionTranscript(ref, options);
  if (primary.messages.length > 0) return primary;

  // The metadata scanner and older persisted snapshots can disagree on the
  // source label. Keep the public request source-bound, but make the actual
  // content lookup resilient: a session id must never produce a false empty
  // transcript merely because it was indexed under the other local client.
  const fallbackSources = ["claude-code", "codex"].filter(
    (source) => source !== ref.source,
  );
  for (const source of fallbackSources) {
    const fallback = await loadSessionTranscript(
      { source, sessionId: ref.sessionId },
      options,
    );
    if (fallback.messages.length > 0) return fallback;
  }

  return primary;
}
