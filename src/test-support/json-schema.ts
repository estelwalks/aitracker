/**
 * Test-only JSON document schema contract.
 *
 * Moved from `platform/persistence/contracts.ts` after that module was
 * reduced to the `Clock` contract. Production runtimes validate at their
 * SQLite boundaries; this type only survives to type the injected test
 * adapters in `src/test-support`.
 */

export interface JsonSchema<T> {
  currentVersion: number;
  parse(value: unknown): T;
  migrations?: readonly JsonMigration[];
}

/** A migration always receives the previous document's `data` payload. */
export interface JsonMigration {
  fromVersion: number;
  toVersion: number;
  migrate(value: unknown): unknown;
}
