import type { SqliteDatabasePort } from "./contracts.ts";

export const PROJECT_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface ProjectIdentityMerge {
  readonly sourceIdentity: string;
  readonly targetIdentity: string;
  readonly createdAtMs: number;
}

export interface ProjectIdentityMergeRepository {
  /** Resolve an identity to the current canonical identity. */
  resolve(identity: string): string;
  /** Add or replace a user-confirmed source → target merge. */
  merge(sourceIdentity: string, targetIdentity: string, nowMs?: number): void;
  /** Remove a direct merge rule. */
  unmerge(sourceIdentity: string): void;
  /** Read the configured rules for settings/debug surfaces. */
  list(): readonly ProjectIdentityMerge[];
  /** Remove all rules during an explicit local-data reset. */
  clear(): void;
}

function assertIdentity(value: string, field: string): string {
  const identity = value.trim();
  if (!PROJECT_IDENTITY_PATTERN.test(identity)) {
    throw new TypeError(`${field} must be an opaque project identity`);
  }
  return identity;
}

export function createSqliteProjectIdentityMergeRepository(
  database: SqliteDatabasePort,
): ProjectIdentityMergeRepository {
  const rules = new Map<string, string>();
  const createdAt = new Map<string, number>();
  const hydrate = (): void => {
    rules.clear();
    createdAt.clear();
    for (const row of database
      .prepare(
        "SELECT source_identity, target_identity, created_at_ms FROM project_identity_merges",
      )
      .all()) {
      const source = String(row.source_identity);
      const target = String(row.target_identity);
      if (
        PROJECT_IDENTITY_PATTERN.test(source) &&
        PROJECT_IDENTITY_PATTERN.test(target)
      ) {
        rules.set(source, target);
        createdAt.set(source, Number(row.created_at_ms));
      }
    }
  };
  hydrate();

  const resolve = (identity: string): string => {
    const current = assertIdentity(identity, "identity");
    const seen = new Set<string>();
    let resolved = current;
    while (!seen.has(resolved)) {
      seen.add(resolved);
      const next = rules.get(resolved);
      if (next == null) return resolved;
      resolved = next;
    }
    // A cycle should be impossible through merge(), but never let corrupted
    // local state make a request loop forever.
    return [...seen].sort().at(-1) ?? current;
  };

  return {
    resolve,
    merge(sourceValue, targetValue, nowMs = Date.now()) {
      const source = assertIdentity(sourceValue, "sourceIdentity");
      const target = assertIdentity(targetValue, "targetIdentity");
      const canonicalSource = resolve(source);
      const canonicalTarget = resolve(target);
      if (canonicalSource === canonicalTarget) return;
      if (resolve(canonicalTarget) === canonicalSource) {
        throw new Error("project identity merge would create a cycle");
      }

      database
        .prepare(
          `INSERT INTO project_identity_merges(source_identity,target_identity,created_at_ms)
           VALUES (?, ?, ?)
           ON CONFLICT(source_identity) DO UPDATE SET
             target_identity=excluded.target_identity,
             created_at_ms=excluded.created_at_ms`,
        )
        .run(canonicalSource, canonicalTarget, Math.max(0, Math.trunc(nowMs)));
      rules.set(canonicalSource, canonicalTarget);
      createdAt.set(canonicalSource, Math.max(0, Math.trunc(nowMs)));
    },
    unmerge(sourceValue) {
      const source = assertIdentity(sourceValue, "sourceIdentity");
      database
        .prepare("DELETE FROM project_identity_merges WHERE source_identity=?")
        .run(source);
      rules.delete(source);
      createdAt.delete(source);
    },
    list() {
      return [...rules.entries()]
        .map(([sourceIdentity, targetIdentity]) => ({
          sourceIdentity,
          targetIdentity,
          createdAtMs: createdAt.get(sourceIdentity) ?? 0,
        }))
        .sort((left, right) =>
          left.sourceIdentity.localeCompare(right.sourceIdentity),
        );
    },
    clear() {
      database.prepare("DELETE FROM project_identity_merges").run();
      rules.clear();
      createdAt.clear();
    },
  };
}
