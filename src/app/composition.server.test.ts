import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getCompositionRoot,
  resetCompositionRootForTests,
} from "./composition.server.ts";

/**
 * The composition root resolves its data root from
 * `process.env.TRUSTTOOLS_USAGE_HOME`. Each test points that variable at an
 * isolated temp directory so concurrent test processes never share state.
 */
async function withIsolatedDataRoot<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `tt-composition-${randomUUID()}-`));
  const previous = process.env.TRUSTTOOLS_USAGE_HOME;
  process.env.TRUSTTOOLS_USAGE_HOME = dir;
  resetCompositionRootForTests();
  try {
    return await fn(dir);
  } finally {
    resetCompositionRootForTests();
    if (previous === undefined) delete process.env.TRUSTTOOLS_USAGE_HOME;
    else process.env.TRUSTTOOLS_USAGE_HOME = previous;
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
    const g = globalThis as unknown as {
      __TRUSTTOOLS_COMPOSITION__?: Promise<unknown>;
    };

    const pending = getCompositionRoot();
    assert.ok(
      g.__TRUSTTOOLS_COMPOSITION__,
      "global cache must be set before construction resolves",
    );

    const root = await pending;
    assert.equal(await g.__TRUSTTOOLS_COMPOSITION__, root);
  });
});

test("resetCompositionRootForTests forces the next call to construct a fresh root", async () => {
  await withIsolatedDataRoot(async () => {
    const first = await getCompositionRoot();
    resetCompositionRootForTests();
    const second = await getCompositionRoot();

    assert.notEqual(second, first);

    const g = globalThis as unknown as {
      __TRUSTTOOLS_COMPOSITION__?: Promise<unknown>;
    };
    assert.ok(
      g.__TRUSTTOOLS_COMPOSITION__,
      "global cache must be repopulated after re-construction",
    );
    // The global cache holds the in-flight promise, whose resolved value
    // must be the newly constructed root (not the discarded first one).
    assert.equal(await g.__TRUSTTOOLS_COMPOSITION__, second);
  });
});
