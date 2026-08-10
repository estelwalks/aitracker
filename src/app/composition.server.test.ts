import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENV } from "../lib/app-config.ts";
import {
  COMPOSITION_GLOBAL,
  getCompositionRoot,
  resetCompositionRootForTests,
} from "./composition.server.ts";

type CompositionGlobal = Record<typeof COMPOSITION_GLOBAL, unknown>;

function compositionGlobal(): CompositionGlobal {
  return globalThis as unknown as CompositionGlobal;
}

/**
 * The composition root resolves its data root from the configured usage-home
 * env var. Each test points that variable at an isolated temp directory so
 * concurrent test processes never share state.
 */
async function withIsolatedDataRoot<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `tt-composition-${randomUUID()}-`));
  const previous = process.env[ENV.USAGE_HOME];
  process.env[ENV.USAGE_HOME] = dir;
  resetCompositionRootForTests();
  try {
    return await fn(dir);
  } finally {
    resetCompositionRootForTests();
    if (previous === undefined) delete process.env[ENV.USAGE_HOME];
    else process.env[ENV.USAGE_HOME] = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test("getCompositionRoot returns the same instance across repeated calls", async () => {
  await withIsolatedDataRoot(async () => {
    const first = await getCompositionRoot();
    const second = await getCompositionRoot();
    assert.equal(second, first);
  });
});

test("getCompositionRoot exposes the scheduler, repositories and resolved data root", async () => {
  await withIsolatedDataRoot(async (dir) => {
    const root = await getCompositionRoot();

    assert.ok(root.scheduler, "scheduler must be assembled");
    assert.ok(root.preferences, "preferences repository must be assembled");
    assert.ok(root.runs, "runs repository must be assembled");
    assert.equal(root.dataRoot, dir);
  });
});

test("getCompositionRoot publishes the in-flight promise on globalThis to survive HMR", async () => {
  await withIsolatedDataRoot(async () => {
    const pending = getCompositionRoot();
    assert.ok(
      compositionGlobal()[COMPOSITION_GLOBAL],
      "global cache must be set before construction resolves",
    );

    const root = await pending;
    assert.equal(await compositionGlobal()[COMPOSITION_GLOBAL], root);
  });
});

test("resetCompositionRootForTests forces the next call to construct a fresh root", async () => {
  await withIsolatedDataRoot(async () => {
    const first = await getCompositionRoot();
    resetCompositionRootForTests();
    const second = await getCompositionRoot();

    assert.notEqual(second, first);

    assert.ok(
      compositionGlobal()[COMPOSITION_GLOBAL],
      "global cache must be repopulated after re-construction",
    );
    // The global cache holds the in-flight promise, whose resolved value
    // must be the newly constructed root (not the discarded first one).
    assert.equal(await compositionGlobal()[COMPOSITION_GLOBAL], second);
  });
});
