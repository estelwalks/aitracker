import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  completeReleaseDataResetAfterWarmup,
  markReleaseDataResetComplete,
  prepareReleaseDataReset,
  readReleaseDataResetMarker,
  type ReleaseDataResetOptions,
} from "./release-data-reset.js";

async function fixture(): Promise<{
  root: string;
  options: ReleaseDataResetOptions;
}> {
  const root = await mkdtemp(join(tmpdir(), "aitracker-release-reset-"));
  const homeDirectory = join(root, "home");
  const userDataDirectory = join(root, "user-data");
  await mkdir(homeDirectory, { recursive: true });
  return {
    root,
    options: {
      platform: "darwin",
      isPackaged: true,
      appVersion: "3.0.1",
      homeDirectory,
      userDataDirectory,
    },
  };
}

test("first packaged macOS launch clears ~/.aitracker and marks only on explicit completion", async () => {
  const { root, options } = await fixture();
  try {
    const target = join(options.homeDirectory, ".aitracker");
    await mkdir(join(target, "nested"), { recursive: true });
    await writeFile(join(target, "nested", "database.sqlite"), "old-data");

    const reset = await prepareReleaseDataReset(options);
    assert.equal(reset.status, "pending");
    await assert.rejects(lstat(target), { code: "ENOENT" });
    assert.equal(await readReleaseDataResetMarker(options), null);

    await reset.markInitializationComplete();
    const marker = JSON.parse(
      (await readReleaseDataResetMarker(options)) ?? "null",
    ) as Record<string, unknown>;
    assert.equal(marker.appVersion, "3.0.1");
    assert.equal(marker.resetCode, "initial-schema-v1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("first packaged Windows launch clears incompatible ~/.aitracker data", async () => {
  const { root, options } = await fixture();
  try {
    const windowsOptions = { ...options, platform: "win32" as const };
    const target = join(windowsOptions.homeDirectory, ".aitracker");
    await mkdir(join(target, "data"), { recursive: true });
    await writeFile(
      join(target, "data", "aitracker.v1.db"),
      "legacy-migration-lineage",
    );

    const reset = await prepareReleaseDataReset(windowsOptions);
    assert.equal(reset.status, "pending");
    await assert.rejects(lstat(target), { code: "ENOENT" });
    assert.equal(await readReleaseDataResetMarker(windowsOptions), null);

    await reset.markInitializationComplete();
    const marker = JSON.parse(
      (await readReleaseDataResetMarker(windowsOptions)) ?? "null",
    ) as Record<string, unknown>;
    assert.equal(marker.resetCode, "initial-schema-v1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same release does not clear data again after its completion marker exists", async () => {
  const { root, options } = await fixture();
  try {
    const first = await prepareReleaseDataReset(options);
    await first.markInitializationComplete();

    const target = join(options.homeDirectory, ".aitracker");
    const retained = join(target, "created-after-initialization.txt");
    await mkdir(target, { recursive: true });
    await writeFile(retained, "keep");

    const second = await prepareReleaseDataReset(options);
    assert.equal(second.status, "already-completed");
    assert.equal(await readFile(retained, "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed initialization leaves no marker so the next launch retries", async () => {
  const { root, options } = await fixture();
  try {
    const first = await prepareReleaseDataReset(options);
    assert.equal(first.status, "pending");
    // Simulate startup failure by intentionally not calling completion.
    assert.equal(await readReleaseDataResetMarker(options), null);

    const target = join(options.homeDirectory, ".aitracker");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "partial-initialization"), "retry-me");
    const retry = await prepareReleaseDataReset(options);
    assert.equal(retry.status, "pending");
    await assert.rejects(lstat(target), { code: "ENOENT" });
    assert.equal(await readReleaseDataResetMarker(options), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a compatibility reset refuses to delete data held by another writer", async () => {
  const { root, options } = await fixture();
  try {
    const target = join(options.homeDirectory, ".aitracker");
    const retained = join(target, "data", "aitracker.v1.db");
    await mkdir(join(target, "data"), { recursive: true });
    await writeFile(retained, "must-survive", "utf8");
    await writeFile(
      `${retained}.writer.lock`,
      `${JSON.stringify({
        pid: process.pid,
        token: "test-owner",
        createdAtMs: Date.now(),
      })}\n`,
      "utf8",
    );

    await assert.rejects(
      prepareReleaseDataReset(options),
      (error: unknown) =>
        (error as { startupFailureCode?: unknown }).startupFailureCode ===
        "database.already-open",
    );
    assert.equal(await readFile(retained, "utf8"), "must-survive");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("development and unsupported-platform launches never clear data", async () => {
  const { root, options } = await fixture();
  try {
    const target = join(options.homeDirectory, ".aitracker");
    const retained = join(target, "retained.txt");
    await mkdir(target, { recursive: true });
    await writeFile(retained, "safe");

    const development = await prepareReleaseDataReset({
      ...options,
      isPackaged: false,
      homeDirectory: "not-an-absolute-path",
    });
    const unsupportedPlatform = await prepareReleaseDataReset({
      ...options,
      platform: "linux",
      homeDirectory: "also-not-absolute",
    });
    assert.equal(development.status, "not-applicable");
    assert.equal(unsupportedPlatform.status, "not-applicable");
    assert.equal(await readFile(retained, "utf8"), "safe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a ~/.aitracker symlink is unlinked without touching its destination", async () => {
  const { root, options } = await fixture();
  try {
    const external = join(root, "external-data");
    const externalFile = join(external, "must-survive.txt");
    await mkdir(external, { recursive: true });
    await writeFile(externalFile, "safe");
    const target = join(options.homeDirectory, ".aitracker");
    await symlink(external, target, "dir");

    await prepareReleaseDataReset(options);
    await assert.rejects(lstat(target), { code: "ENOENT" });
    assert.equal(await readFile(externalFile, "utf8"), "safe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packaged desktop reset rejects an invalid or dangerously broad home", async () => {
  const { root, options } = await fixture();
  try {
    await assert.rejects(
      prepareReleaseDataReset({ ...options, homeDirectory: "relative/home" }),
      /absolute path/,
    );
    await assert.rejects(
      prepareReleaseDataReset({ ...options, homeDirectory: "/" }),
      /filesystem root/,
    );
    await assert.rejects(
      prepareReleaseDataReset({
        ...options,
        userDataDirectory: join(options.homeDirectory, ".aitracker", "state"),
      }),
      /outside the reset target/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a declined reset writes the completion marker without deleting data", async () => {
  const { root, options } = await fixture();
  try {
    const target = join(options.homeDirectory, ".aitracker");
    await mkdir(join(target, "data"), { recursive: true });
    await writeFile(join(target, "data", "aitracker.v1.db"), "keep-me");

    // Cancel path: persist completion only, never touch the data.
    await markReleaseDataResetComplete(options);
    assert.equal(
      await readFile(join(target, "data", "aitracker.v1.db"), "utf8"),
      "keep-me",
    );
    const marker = JSON.parse(
      (await readReleaseDataResetMarker(options)) ?? "null",
    ) as Record<string, unknown>;
    assert.equal(marker.appVersion, "3.0.1");
    assert.equal(marker.resetCode, "initial-schema-v1");

    // The marker now suppresses any further destructive attempt on next launch.
    const next = await prepareReleaseDataReset(options);
    assert.equal(next.status, "already-completed");
    assert.equal(
      await readFile(join(target, "data", "aitracker.v1.db"), "utf8"),
      "keep-me",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("declined-reset completion marker is a no-op off darwin/win32 or unpackaged", async () => {
  const { root, options } = await fixture();
  try {
    const target = join(options.homeDirectory, ".aitracker");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "retained.txt"), "safe");

    await markReleaseDataResetComplete({ ...options, isPackaged: false });
    await markReleaseDataResetComplete({ ...options, platform: "linux" });
    assert.equal(await readReleaseDataResetMarker(options), null);
    assert.equal(await readFile(join(target, "retained.txt"), "utf8"), "safe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reset completion is persisted immediately after successful warmup", async () => {
  const order: string[] = [];
  await completeReleaseDataResetAfterWarmup(
    {
      status: "pending",
      markInitializationComplete: async () => {
        order.push("marker");
      },
    },
    async () => {
      order.push("warmup");
    },
  );
  order.push("preferences-and-page");
  assert.deepEqual(order, ["warmup", "marker", "preferences-and-page"]);
});

test("warmup failure never persists reset completion", async () => {
  let marked = false;
  await assert.rejects(
    completeReleaseDataResetAfterWarmup(
      {
        status: "pending",
        markInitializationComplete: async () => {
          marked = true;
        },
      },
      async () => {
        throw new Error("warmup failed");
      },
    ),
    /warmup failed/,
  );
  assert.equal(marked, false);
});
