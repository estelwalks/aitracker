/**
 * Platform-layer privacy guard (Story S-04, T-04-04; hardened in review
 * batch B, findings P1-7 / P1-8).
 *
 * Pure validation functions that Repository implementations MUST run before
 * persisting into `app_preferences` and `insight_enhancement_lines`. They
 * enforce the architecture's content "forbidden zones" (§9-4 / §14.4): no
 * secrets, no absolute paths, no commands, no transcript bodies and no prompt
 * injection may ever reach the database. Unsafe input throws
 * `DatabaseError("invalid-argument", "write")`; the caller owns the write.
 *
 * THREE HARDENING RULES DECIDED BY THE REVIEW:
 *
 * 1. VALIDATE THE PERSISTED REPRESENTATION (P1-7). A value is checked in the
 *    exact shape that reaches `value_json`: `JSON.parse(JSON.stringify(value))`.
 *    Validating the *input object* let a `toJSON()` method return a Bearer token
 *    that the walker never saw. The serialized text is additionally scanned as
 *    one string, so content assembled only by serialization is caught too.
 * 2. NORMALIZE BEFORE MATCHING (P1-8). Identifier and text matching runs on an
 *    NFKC-normalized, homoglyph-folded copy, so `ＡＰＩ＿ＫＥＹ` (fullwidth) and
 *    `аpiKey` (Cyrillic `а`) collapse onto `apikey` instead of slipping past a
 *    plain ASCII comparison.
 * 3. FALSE POSITIVES ARE THE CHEAP FAILURE. Naming is deliberately
 *    conservative: a key or JSON path is rejected when it *names* a sensitive
 *    identifier (`secret` / `apiKey` / `token` / `session` / `pwd` / …), so
 *    `tokenUsage` and `lastSession` are refused as well. The cost is a
 *    developer-time rename; a false negative would put a credential on disk.
 *
 * Absolute-path detection rejects every drive letter (`C:\`, `C:/`, `D:temp`),
 * UNC / escaped backslashes, the documented POSIX roots (`/Users/`, `/home/`,
 * `/mnt/`, `/Applications/`, `/Volumes/`, `/srv/`, …), `%ENV%` expansions and
 * bare POSIX absolute paths. Only the `~/…` display form used by the rest of
 * TrustTools stays allowed.
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
  "passphrase",
  "passwd",
  "credential",
  "privatekey",
  "publickey",
  "accesskey",
  "clientsecret",
  "bearer",
  "sessionkey",
  "signingkey",
  "encryptionkey",
];

/**
 * Broad-but-listable words matched as standalone tokens (after camelCase and
 * separator splitting). `key`, `pat`, `pwd`, `signature`, `cookie` and
 * `session` were added by review finding P1-8: `sessionId`, `userPwd`,
 * `apiKeys` and `pat` all named credentials that the old list accepted.
 */
const SENSITIVE_TOKENS = new Set([
  "token",
  "tokens",
  "auth",
  "key",
  "keys",
  "pat",
  "pats",
  "pwd",
  "signature",
  "signatures",
  "cookie",
  "cookies",
  "session",
  "sessions",
]);

/**
 * Homoglyph folds applied before matching. NFKC alone does NOT fold Cyrillic or
 * Greek look-alikes (`а` U+0430 stays distinct from `a`), which is exactly the
 * bypass the review demonstrated, so the confusable set is explicit. Only the
 * lower-case direction is listed; the upper-case fold is derived, so `А` →`A`
 * and `Α` → `A` come for free.
 */
