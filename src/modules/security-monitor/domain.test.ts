import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeIncident,
  aggregateIncidents,
  buildMonitorStatus,
  eventSource,
  evaluateAlertPolicy,
  normalizeObservation,
  resolveIncident,
} from "./domain";

const now = new Date("2026-08-07T00:00:00.000Z");

test("simulated events normalize to privacy-safe observations", () => {
  const result = normalizeObservation(
    {
      sourceRef: "simulator",
      sourceKind: "simulated",
      category: "process",
      severity: "high",
      fingerprintRef: "process-anomaly",
      occurredAt: "2026-08-07T00:00:00.000Z",
    },
    { now },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const serialized = JSON.stringify(result.value);
  assert.doesNotMatch(
    serialized,
    /\/Users|C:\\\\|token|secret|command|prompt|content/i,
  );
  assert.equal(result.value.sourceRef, "event-source:simulator");
  assert.equal(result.value.fingerprintRef, "fingerprint:process-anomaly");
});

test("unauthorized event sources are rejected", () => {
  const result = normalizeObservation(
    {
      sourceRef: "os-hook",
      sourceKind: "authorized",
      authorized: false,
      category: "network",
      severity: "critical",
    },
    { now },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "errors.securityMonitor.unauthorizedSource");
  assert.equal(eventSource({ ref: "os-hook", kind: "authorized" }).ok, false);
});

test("monitor status exposes observe-only capability and never blocking", () => {
  const source = eventSource(
    { ref: "simulator", kind: "simulated", lastSeenAt: now.toISOString() },
    { now },
  );
  assert.equal(source.ok, true);
  if (!source.ok) return;
  const status = buildMonitorStatus([source.value], [], { now });
  assert.equal(status.status, "observing");
  assert.equal(status.capability, "observe-only");
  assert.equal(JSON.stringify(status).includes("block"), false);
  assert.equal(JSON.stringify(status).includes("prevent"), false);
});

test("events deduplicate into incidents and support acknowledge/resolve", () => {
  const first = normalizeObservation(
    {
      sourceRef: "simulator",
      sourceKind: "simulated",
      category: "policy",
      severity: "medium",
      fingerprintRef: "same",
      occurredAt: now.toISOString(),
    },
    { now },
  );
  const second = normalizeObservation(
    {
      sourceRef: "simulator",
      sourceKind: "simulated",
      category: "policy",
      severity: "high",
      fingerprintRef: "same",
      occurredAt: "2026-08-07T00:00:01.000Z",
    },
    { now },
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  const incidents = aggregateIncidents([first.value, second.value], { now });
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].count, 2);
  assert.equal(incidents[0].severity, "high");
  const acknowledged = acknowledgeIncident(incidents[0]);
  assert.equal(acknowledged.ok, true);
  if (!acknowledged.ok) return;
  const resolved = resolveIncident(acknowledged.value);
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.value.state, "resolved");
});

test("alert policies evaluate severity and category filters", () => {
  const source = eventSource(
    { ref: "simulator", kind: "simulated", lastSeenAt: now.toISOString() },
    { now },
  );
  assert.equal(source.ok, true);
  if (!source.ok) return;
  const observation = normalizeObservation(
    {
      sourceRef: "simulator",
      sourceKind: "simulated",
      category: "network",
      severity: "high",
      fingerprintRef: "net",
      occurredAt: now.toISOString(),
    },
    { now },
  );
  assert.equal(observation.ok, true);
  if (!observation.ok) return;
  const incident = aggregateIncidents([observation.value], { now })[0];
  const decision = evaluateAlertPolicy(
    {
      ref: "alert:high-network",
      enabled: true,
      minimumSeverity: "high",
      categories: ["network"],
    },
    [incident],
  );
  assert.equal(decision.triggered, true);
  const filtered = evaluateAlertPolicy(
    {
      ref: "alert:auth",
      enabled: true,
      minimumSeverity: "high",
      categories: ["authentication"],
    },
    [incident],
  );
  assert.equal(filtered.triggered, false);
  assert.equal(filtered.reason, "category-filtered");
});

test("old sources and observations become stale/offline", () => {
  const old = "2026-08-06T23:00:00.000Z";
  const source = eventSource(
    { ref: "simulator", kind: "simulated", lastSeenAt: old },
    { now },
  );
  assert.equal(source.ok, true);
  if (!source.ok) return;
  assert.equal(source.value.state, "offline");
  const observation = normalizeObservation(
    {
      sourceRef: "simulator",
      sourceKind: "simulated",
      category: "unknown",
      severity: "info",
      occurredAt: old,
    },
    { now },
  );
  assert.equal(observation.ok, true);
  if (observation.ok) assert.equal(observation.value.stale, true);
});
