import type { MonitoringStatusStore } from "../../modules/monitoring/contracts.ts";
import type {
  TaskPreferenceRepository,
  TaskRunRepository,
} from "../../modules/tasks/application/task-storage.ts";
import type { HttpCacheRepository } from "./http-cache-repository.server.ts";

export interface ShadowRepositoryOptions<T> {
  readonly sqlite: T;
  readonly legacy: T;
  readonly readFromSqlite: () => boolean;
  readonly onLegacyWriteError?: (error: unknown) => void;
  readonly onSqliteReadError?: (error: unknown) => void;
}

async function readWithFallback<T>(
  options: ShadowRepositoryOptions<unknown>,
  sqliteRead: () => Promise<T>,
  legacyRead: () => Promise<T>,
): Promise<T> {
  if (!options.readFromSqlite()) return legacyRead();
  try {
    return await sqliteRead();
  } catch (error) {
    options.onSqliteReadError?.(error);
    return legacyRead();
  }
}

async function mirrorLegacy(
  operation: () => Promise<unknown>,
  onError?: (error: unknown) => void,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    onError?.(error);
  }
}

export function createShadowTaskPreferenceRepository(
  options: ShadowRepositoryOptions<TaskPreferenceRepository>,
): TaskPreferenceRepository {
  return {
    read: () =>
      readWithFallback(
        options,
        () => options.sqlite.read(),
        () => options.legacy.read(),
      ),
    get: (taskId) =>
      readWithFallback(
        options,
        () => options.sqlite.get(taskId),
        () => options.legacy.get(taskId),
      ),
    async save(preferences) {
      await options.sqlite.save(preferences);
      await mirrorLegacy(
        () => options.legacy.save(preferences),
        options.onLegacyWriteError,
      );
    },
    async set(taskId, preference) {
      const next = await options.sqlite.set(taskId, preference);
      await mirrorLegacy(
        () => options.legacy.set(taskId, preference),
        options.onLegacyWriteError,
      );
      return next;
    },
  };
}

export function createShadowTaskRunRepository(
  options: ShadowRepositoryOptions<TaskRunRepository>,
): TaskRunRepository {
  return {
    async append(run) {
      await options.sqlite.append(run);
      await mirrorLegacy(
        () => options.legacy.append(run),
        options.onLegacyWriteError,
      );
    },
    list: (query) =>
      readWithFallback(
        options,
        () => options.sqlite.list(query),
        () => options.legacy.list(query),
      ),
    async recoverRunning() {
      const recovered = await options.sqlite.recoverRunning();
      await mirrorLegacy(
        () => options.legacy.recoverRunning(),
        options.onLegacyWriteError,
      );
      return recovered;
    },
    async compact() {
      await options.sqlite.compact();
      await mirrorLegacy(
        () => options.legacy.compact(),
        options.onLegacyWriteError,
      );
    },
    async rotate() {
      await options.sqlite.rotate();
      await mirrorLegacy(
        () => options.legacy.rotate(),
        options.onLegacyWriteError,
      );
    },
  };
}

export function createShadowMonitoringStatusStore(
  options: ShadowRepositoryOptions<MonitoringStatusStore>,
): MonitoringStatusStore {
  return {
    load: () =>
      readWithFallback(
        options,
        () => options.sqlite.load(),
        () => options.legacy.load(),
      ),
    async save(status) {
      await options.sqlite.save(status);
      await mirrorLegacy(
        () => options.legacy.save(status),
        options.onLegacyWriteError,
      );
    },
  };
}

export function createShadowHttpCacheRepository(
  options: ShadowRepositoryOptions<HttpCacheRepository>,
): HttpCacheRepository {
  return {
    get: (namespace, key) =>
      readWithFallback(
        options,
        () => options.sqlite.get(namespace, key),
        () => options.legacy.get(namespace, key),
      ),
    async put(entry) {
      await options.sqlite.put(entry);
      await mirrorLegacy(
        () => options.legacy.put(entry),
        options.onLegacyWriteError,
      );
    },
    async deleteExpired(namespace, nowMs) {
      const changes = await options.sqlite.deleteExpired(namespace, nowMs);
      await mirrorLegacy(
        () => options.legacy.deleteExpired(namespace, nowMs),
        options.onLegacyWriteError,
      );
      return changes;
    },
  };
}
