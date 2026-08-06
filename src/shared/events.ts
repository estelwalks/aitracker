import type { CorrelationId, RunId, TaskId } from "./ids.ts";

/**
 * Public, in-process notifications. They are intentionally not a durable
 * message queue: persisted snapshots and JobRuns remain the source of truth.
 */
export interface DomainEvent {
  readonly type: string;
  readonly schemaVersion: number;
  readonly module: string;
  readonly occurredAt: string;
  readonly correlationId: CorrelationId;
  /** A redacted, scalar-only summary suitable for invalidation and telemetry. */
  readonly summary: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SnapshotUpdatedEvent extends DomainEvent {
  readonly type: "snapshot.updated";
}

export interface SnapshotFailedEvent extends DomainEvent {
  readonly type: "snapshot.failed";
  readonly summary: DomainEvent["summary"] & { readonly errorCode: string };
}

export interface TaskRunChangedEvent extends DomainEvent {
  readonly type: "task.run.changed";
  readonly summary: DomainEvent["summary"] & {
    readonly taskId: TaskId;
    readonly runId: RunId;
    readonly state: string;
  };
}

export interface SettingsChangedEvent extends DomainEvent {
  readonly type: "settings.changed";
}

export interface CoreEventMap {
  readonly "snapshot.updated": SnapshotUpdatedEvent;
  readonly "snapshot.failed": SnapshotFailedEvent;
  readonly "task.run.changed": TaskRunChangedEvent;
  readonly "settings.changed": SettingsChangedEvent;
}

export type EventName<TEvents> = Extract<keyof TEvents, string>;
export type EventListener<TEvent extends DomainEvent> = (event: TEvent) => void;
export type Unsubscribe = () => void;

export interface EventDispatchResult {
  readonly delivered: number;
  readonly failures: readonly unknown[];
}

export interface EventBus<TEvents extends Record<keyof TEvents, DomainEvent>> {
  publish<TName extends EventName<TEvents>>(
    event: TEvents[TName],
  ): EventDispatchResult;
  subscribe<TName extends EventName<TEvents>>(
    type: TName,
    listener: EventListener<TEvents[TName]>,
  ): Unsubscribe;
}

/**
 * Creates an isolated event bus. The caller owns its lifecycle; this module
 * never creates a process-wide singleton. Observer failures are recorded but
 * never change the outcome of the publisher's business operation.
 */
export function createEventBus<
  TEvents extends Record<keyof TEvents, DomainEvent>,
>(): EventBus<TEvents> {
  const listeners = new Map<string, Set<EventListener<DomainEvent>>>();

  return {
    publish<TName extends EventName<TEvents>>(
      event: TEvents[TName],
    ): EventDispatchResult {
      const subscribers = [...(listeners.get(event.type) ?? [])];
      const failures: unknown[] = [];

      for (const listener of subscribers) {
        try {
          listener(event);
        } catch (error) {
          failures.push(error);
        }
      }

      return { delivered: subscribers.length - failures.length, failures };
    },
    subscribe<TName extends EventName<TEvents>>(
      type: TName,
      listener: EventListener<TEvents[TName]>,
    ): Unsubscribe {
      const listenersForType = listeners.get(type) ?? new Set();
      listenersForType.add(listener as EventListener<DomainEvent>);
      listeners.set(type, listenersForType);

      return () => {
        listenersForType.delete(listener as EventListener<DomainEvent>);
        if (listenersForType.size === 0) listeners.delete(type);
      };
    },
  };
}