const CONFUSABLE_LOWER_FOLDS: readonly (readonly [string, string])[] = [
  ["\u0430", "a"], // а CYRILLIC A
  ["\u0432", "b"], // в CYRILLIC VE
  ["\u0435", "e"], // е CYRILLIC IE
  ["\u043A", "k"], // к CYRILLIC KA
  ["\u043C", "m"], // м CYRILLIC EM
  ["\u043D", "h"], // н CYRILLIC EN
  ["\u043E", "o"], // о CYRILLIC O
  ["\u0440", "p"], // р CYRILLIC ER
  ["\u0441", "c"], // с CYRILLIC ES
  ["\u0442", "t"], // т CYRILLIC TE
  ["\u0443", "y"], // у CYRILLIC U
  ["\u0445", "x"], // х CYRILLIC HA
  ["\u0455", "s"], // ѕ CYRILLIC DZE
  ["\u0456", "i"], // і CYRILLIC BYELORUSSIAN-UKRAINIAN I
  ["\u0458", "j"], // ј CYRILLIC JE
  ["\u0501", "d"], // ԁ CYRILLIC KOMI DE
  ["\u03B1", "a"], // α GREEK ALPHA
  ["\u03B2", "b"], // β GREEK BETA
  ["\u03B5", "e"], // ε GREEK EPSILON
  ["\u03B9", "i"], // ι GREEK IOTA
  ["\u03BA", "k"], // κ GREEK KAPPA
  ["\u03BD", "v"], // ν GREEK NU
  ["\u03BF", "o"], // ο GREEK OMICRON
  ["\u03C1", "p"], // ρ GREEK RHO
  ["\u03C4", "t"], // τ GREEK TAU
  ["\u03C5", "u"], // υ GREEK UPSILON
  ["\u03C7", "x"], // χ GREEK CHI
  ["\u0131", "i"], // ı LATIN DOTLESS I
];

const CONFUSABLE_FOLDS: Readonly<Record<string, string>> = buildFoldTable();

function buildFoldTable(): Record<string, string> {
  const table: Record<string, string> = {};
  for (const [from, to] of CONFUSABLE_LOWER_FOLDS) {
    table[from] = to;
    const upperFrom = from.toUpperCase();
    if (upperFrom.length === 1 && upperFrom !== from) {
      table[upperFrom] = to.toUpperCase();
    }
  }
  return table;
}

/** URL shapes, including the scheme-less forms review finding P1-8 listed. */
const URL_MARKERS = [
  /(?:^|[^\w])(?:https?|ftp|ftps|sftp|file|smb|ws|wss|data):\/\//i,
  /(?:^|[^\w])www\.[a-z0-9-]/i,
  // Bare domain with a well-known TLD, e.g. `evil.example.com`, `foo.io`.
  /(?:^|[^\w.])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|io|ai|dev|app|co|cn|me|info|xyz|top|site|gov|edu|cloud|sh)\b/i,
];

/**
 * Absolute-path shapes that must never be persisted (architecture §9-3).
 *
 * The drive-letter rule intentionally does not require a following separator
 * (`D:temp\x` is still a Windows path) and excludes a preceding quote so the
 * JSON key syntax `{"x":1}` is not mistaken for a drive letter during the
 * serialized depth scan. Quoted Windows paths are still caught by the
 * double-backslash rule and by the raw walk over the value's own strings.
 */
