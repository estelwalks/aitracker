import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { SystemClock } from "../clock.ts";
import {
  PersistenceError,
  type AtomicJsonReadResult,
  type AtomicJsonStore,
  type Clock,
  type FileLock,
  type JsonMigration,
  type JsonSchema,
} from "../contracts.ts";
import {
  createNodeFileSystem,
  nodeErrorCode,
  type NodeFileSystem,
} from "./node-file-system.ts";
import { NodeFileLock, mapNodeError } from "./node-file-lock.ts";

interface StoredDocument {
  schemaVersion: number;
  data: unknown;
}

export interface NodeAtomicJsonStoreOptions<T> {
  filePath: string;
  defaultValue: T;
  schema: JsonSchema<T>;
  clock?: Clock;
  lock?: FileLock;
  fileSystem?: NodeFileSystem;
}

/**
 * Uses write-new-temp + fsync + replace-rename. It never deletes the existing
 * destination as a Windows rename workaround: an occupied target is reported
 * as `target-busy`, keeping the last complete document intact.
 */
export class NodeAtomicJsonStore<T> implements AtomicJsonStore<T> {
  private readonly clock: Clock;
  private readonly fileSystem: NodeFileSystem;
  private readonly lock: FileLock;
  /**
   * In-process mutex: whole read/write critical sections on this instance are
   * serialized, so concurrent callers (e.g. `Promise.all` reads) never fight
   * over the same exclusive file lock. The file lock still guards cross-process
   * access; this gate only prevents self-conflicts inside one process.
   */
  private gate: Promise<void> = Promise.resolve();

  constructor(private readonly options: NodeAtomicJsonStoreOptions<T>) {
    this.clock = options.clock ?? new SystemClock();
    this.fileSystem = options.fileSystem ?? createNodeFileSystem();
    this.lock = options.lock ?? new NodeFileLock(`${options.filePath}.lock`);
  }

  async read(): Promise<AtomicJsonReadResult<T>> {
    return this.withLock(() => this.readUnlocked());
  }

  async write(value: T): Promise<void> {
    return this.withLock(() => this.writeUnlocked(value));
  }

  private withLock<R>(operation: () => Promise<R>): Promise<R> {
    const run = this.gate.then(async () => {
      const lease = await this.lock.acquire();
      try {
        return await operation();
      } finally {
        await lease.release();
      }
    });
    // Keep the chain alive even when an operation fails, so later callers are
    // never stuck behind a rejected gate.
    this.gate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readUnlocked(): Promise<AtomicJsonReadResult<T>> {
    let raw: string;
    try {
      raw = await this.fileSystem.readText(this.options.filePath);
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") {
        return this.defaultResult("default");
      }
      throw mapNodeError(error, "read");
    }

    let document: StoredDocument;
    try {
      document = parseDocument(raw);
    } catch (error) {
      await this.backupCorruptUnlocked();
      return {
        ...this.defaultResult("recovered-corrupt"),
        corruptBackupCreated: true,
      };
    }

    try {
      const migrated = migrateDocument(document, this.options.schema);
      const value = this.options.schema.parse(migrated.data);
      if (migrated.schemaVersion !== document.schemaVersion) {
        await this.writeUnlocked(value);
        return {
          value,
          schemaVersion: migrated.schemaVersion,
          source: "migrated",
        };
      }
      return { value, schemaVersion: migrated.schemaVersion, source: "stored" };
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError("migration-failed", "migration", {
        cause: error,
      });
    }
  }

  private async writeUnlocked(value: T): Promise<void> {
    const serialized = `${JSON.stringify({
      schemaVersion: this.options.schema.currentVersion,
      data: value,
    })}\n`;
    const temporaryPath = `${this.options.filePath}.tmp.${this.clock
      .now()
      .getTime()}.${randomUUID()}`;
    try {
      await this.fileSystem.ensureDirectory(dirname(this.options.filePath));
      await this.fileSystem.writeTextExclusiveAndSync(
        temporaryPath,
        serialized,
      );
      await this.fileSystem.rename(temporaryPath, this.options.filePath);
      await this.fileSystem.syncDirectory(this.options.filePath);
    } catch (error) {
      try {
        await this.fileSystem.remove(temporaryPath);
      } catch {
        // The original error is the actionable failure; a later cleanup can
        // remove a unique stale temp file without risking the current file.
      }
      throw mapNodeError(error, "write");
    }
  }

  private async backupCorruptUnlocked(): Promise<void> {
    const backupPath = `${this.options.filePath}.corrupt.${this.clock
      .now()
      .toISOString()
      .replaceAll(":", "-")}.${randomUUID()}.json`;
    try {
      await this.fileSystem.rename(this.options.filePath, backupPath);
      await this.fileSystem.syncDirectory(this.options.filePath);
    } catch (error) {
      throw mapNodeError(error, "backup");
    }
  }

  private defaultResult(
    source: "default" | "recovered-corrupt",
  ): AtomicJsonReadResult<T> {
    return {
      value: this.options.defaultValue,
      schemaVersion: this.options.schema.currentVersion,
      source,
    };
  }
}

function parseDocument(raw: string): StoredDocument {
  const candidate: unknown = JSON.parse(raw);
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate) ||
    typeof (candidate as { schemaVersion?: unknown }).schemaVersion !==
      "number" ||
    !Number.isInteger((candidate as { schemaVersion: number }).schemaVersion) ||
    (candidate as { schemaVersion: number }).schemaVersion < 1 ||
    !("data" in candidate)
  ) {
    throw new PersistenceError("invalid-document", "read");
  }
  return candidate as StoredDocument;
}

function migrateDocument<T>(
  document: StoredDocument,
  schema: JsonSchema<T>,
): StoredDocument {
  if (document.schemaVersion > schema.currentVersion) {
    throw new PersistenceError("migration-failed", "migration");
  }
  let current = document;
  while (current.schemaVersion < schema.currentVersion) {
    const migration = schema.migrations?.find(
      (candidate) => candidate.fromVersion === current.schemaVersion,
    );
    if (!migration || migration.toVersion <= migration.fromVersion) {
      throw new PersistenceError("migration-failed", "migration");
    }
    current = {
      schemaVersion: migration.toVersion,
      data: applyMigration(migration, current.data),
    };
  }
  return current;
}

function applyMigration(migration: JsonMigration, value: unknown): unknown {
  return migration.migrate(value);
}
