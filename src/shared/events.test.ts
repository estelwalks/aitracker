import assert from "node:assert/strict";
import test from "node:test";

import { createCorrelationId } from "./ids.ts";
import { createEventBus, type CoreEventMap } from "./events.ts";

function snapshotUpdated(): CoreEventMap["snapshot.updated"] {
  return {
    type: "snapshot.updated",
    schemaVersion: 1,
    module: "usage",
    occurredAt: "2026-08-06T00:00:00.000Z",
    correlationId: createCorrelationId("corr-01"),
    summary: { freshness: "fresh" },
  };
}

test("event bus routes notifications and supports unsubscribe", () => {
  const bus = createEventBus<CoreEventMap>();
  const received: string[] = [];
  const unsubscribe = bus.subscribe("snapshot.updated", (event) => {
    received.push(event.module);
  });

  assert.deepEqual(bus.publish(snapshotUpdated()), {
    delivered: 1,
    failures: [],
  });
  unsubscribe();
  assert.deepEqual(bus.publish(snapshotUpdated()), {
    delivered: 0,
    failures: [],
  });
  assert.deepEqual(received, ["usage"]);
});

test("event bus isolates observer failures without a global singleton", () => {
  const firstBus = createEventBus<CoreEventMap>();
  const secondBus = createEventBus<CoreEventMap>();
  firstBus.subscribe("snapshot.updated", () => {
    throw new Error("observer failed");
  });

  const result = firstBus.publish(snapshotUpdated());
  assert.equal(result.delivered, 0);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(secondBus.publish(snapshotUpdated()), {
    delivered: 0,
    failures: [],
  });
});
