import type { SessionSource } from "./types.ts";
import { getSessionPlan } from "../tool-registry/registry.ts";

/**
 * Shell-safe alphabet for resume ids. Matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`.
 * Anything outside this set is treated as untrusted: `resumeSafe=false` and no
 * resume command is emitted (defense against path/command injection).
 */
const RESUME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function isResumeSafeId(value: string): boolean {
  return RESUME_ID_PATTERN.test(value);
}

/**
 * Build the resume command for a session by substituting the validated session
 * id into the tool config's command token template. The template lives in the
 * tool-registry (server-only; never in the browser bundle) as a token array, so
 * the id is never string-interpolated into an arbitrary shell string - it
 * replaces the literal `{sessionId}` token. The id is validated first; an
 * unsafe id yields `null` (the UI only ever copies, never executes).
 */
export function buildResumeCommand(
  source: SessionSource,
  sessionId: string,
): string | null {
  if (!isResumeSafeId(sessionId)) return null;
  const plan = getSessionPlan(source);
  if (!plan) return null;
  return plan.command
    .map((token) => (token === "{sessionId}" ? sessionId : token))
    .join(" ");
}
