/**
 * Pure path placement helpers for per-tool data-directory overrides.
 *
 * Semantics (shared by the usage scanner, installation detection and the
 * Sources configuration surface): a user-chosen directory replaces the
 * tool's default data directory (the uniform first path segment of its
 * HOME-anchored roots, e.g. `.hermes`, `.claude`, `.codex`, `.pi`). Every
 * registry path below that segment keeps its remainder under the override:
 *
 *   ~/.hermes/state.db                →  <override>/state.db
 *   ~/.hermes/profiles/<name>/state.db →  <override>/profiles/<name>/state.db
 *   ~/.claude/projects                 →  <override>/projects (glob unchanged)
 *
 * Roots anchored at non-HOME OS bases (AppData/Roaming, Library/Application
 * Support, XDG homes, env: bases) are NOT rebased: under an override they are
 * skipped so a stale default installation can never shadow the user's choice.
 *
 * This module is pure and server-safe: it only manipulates strings with
 * `node:path`, never touches disk or the registry runtime.
 */
import { join } from "node:path";

/** First path segment of a flattened HOME-relative root (e.g. ".hermes"). */
export function firstPathSegment(root: string): string | null {
  const normalized = root.replaceAll("\\", "/");
  if (normalized === "" || normalized === "." || normalized.startsWith("/")) {
    return null;
  }
  return normalized.split("/", 1)[0] ?? null;
}

/**
 * The uniform first segment of a set of flattened HOME-relative roots.
 * Returns null when the set is empty or spans several segments (a tool whose
 * data lives under multiple independent roots is not override-configurable).
 */
export function uniformDataSegment(roots: readonly string[]): string | null {
  const segments = new Set<string>();
  for (const root of roots) {
    const segment = firstPathSegment(root);
    if (segment == null) return null;
    segments.add(segment);
  }
  return segments.size === 1 ? [...segments][0]! : null;
}

/**
 * True when a flattened root is HOME-anchored (dot-prefixed segment such as
 * `.hermes`). Flattened forms of the other OS bases carry conventional
 * prefixes like `AppData/`, `Library/` or start absolute (env:/XDG).
 */
export function isHomeFlattenedRoot(root: string): boolean {
  if (root.startsWith("/") || root.startsWith("~")) return false;
  const segment = firstPathSegment(root);
  return segment != null && segment.startsWith(".");
}

/**
 * The remainder of `root` below `segment`, without a leading slash.
 * Returns null when `root` is not located under `segment`.
 */
export function stripDataSegment(root: string, segment: string): string | null {
  const normalized = root.replaceAll("\\", "/");
  if (normalized === segment) return "";
  if (normalized.startsWith(`${segment}/`)) {
    return normalized.slice(segment.length + 1);
  }
  return null;
}

/** Rebase one flattened root under the override directory (null = not under the segment). */
export function rebaseRoot(
  root: string,
  segment: string,
  overrideDir: string,
): string | null {
  const remainder = stripDataSegment(root, segment);
  if (remainder == null) return null;
  return remainder === "" ? overrideDir : join(overrideDir, remainder);
}
