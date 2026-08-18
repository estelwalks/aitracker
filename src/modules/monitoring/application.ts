import {
  monitoringModuleId,
  type MonitoringCollectorId,
  type MonitoringCollectorStatus,
  type MonitoringRuntime,
  type MonitoringStatus,
  type MonitoringStatusStore,
} from "./contracts.ts";

export interface CreateMonitoringRuntimeOptions {
  readonly store: MonitoringStatusStore;
  readonly now?: () => Date;
}

const collectorIds: readonly MonitoringCollectorId[] = [
  "usage",
  "skills",
  "sessions",
  "security",
  "exchange",
];

function freshStatus(now: Date): MonitoringStatus {
  return {
    module: monitoringModuleId,
    running: false,
    pendingCount: 0,
    collectors: collectorIds.map((id) => ({
      id,
      state: "idle",
      pending: false,
    })),
  };
}

function withCollector(
  current: MonitoringStatus,
  id: MonitoringCollectorId,
  update: (collector: MonitoringCollectorStatus) => MonitoringCollectorStatus,
  now: Date,
): MonitoringStatus {
  const collectors = current.collectors.map((collector) =>
    collector.id === id ? update(collector) : collector,
  );
  return {
    ...current,
    heartbeatAt: now.toISOString(),
    pendingCount: collectors.filter((collector) => collector.pending).length,
    collectors,
  };
}

/**
 * Persists only an operational heartbeat and stable error codes.  The service
 * is intentionally independent from task storage so renderer routes can read
 * listener health without learning task internals or scanner inputs.
 */
export function createMonitoringRuntime(
  options: CreateMonitoringRuntimeOptions,
): MonitoringRuntime {
  const now = options.now ?? (() => new Date());
  let current: MonitoringStatus | undefined;
  let write: Promise<void> = Promise.resolve();

  const load = async () => {
    if (current) return current;
    current = (await options.store.load()) ?? freshStatus(now());
    return current;
  };
  const persist = async (next: MonitoringStatus) => {
    current = next;
    // Preserve ordering under concurrent task completions. The status itself
    // has no secrets, but losing a completion would make the dashboard lie.
    write = write.then(() => options.store.save(next));
    await write;
  };

  return {
    async start() {
      const at = now().toISOString();
      const previous = await load();
      await persist({
        ...previous,
        module: monitoringModuleId,
        running: true,
        startedAt: at,
        heartbeatAt: at,
      });
    },
    async stop() {
      const previous = await load();
      await persist({
        ...previous,
        running: false,
        heartbeatAt: now().toISOString(),
      });
    },
    async status() {
      return load();
    },
    async started(id) {
      const previous = await load();
      await persist(
        withCollector(
          previous,
          id,
          (collector) => ({
            ...collector,
            state: "running",
            pending: true,
            lastStartedAt: now().toISOString(),
            errorCode: undefined,
          }),
          now(),
        ),
      );
    },
    async succeeded(id) {
      const previous = await load();
      await persist(
        withCollector(
          previous,
          id,
          (collector) => ({
            ...collector,
            state: "healthy",
            pending: false,
            lastSucceededAt: now().toISOString(),
            errorCode: undefined,
          }),
          now(),
        ),
      );
    },
    async failed(id, errorCode) {
      const previous = await load();
      await persist(
        withCollector(
          previous,
          id,
          (collector) => ({
            ...collector,
            state: "failed",
            pending: false,
            lastFailedAt: now().toISOString(),
            errorCode,
          }),
          now(),
        ),
      );
    },
    async securityCompleted(summary) {
      const previous = await load();
      await persist({
        ...previous,
        security: summary,
        heartbeatAt: now().toISOString(),
      });
    },
  };
}
