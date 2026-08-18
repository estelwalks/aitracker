import assert from "node:assert/strict";
import test from "node:test";

import {
  createResourceBudget,
  resourceLimitFor,
  RESOURCE_CLASS_ORDER,
} from "./resource-budget.ts";
import { RUNTIME_POLICY } from "../../app/runtime-policy.generated.ts";

test("policy limits are 1/16/8", () => {
  assert.equal(resourceLimitFor("heavy"), 1);
  assert.equal(resourceLimitFor("file"), 16);
  assert.equal(resourceLimitFor("classifier"), 8);
  assert.deepEqual(RUNTIME_POLICY.resourceBudgets, {
    maxHeavyCollectors: 1,
    maxFileOperations: 16,
    maxProjectClassifiers: 8,
  });
});

test("heavy permits are exclusive (max 1)", async () => {
  const budget = createResourceBudget();
  const release1 = await budget.acquire("heavy");
  assert.equal(budget.inFlight("heavy"), 1);
  let secondAcquired = false;
  const pending = budget.acquire("heavy").then((release) => {
    secondAcquired = true;
    return release;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(secondAcquired, false);
  release1();
  const release2 = await pending;
  assert.equal(secondAcquired, true);
  release2();
  assert.equal(budget.inFlight("heavy"), 0);
});

test("file class allows up to 16 concurrent permits", async () => {
  const budget = createResourceBudget();
  const releases = await Promise.all(
    Array.from({ length: 16 }, () => budget.acquire("file")),
  );
  assert.equal(budget.inFlight("file"), 16);
  releases.forEach((release) => release());
  assert.equal(budget.inFlight("file"), 0);
});

test("waiting acquire aborts when the signal fires", async () => {
  const budget = createResourceBudget();
  const release = await budget.acquire("heavy");
  const controller = new AbortController();
  const pending = budget.acquire("heavy", controller.signal);
  controller.abort();
  await assert.rejects(pending);
  // Aborted waiter must not leak a permit or break later acquires.
  release();
  const again = await budget.acquire("heavy");
  again();
  assert.equal(budget.inFlight("heavy"), 0);
});

test("already-aborted signal rejects immediately", async () => {
  const budget = createResourceBudget();
  await budget.acquire("heavy");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(budget.acquire("heavy", controller.signal));
});

test("release is idempotent", async () => {
  const budget = createResourceBudget();
  const release = await budget.acquire("classifier");
  release();
  release();
  assert.equal(budget.inFlight("classifier"), 0);
});

test("snapshot reports all classes", async () => {
  const budget = createResourceBudget();
  const heavy = await budget.acquire("heavy");
  const file = await budget.acquire("file");
  const snap = budget.snapshot();
  assert.equal(snap.heavy, 1);
  assert.equal(snap.file, 1);
  assert.equal(snap.classifier, 0);
  heavy();
  file();
  assert.equal(RESOURCE_CLASS_ORDER.length, 3);
});
