import assert from "node:assert/strict";
import test from "node:test";

import {
  enumerateWslTopology,
  wslRootsFor,
  type WslTopology,
} from "./wsl-topology.server.ts";

/** Minimal child-like object the mock execFile must return. */
function fakeChild() {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    killed: false,
    kill(signal?: string) {
      this.killed = true;
      void signal;
      // Simulate prompt exit so the promise settles.
      queueMicrotask(() => {
        for (const handler of listeners["exit"] ?? []) handler();
      });
    },
    once(event: string, handler: () => void) {
      (listeners[event] ??= []).push(handler);
    },
    removeListener() {},
  };
}

type ExecCallback = (error: Error | null, stdout?: string | Buffer) => void;

/** Mock execFile: first call lists distros, subsequent calls return homes. */
function successExecFileFn() {
  let calls = 0;
  const fn = (
    _file: string,
    args: readonly string[],
    _options: object,
    callback: ExecCallback,
  ) => {
    calls += 1;
    const child = fakeChild();
    if (calls === 1) {
      // wsl.exe -l -q emits UTF-16LE lines separated by \r\n.
      callback(null, Buffer.from("Ubuntu\r\nDebian\r\n", "utf16le"));
    } else {
      const distro = args[1] ?? "";
      callback(null, distro === "Ubuntu" ? "/home/dev" : "/home/debian");
    }
    return child as never;
  };
  return fn as unknown as typeof import("node:child_process").execFile;
}

test("non-Windows platforms return an empty, non-failed topology", async () => {
  const topology = await enumerateWslTopology({ platform: "darwin" });
  assert.deepEqual(topology.distros, []);
  assert.equal(topology.failed, false);
});

test("wsl.exe failure degrades to an empty failed topology (never throws)", async () => {
  const failingFn = (
    _file: string,
    _args: readonly string[],
    _options: object,
    callback: (error?: Error | null) => void,
  ) => {
    callback(new Error("wsl unavailable"));
  };
  const failing =
    failingFn as unknown as typeof import("node:child_process").execFile;
  const topology = await enumerateWslTopology({
    platform: "win32",
    execFileFn: failing,
  });
  assert.deepEqual(topology.distros, []);
  assert.equal(topology.failed, true);
  assert.ok(topology.warningCodes.includes("wsl-unavailable"));
});

test("successful enumeration returns distros with homes and no warnings", async () => {
  const topology = await enumerateWslTopology({
    platform: "win32",
    execFileFn: successExecFileFn(),
  });
  assert.equal(topology.failed, false);
  assert.deepEqual(topology.distros, [
    { distribution: "Ubuntu", home: "/home/dev" },
    { distribution: "Debian", home: "/home/debian" },
  ]);
  assert.deepEqual(topology.warningCodes, []);
});

test("the timeout is a total budget across all WSL commands", async () => {
  let elapsedMs = 0;
  const commandTimeouts: number[] = [];
  let calls = 0;
  const fn = (
    _file: string,
    _args: readonly string[],
    options: { timeout?: number },
    callback: ExecCallback,
  ) => {
    calls += 1;
    commandTimeouts.push(options.timeout ?? 0);
    const child = fakeChild();
    if (calls === 1) {
      elapsedMs = 3_000;
      callback(null, Buffer.from("Ubuntu\r\nDebian\r\n", "utf16le"));
    } else {
      elapsedMs = 10_000;
      callback(new Error("timed out"));
    }
    return child as never;
  };

  const topology = await enumerateWslTopology({
    platform: "win32",
    execFileFn: fn as unknown as typeof import("node:child_process").execFile,
    timeoutMs: 10_000,
    monotonicNow: () => elapsedMs,
  });

  assert.equal(calls, 2);
  assert.deepEqual(commandTimeouts, [10_000, 7_000]);
  assert.equal(topology.failed, true);
  assert.deepEqual(topology.warningCodes, ["timeout"]);
});

test("T5-04: running abort kills the child and records a cancelled warning", async () => {
  const controller = new AbortController();
  let child: ReturnType<typeof fakeChild> | undefined;
  const fn = (
    _file: string,
    _args: readonly string[],
    _options: object,
    callback: ExecCallback,
  ) => {
    child = fakeChild();
    // Never call back: the child must be killed on abort.
    void callback;
    return child as never;
  };
  const promise = enumerateWslTopology({
    platform: "win32",
    execFileFn: fn as unknown as typeof import("node:child_process").execFile,
    signal: controller.signal,
  });
  controller.abort();
  const topology = await promise;
  assert.equal(topology.failed, true);
  assert.ok(topology.warningCodes.includes("cancelled"));
  // The child was killed and awaited (no hanging handle).
  assert.equal(child?.killed, true);
});

test("T5-04: pre-aborted signal returns cancelled without starting a child", async () => {
  const controller = new AbortController();
  controller.abort();
  let started = false;
  const fn = (
    _file: string,
    _args: readonly string[],
    _options: object,
    callback: ExecCallback,
  ) => {
    started = true;
    void callback;
    return fakeChild() as never;
  };
  const topology = await enumerateWslTopology({
    platform: "win32",
    execFileFn: fn as unknown as typeof import("node:child_process").execFile,
    signal: controller.signal,
  });
  assert.equal(topology.failed, true);
  assert.ok(topology.warningCodes.includes("cancelled"));
  assert.equal(started, false);
});

test("wslRootsFor builds one non-duplicated UNC root for every distro", () => {
  const topology: WslTopology = {
    distros: [
      { distribution: "Ubuntu", home: "/home/dev" },
      { distribution: "Debian", home: "/home/debian" },
    ],
    enumeratedAt: "2026-08-18T00:00:00.000Z",
    failed: false,
    warningCodes: [],
  };
  const roots = wslRootsFor(topology, ".claude");
  assert.deepEqual(roots, [
    "\\\\wsl$\\Ubuntu\\home\\dev\\.claude",
    "\\\\wsl$\\Debian\\home\\debian\\.claude",
  ]);
});

test("empty topology produces no roots", () => {
  assert.deepEqual(
    wslRootsFor(
      { distros: [], enumeratedAt: null, failed: false, warningCodes: [] },
      ".claude",
    ),
    [],
  );
});
