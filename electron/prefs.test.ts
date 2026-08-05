import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readPrefs, writePrefs } from "./prefs.js";

function withTempDir(): string {
  return mkdtempSync(join(tmpdir(), "trusttools-prefs-test-"));
}

test("readPrefs: 缺失文件返回空对象", () => {
  const dir = withTempDir();
  try {
    assert.deepEqual(readPrefs(join(dir, "missing.json")), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readPrefs: 损坏 JSON 返回空对象", () => {
  const dir = withTempDir();
  try {
    const path = join(dir, "prefs.json");
    writeFileSync(path, "{not json", "utf8");
    assert.deepEqual(readPrefs(path), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readPrefs: 正常读取且非对象顶层也返回空对象", () => {
  const dir = withTempDir();
  try {
    const path = join(dir, "prefs.json");
    writeFileSync(path, "[1,2]", "utf8");
    assert.deepEqual(readPrefs(path), {});
    writeFileSync(path, JSON.stringify({ a: 1 }), "utf8");
    assert.deepEqual(readPrefs(path), { a: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writePrefs: 原子写入后原文件可读且格式化", () => {
  const dir = withTempDir();
  try {
    const path = join(dir, "prefs.json");
    writePrefs(path, { [Symbol("x") as never]: undefined, b: 2 });
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(parsed.b, 2);
    // Pretty-printed with 2-space indent (readable prefs file).
    assert.ok(readFileSync(path, "utf8").includes('"b": 2'));
    // No temp file left behind.
    assert.equal(readFileSync(path, "utf8").includes(".tmp."), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writePrefs: 覆盖写入保留未修改字段", () => {
  const dir = withTempDir();
  try {
    const path = join(dir, "prefs.json");
    writePrefs(path, { a: 1, b: 2 });
    writePrefs(path, { a: 9, b: 2 });
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    assert.deepEqual(parsed, { a: 9, b: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
