/**
 * Platform-layer privacy guard (Story S-04, T-04-04).
 *
 * Pure validation functions that Repository implementations MUST run before
 * persisting into `app_preferences` and `insight_enhancement_lines`. They
 * enforce the architecture's content "forbidden zones" (§9-4 / §14.4): no
 * secrets, no absolute paths, no commands, no transcript bodies and no prompt
 * injection may ever reach the database. Unsafe input throws
 * `DatabaseError("invalid-argument", "write")`; the caller owns the write.
 *
 * Naming is deliberately conservative. A preference key or JSON value path is
 * rejected when it *names* a sensitive identifier (secret / apiKey / token /
 * authorization / … — case-insensitive, camelCase-aware). This means a key
 * such as `tokenUsage` is also refused even though it is not itself a secret;
 * the cost of a false positive is a developer-time rename, while a false
 * negative would let a credential reach storage. Absolute-path detection is
 * scoped to drive letters (`C:\`), UNC (`\\server`), and the common Unix
 * roots (`/Users/`, `/home/`, …) so relative `~/…` display paths still pass.
 */
import { DatabaseError } from "./contracts.ts";

/** Upper bound for one serialized preference JSON document (UTF-16 units). */
const MAX_PREFERENCE_JSON_LENGTH = 64 * 1024;
/** Upper bound for a single insight-analysis line. */
const MAX_ANALYSIS_LENGTH = 2000;
/** Upper bound for a preference key. */
const MAX_PREFERENCE_KEY_LENGTH = 128;
/** Nesting depth guard for preference values. */
const MAX_PREFERENCE_DEPTH = 16;

/**
 * Sensitive identifiers checked as normalized substrings: the lowercased text
 * is stripped of every non-alphanumeric character first, so `apiKey`,
 * `api-key`, `API_KEY` and `api_key` all collapse to `apikey`.
 */
const SENSITIVE_SQUASHED = [
  "secret",
  "apikey",
  "apitoken",
  "accesstoken",
  "authtoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "authorization",
  "authorisation",
  "password",
  "passwd",
  "credential",
  "privatekey",
  "accesskey",
  "clientsecret",
  "bearer",
  "sessionkey",
];

/** Broad-but-listable words matched as standalone tokens. */
const SENSITIVE_TOKENS = new Set(["token", "tokens", "auth"]);

/** Absolute-path shapes that must never be persisted (architecture §9-3). */
const PATH_MARKERS = [
  /(?:^|[^\w])[a-z]:[\\/]/i, // Windows drive: C:\ or C:/
  /(?:^|[^\w])\\{2}[a-z]/i, // UNC: \\server
  /(?:^|[^\w])\/(?:Users|home|etc|var|tmp|opt|usr|root)\//i, // Unix roots
];

/** Command / shell keywords that mark executable intent. */
const COMMAND_MARKERS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bpowershell\b/i,
  /\binvoke-(expression|webrequest|command|item)\b/i,
  /\bcmd(\.exe)?\b/i,
  /\bbash\s+-c\b/i,
  /\bsh\s+-c\b/i,
  /\bdeltree\b/i,
  /\bshutdown\b/i,
  /\bnc\s+-[a-z]*e\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
];

/** Conversation-role markers that identify a transcript body. */
const TRANSCRIPT_MARKERS = [
  /\b(system|user|assistant|human|ai|tool)\s*:\s*/i,
  /"role"\s*:/i,
];

/** Prompt-injection signals. */
const INJECTION_MARKERS = [
  /ignore\s+(all\s+)?(previous|prior|above|your)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above|your)\s+instructions/i,
  /\bsystem\s+prompt\b/i,
  /\bjailbreak\b/i,
];

