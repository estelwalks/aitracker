import type { MetricSink, MetricSnapshot } from "./contracts.ts";

interface MetricAccumulator {
  kind: "counter" | "duration";
  count: number;
  sum: number;
  min?: number;
  max?: number;
}

function requireMetricName(name: string): void {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(name)) {
    throw new TypeError("metric name must be a stable dotted identifier");
  }
}

/** In-memory aggregate metrics; callers decide if/how they are exported. */
export function createInMemoryMetrics(): MetricSink {
  const metrics = new Map<string, MetricAccumulator>();
  const get = (
    name: string,
    kind: MetricAccumulator["kind"],
  ): MetricAccumulator => {
    requireMetricName(name);
    const existing = metrics.get(name);
    if (existing) {
      if (existing.kind !== kind)
        throw new TypeError("metric kind cannot change");
      return existing;
    }
    const created: MetricAccumulator = { kind, count: 0, sum: 0 };
    metrics.set(name, created);
    return created;
  };

  return {
    increment(name, amount = 1) {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new TypeError(
          "counter amount must be a non-negative finite number",
        );
      }
      const metric = get(name, "counter");
      metric.count += 1;
      metric.sum += amount;
    },
    observeDuration(name, durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new TypeError("duration must be a non-negative finite number");
      }
      const metric = get(name, "duration");
      metric.count += 1;
      metric.sum += durationMs;
      metric.min =
        metric.min === undefined
          ? durationMs
          : Math.min(metric.min, durationMs);
      metric.max =
        metric.max === undefined
          ? durationMs
          : Math.max(metric.max, durationMs);
    },
    snapshot(): readonly MetricSnapshot[] {
      return [...metrics.entries()]
        .map(([name, metric]) => ({ name, ...metric }))
        .sort((left, right) => left.name.localeCompare(right.name));
    },
  };
}
