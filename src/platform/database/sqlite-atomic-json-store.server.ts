import type {
  AtomicJsonReadResult,
  AtomicJsonStore,
  JsonSchema,
} from "../persistence/contracts.ts";
import { createSqliteRuntimeFlagRepository } from "./runtime-flag-repository.server.ts";
import type { SqliteDatabasePort } from "./contracts.ts";

interface StoredAtomicDocument {
  readonly schemaVersion: number;
  readonly data: unknown;
}

export interface SqliteAtomicJsonStoreOptions<T> {
  readonly database: SqliteDatabasePort;
  readonly key: string;
  readonly defaultValue: T;
  readonly schema: JsonSchema<T>;
  /** Domain guard for path/secret/body restrictions before persistence. */
  readonly validateForStorage?: (value: T) => void;
}

/** AtomicJsonStore compatibility adapter backed by one runtime_flags row. */
export function createSqliteAtomicJsonStore<T>(
  options: SqliteAtomicJsonStoreOptions<T>,
): AtomicJsonStore<T> {
  const flags = createSqliteRuntimeFlagRepository(options.database);
  return {
    async read(): Promise<AtomicJsonReadResult<T>> {
      const record = await flags.get<StoredAtomicDocument>(options.key);
      if (!record) {
        return {
          value: options.defaultValue,
          source: "default",
          schemaVersion: options.schema.currentVersion,
        };
      }
      const migrated = migrate(record.value, options.schema);
      const value = options.schema.parse(migrated.data);
      if (migrated.schemaVersion !== record.value.schemaVersion) {
        await this.write(value);
      }
      return {
        value,
        source:
          migrated.schemaVersion === record.value.schemaVersion
            ? "stored"
            : "migrated",
        schemaVersion: migrated.schemaVersion,
      };
    },
    async write(value) {
      const parsed = options.schema.parse(value);
      options.validateForStorage?.(parsed);
      await flags.set(options.key, {
        schemaVersion: options.schema.currentVersion,
        data: parsed,
      });
    },
  };
}

function migrate<T>(
  document: StoredAtomicDocument,
  schema: JsonSchema<T>,
): StoredAtomicDocument {
  if (!Number.isInteger(document.schemaVersion) || document.schemaVersion < 1) {
    throw new TypeError("Invalid SQLite atomic document version");
  }
  let current = document;
  while (current.schemaVersion < schema.currentVersion) {
    const migration = schema.migrations?.find(
      (candidate) => candidate.fromVersion === current.schemaVersion,
    );
    if (!migration || migration.toVersion <= migration.fromVersion) {
      throw new TypeError("Missing SQLite atomic document migration");
    }
    current = {
      schemaVersion: migration.toVersion,
      data: migration.migrate(current.data),
    };
  }
  if (current.schemaVersion !== schema.currentVersion) {
    throw new TypeError("SQLite atomic document is newer than this build");
  }
  return current;
}
