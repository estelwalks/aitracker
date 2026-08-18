import assert from "node:assert/strict";
import { posix, win32 } from "node:path";
import test from "node:test";

import { normalizeProjectPathFor } from "./project-path.ts";

test("win32: home itself becomes ~", () => {
  assert.equal(
    normalizeProjectPathFor(win32, "C:\\Users\\u", "C:\\Users\\u"),
    "~",
  );
});

test("posix: home itself becomes ~", () => {
  assert.equal(normalizeProjectPathFor(posix, "/home/u", "/home/u"), "~");
});

test("win32: paths under home become ~/relative with forward slashes", () => {
  assert.equal(
    normalizeProjectPathFor(win32, "C:\\Users\\u\\work\\app", "C:\\Users\\u"),
    "~/work/app",
  );
  // Forward-slash input is normalized the same way.
  assert.equal(
    normalizeProjectPathFor(win32, "C:/Users/u/work/app", "C:/Users/u"),
    "~/work/app",
  );
});

test("posix: paths under home become ~/relative", () => {
  assert.equal(
    normalizeProjectPathFor(posix, "/home/u/work/app", "/home/u"),
    "~/work/app",
  );
});

test("win32: cross-drive absolute paths keep their absolute form (regression)", () => {
  // win32.relative("C:\\Users\\u", "D:\\Dev\\app") returns "D:\\Dev\\app"
  // itself; prefixing ~/ would mangle it into "~/D:/Dev/app" and hide the
  // project from the dashboard overview.
  assert.equal(
    normalizeProjectPathFor(
      win32,
      "D:\\Dev\\trusttools_webapp",
      "C:\\Users\\u",
    ),
    "D:\\Dev\\trusttools_webapp",
  );
  assert.equal(
    normalizeProjectPathFor(win32, "D:/Dev/trusttools_webapp", "C:/Users/u"),
    "D:/Dev/trusttools_webapp",
  );
});

test("win32: external absolute paths on the same drive keep their absolute form", () => {
  assert.equal(
    normalizeProjectPathFor(win32, "C:\\opt\\external", "C:\\Users\\u"),
    "C:\\opt\\external",
  );
});

test("posix: external absolute paths keep their absolute form", () => {
  assert.equal(
    normalizeProjectPathFor(posix, "/opt/external", "/home/u"),
    "/opt/external",
  );
});

test("posix: parent-of-home paths keep their absolute form", () => {
  assert.equal(normalizeProjectPathFor(posix, "/home", "/home/u"), "/home");
});

test("relative paths pass through untouched on both implementations", () => {
  assert.equal(
    normalizeProjectPathFor(win32, "relative/proj", "C:\\Users\\u"),
    "relative/proj",
  );
  assert.equal(
    normalizeProjectPathFor(posix, "relative/proj", "/home/u"),
    "relative/proj",
  );
  assert.equal(
    normalizeProjectPathFor(win32, "unknown", "C:\\Users\\u"),
    "unknown",
  );
});