const PATH_MARKERS = [
  /(?:^|[^A-Za-z0-9"'])[A-Za-z]:/, // C:\ C:/ D:temp
  /\\{2}/, // UNC \\server, or a JSON-escaped backslash
  /(?:^|[^\w])\/(?:Users|home|etc|var|tmp|opt|usr|root|mnt|media|srv|proc|dev|bin|sbin|Applications|Volumes|Library|System)\//i,
  /%[A-Za-z_][A-Za-z0-9_]{0,64}%/, // %APPDATA%, %USERPROFILE%
  /^\/[^~]/, // bare POSIX absolute path at the start of the text
  /(?:^|[\s"'(=,;:])\/(?![/~])[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]/, // /a/b mid-text
];

/**
 * Command / shell keywords that mark executable intent. `git …`, `npm …` and
 * `del /…` were added by review finding P1-8.
 */
const COMMAND_MARKERS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bpowershell\b/i,
  /\binvoke-(expression|webrequest|command|item)\b/i,
  /\bstart-process\b/i,
  /\bcmd(\.exe)?\b/i,
  /\bbash\s+-c\b/i,
  /\bsh\s+-c\b/i,
  /\bdeltree\b/i,
  /\bshutdown\b/i,
  /\bnc\s+-[a-z]*e\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bgit\s+(?:push|pull|clone|fetch|commit|checkout|reset|remote|rebase)\b/i,
  /\bnpm\s+(?:run|install|ci|exec|publish|test)\b/i,
  /\b(?:npx|pnpm|yarn)\s+[a-z]/i,
  /\bdel\s+[/\\]/i,
  /\bdel\s+[a-z]:/i,
  /\brmdir\s+[/\\]/i,
  /\b(?:ssh|scp|rsync)\s+[a-z0-9@.-]+/i,
  /\btaskkill\b/i,
  /\breg\s+(?:add|delete|query)\b/i,
];

/**
 * Shell metacharacters. Applied to `insight_enhancement_lines.analysis` only:
 * an analysis line is a rendered Chinese/English sentence and never needs a
 * pipe, a command substitution or a backtick, while a preference value may
 * legitimately carry a `|`-separated display string.
 */
const SHELL_METACHARACTER_MARKERS = [
  /\|/, // pipe (incl. `||`)
  /&&/,
  /`/, // backtick / command substitution
  /\$\(/,
  /\$\{/,
];

/** Conversation-role markers that identify a transcript body. */
const ROLE_COLON_MARKER = /\b(system|user|assistant|human|ai|tool)\s*:\s*/i;
const JSON_ROLE_MARKER = /"role"\s*:/i;

/** Prompt-injection signals. */
const INJECTION_MARKERS = [
  /ignore\s+(all\s+)?(previous|prior|above|your)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above|your)\s+instructions/i,
  /\bsystem\s+prompt\b/i,
  /\bjailbreak\b/i,
];

/**
 * Where the scanned text came from. `serialized` skips the generic
 * `role:` transcript marker because JSON key syntax (`{"user":…}`) structurally
 * mimics it; the raw walk over the value's own strings still applies the full
 * marker set, so a real transcript body cannot pass.
 */
type ScanScope = "raw" | "serialized";

function unsafe(message: string): never {
  throw new DatabaseError("invalid-argument", "write", {
    cause: new Error(message),
    retryable: false,
  });
}

/** NFKC + homoglyph folding; case is preserved for camelCase splitting. */
function normalizeForMatching(text: string): string {
  const normalized = text.normalize("NFKC");
  let folded = "";
  for (const character of normalized) {
    folded += CONFUSABLE_FOLDS[character] ?? character;
  }
  return folded;
}

function squash(text: string): string {
  return normalizeForMatching(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Splits on separators and camelCase boundaries for word-token matching. */
function wordTokens(text: string): string[] {
  return normalizeForMatching(text)
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
    /\bsk-ant-[a-z0-9_-]{8,}/i.test(text) ||
    /\b(?:sk|pk)_(?:live|test)_[a-z0-9]{8,}/i.test(text) ||
    /\bghp_[a-z0-9]{20,}/i.test(text) ||
    /\bgho_[a-z0-9]{20,}/i.test(text) ||
    /\bglpat-[a-z0-9_-]{16,}/i.test(text) ||
    /\bgithub_pat_[a-z0-9_]{20,}/i.test(text) ||
    /\bxox[bpas]-[a-z0-9-]{10,}/i.test(text) ||
    /\bakia[a-z0-9]{16,}/i.test(text) ||
    /\baiza[a-z0-9_-]{20,}/i.test(text) ||
    /\bhf_[a-z0-9]{20,}/i.test(text) ||
    /-----BEGIN [a-z ]*PRIVATE KEY-----/i.test(text) ||
    /\beyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/i.test(text)
  );
}

/** Marker pass over one exact string. */
function scanText(text: string, scope: ScanScope): string | undefined {
  if (looksLikeSecretValue(text)) return "secret-shaped value";
  for (const marker of URL_MARKERS) {
    if (marker.test(text)) return "url";
  }
  for (const marker of PATH_MARKERS) {
    if (marker.test(text)) return "absolute path";
  }
  for (const marker of COMMAND_MARKERS) {
    if (marker.test(text)) return "command";
  }
  if (JSON_ROLE_MARKER.test(text)) return "transcript body";
  if (scope === "raw" && ROLE_COLON_MARKER.test(text)) return "transcript body";
  for (const marker of INJECTION_MARKERS) {
    if (marker.test(text)) return "prompt injection";
  }
  return undefined;
}

/**
 * One-word reason why the string is forbidden, or `undefined` when safe. The
 * text is scanned as written and again after NFKC + homoglyph folding, so a
 * look-alike character cannot hide a path, URL or command marker.
 */
function findForbiddenTextIssue(
  text: string,
  scope: ScanScope = "raw",
): string | undefined {
  const direct = scanText(text, scope);
  if (direct !== undefined) return direct;
  const folded = normalizeForMatching(text);
  return folded === text ? undefined : scanText(folded, scope);
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
 *
 * The value is inspected in its **persisted** representation, so a `toJSON()`
 * method cannot smuggle content past the walker (review finding P1-7), and the
 * serialized document is scanned once more as a single string for defence in
 * depth.
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

  // The canonical form is what `value_json` will hold: `toJSON()` has already
  // run, getters have been evaluated and unsupported values are gone.
  let canonical: unknown;
  try {
    canonical = JSON.parse(serialized);
  } catch {
    unsafe("preference value is not JSON-serializable");
  }
  walkForbidden(canonical);

  const issue = findForbiddenTextIssue(serialized, "serialized");
  if (issue !== undefined) unsafe(`preference value contains ${issue}`);
}

export interface InsightAnalysisGuardOptions {
  /**
   * Entity names (tool, project, session, profile or file labels) taken from
   * the current evidence set. Architecture §5.10 forbids entity names in a
   * persisted `analysis` line, and a generic matcher cannot know them, so the
   * caller supplies the vocabulary it just rendered from.
   */
  readonly forbiddenEntities?: readonly string[];
}

/**
 * Validates a single-line `analysis` value destined for
 * `insight_enhancement_lines`. Rejects empty/whitespace, oversized or
 * multi-line text, any digit (§5.10 forbids numbers outright), shell
 * metacharacters, caller-declared entity names, and any URL / absolute path /
 * command / transcript / injection / secret-shaped content.
 */
export function assertInsightLineAnalysisSafe(
  text: string,
  options: InsightAnalysisGuardOptions = {},
): void {
  if (typeof text !== "string") unsafe("analysis must be a string");
  if (text.trim() === "") unsafe("analysis must not be empty");
  if (text.length > MAX_ANALYSIS_LENGTH)
    unsafe("analysis exceeds the length limit");
  if (/[\r\n]/.test(text)) unsafe("analysis must be single-line");

  const normalized = normalizeForMatching(text);
  // §5.10: `analysis` carries no numbers at all — a fact sentence with a count
  // is re-rendered by Core from current evidence, never persisted.
  if (/[0-9]/.test(normalized)) unsafe("analysis must not contain digits");
  for (const marker of SHELL_METACHARACTER_MARKERS) {
    if (marker.test(normalized)) unsafe("analysis contains command");
  }

  const issue = findForbiddenTextIssue(text);
  if (issue !== undefined) unsafe(`analysis contains ${issue}`);

  const haystack = squash(text);
  for (const entity of options.forbiddenEntities ?? []) {
    const needle = squash(entity);
    if (needle !== "" && haystack.includes(needle)) {
      unsafe("analysis contains an entity name");
    }
  }
}