function unsafe(message: string): never {
  throw new DatabaseError("invalid-argument", "write", {
    cause: new Error(message),
    retryable: false,
  });
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Splits on separators and camelCase boundaries for word-token matching. */
function wordTokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when the identifier text names a secret/credential. */
function containsSensitiveIdentifier(text: string): boolean {
  const squashed = squash(text);
  if (SENSITIVE_SQUASHED.some((identifier) => squashed.includes(identifier))) {
    return true;
  }
  return wordTokens(text).some((token) => SENSITIVE_TOKENS.has(token));
}

/** True when the string looks like an actual secret value (not just a name). */
function looksLikeSecretValue(text: string): boolean {
  return (
    /bearer\s+[a-z0-9._~+/=-]{8,}/i.test(text) ||
    /\bsk-[a-z0-9_-]{16,}/i.test(text) ||
    /\bghp_[a-z0-9]{20,}/i.test(text) ||
    /\bgho_[a-z0-9]{20,}/i.test(text) ||
    /\bgithub_pat_[a-z0-9_]{20,}/i.test(text) ||
    /\bxox[bpas]-[a-z0-9-]{10,}/i.test(text) ||
    /\bakia[a-z0-9]{16,}/i.test(text) ||
    /\baiza[a-z0-9_-]{20,}/i.test(text) ||
    /-----BEGIN [a-z ]*PRIVATE KEY-----/i.test(text) ||
    /\beyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/i.test(text)
  );
}

/** One-word reason why the string is forbidden, or `undefined` when safe. */
function findForbiddenTextIssue(text: string): string | undefined {
  if (looksLikeSecretValue(text)) return "secret-shaped value";
  if (/(?:^|[^\w])(?:https?|ftp):\/\//i.test(text)) return "url";
  for (const marker of PATH_MARKERS) {
    if (marker.test(text)) return "absolute path";
  }
  for (const marker of COMMAND_MARKERS) {
    if (marker.test(text)) return "command";
  }
  for (const marker of TRANSCRIPT_MARKERS) {
    if (marker.test(text)) return "transcript body";
  }
  for (const marker of INJECTION_MARKERS) {
    if (marker.test(text)) return "prompt injection";
  }
  return undefined;
}

/** Walks a JSON value: rejects sensitive object keys and forbidden strings. */
function walkForbidden(value: unknown, depth = 0): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      const issue = findForbiddenTextIssue(value);
      if (issue !== undefined) unsafe(`preference value contains ${issue}`);
    }
    return;
  }
  if (depth > MAX_PREFERENCE_DEPTH) unsafe("preference value nesting too deep");
  if (Array.isArray(value)) {
    for (const item of value) walkForbidden(item, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (containsSensitiveIdentifier(key)) {
      unsafe("preference value key names a sensitive identifier");
    }
    walkForbidden(child, depth + 1);
  }
}

/**
 * Validates a value destined for `app_preferences`. The key must be a
 * non-empty, bounded, non-sensitive identifier; the value must be
 * JSON-serializable, size/depth bounded, and free of secret-shaped strings,
 * sensitive object keys, absolute paths, commands, transcript bodies and
 * prompt injection.
 */
export function assertAppPreferenceValueSafe(
  key: string,
  value: unknown,
): void {
  if (typeof key !== "string" || key.trim() === "") {
    unsafe("preference key must be a non-empty string");
  }
  if (key.length > MAX_PREFERENCE_KEY_LENGTH) {
    unsafe("preference key exceeds the length limit");
  }
  if (containsSensitiveIdentifier(key)) {
    unsafe("preference key names a sensitive identifier");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    unsafe("preference value is not JSON-serializable");
  }
  if (serialized === undefined) {
    unsafe("preference value is not JSON-serializable");
  }
  if (serialized.length > MAX_PREFERENCE_JSON_LENGTH) {
    unsafe("preference value exceeds the size limit");
  }
  walkForbidden(value);
}

/**
 * Validates a single-line `analysis` value destined for
 * `insight_enhancement_lines`. Rejects empty/whitespace, oversized or
 * multi-line text, bare numbers, and any URL / absolute path / command /
 * transcript / injection / secret-shaped content.
 */
export function assertInsightLineAnalysisSafe(text: string): void {
  if (typeof text !== "string") unsafe("analysis must be a string");
  if (text.trim() === "") unsafe("analysis must not be empty");
  if (text.length > MAX_ANALYSIS_LENGTH)
    unsafe("analysis exceeds the length limit");
  if (/[\r\n]/.test(text)) unsafe("analysis must be single-line");
  if (/^\s*[\d\s,.]+\s*$/.test(text))
    unsafe("analysis must not be a bare number");
  const issue = findForbiddenTextIssue(text);
  if (issue !== undefined) unsafe(`analysis contains ${issue}`);
}
