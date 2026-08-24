import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTrayTitle,
  persistTrayTitleBestEffort,
  readTrayPreferencesBestEffort,
  TRAY_TITLE_PLACEHOLDER,
  updateTrayTitleIfChanged,
} from "./tray-title.js";

test("相同 Tray title 不触发原生重复写入", () => {
  let current = "12.8M";
  const writes: string[] = [];
  const changed = updateTrayTitleIfChanged(
    {
      getTitle: () => current,
      setTitle: (title) => {
        current = title;
        writes.push(title);
      },
    },
    "12.8M",
  );
  assert.equal(changed, false);
  assert.deepEqual(writes, []);
});

test("变化后的 Tray title 只写入一次", () => {
  let current = "TT";
  const writes: string[] = [];
  const target = {
    getTitle: () => current,
    setTitle: (title: string) => {
      current = title;
      writes.push(title);
    },
  };
  assert.equal(updateTrayTitleIfChanged(target, "12.8M"), true);
  assert.equal(updateTrayTitleIfChanged(target, "12.8M"), false);
  assert.deepEqual(writes, ["12.8M"]);
});

test("title cache write failure does not undo the native title", async () => {
  let current = TRAY_TITLE_PLACEHOLDER;
  const errors: unknown[] = [];
  updateTrayTitleIfChanged(
    {
      getTitle: () => current,
      setTitle: (title) => {
        current = title;
      },
    },
    "8.4M",
  );
  const persisted = await persistTrayTitleBestEffort(
    async () => {
      throw new Error("cache unavailable");
    },
    current,
    (error) => errors.push(error),
  );
  assert.equal(current, "8.4M");
  assert.equal(persisted, false);
  assert.equal(errors.length, 1);
});

test("persisted title normalization rejects empty values and caps length", () => {
  assert.equal(normalizeTrayTitle(undefined), null);
  assert.equal(normalizeTrayTitle("   "), null);
  assert.equal(normalizeTrayTitle(`  ${"x".repeat(100)}  `), "x".repeat(80));
});

test("preference read failure returns a low-noise title without rejecting startup", async () => {
  const errors: unknown[] = [];
  const result = await readTrayPreferencesBestEffort(
    async () => {
      throw new Error("broker unavailable");
    },
    (error) => errors.push(error),
  );
  assert.deepEqual(result, {
    preferences: {},
    title: TRAY_TITLE_PLACEHOLDER,
  });
  assert.equal(errors.length, 1);
});
