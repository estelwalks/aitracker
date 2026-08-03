import type { SessionSource } from "./types.ts";

/**
 * Shell-safe alphabet for resume ids. Matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`.
 * Anything outside this set is treated as untrusted: `resumeSafe=false` and no
 * resume command is emitted (defense against path/command injection).
 */
const RESUME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** Bare resume command template per source (no `cd` prefix — the UI composes that). */
const RESUME_COMMAND_TEMPLATE: Record<SessionSource, string> = {
  "claude-code": "claude --resume",
  codex: "codex resume",
  grok: "grok --resume",
};

export function isResumeSafeId(value: string): boolean {
  return RESUME_ID_PATTERN.test(value);
}

export function buildResumeCommand(
  source: SessionSource,
  sessionId: string,
): string | null {
  if (!isResumeSafeId(sessionId)) return null;
  return `${RESUME_COMMAND_TEMPLATE[source]} ${sessionId}`;
}
