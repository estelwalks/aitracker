import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  __resetNativeTrayTitleSyncForTest,
  startNativeTrayInsightRotation,
  syncNativeTrayTitle,
} from "./native-tray-title-sync";

const summary = {
  tokens: "12.8M",
  tool: "Codex",
  detail: "87% cache",
};

beforeEach(() => {
  __resetNativeTrayTitleSyncForTest();
});

test("原生 Tray 在关闭动态栏后立即同步为纯 Token 标题", async () => {
  const titles: string[] = [];
  await syncNativeTrayTitle(
    {
      setTrayTitle: async (title) => {
        titles.push(title);
      },
    },
    { dynamic: false, ...summary },
  );
  assert.deepEqual(titles, ["12.8M"]);
});

test("原生 Tray 在开启动态栏后立即同步丰富摘要", async () => {
  const titles: string[] = [];
  await syncNativeTrayTitle(
    {
      setTrayTitle: async (title) => {
        titles.push(title);
      },
    },
    { dynamic: true, ...summary },
  );
  assert.deepEqual(titles, ["12.8M · Codex · 87% cache"]);
});

test("浏览器环境没有 Electron bridge 时安全跳过同步", () => {
  assert.equal(
    syncNativeTrayTitle(undefined, { dynamic: false, ...summary }),
    undefined,
  );
});

test("同一 renderer 不重复发送相同 Tray 标题", async () => {
  const titles: string[] = [];
  const desktop = {
    setTrayTitle: async (title: string) => {
      titles.push(title);
    },
  };
  await syncNativeTrayTitle(desktop, { dynamic: false, ...summary });
  await syncNativeTrayTitle(desktop, { dynamic: false, ...summary });
  assert.deepEqual(titles, ["12.8M"]);
});

test("菜单栏洞察按 rotate 间隔轮换并在清理时停止", () => {
  let callback: (() => void) | undefined;
  let delayMs: number | undefined;
  let clearedHandle: number | undefined;
  let rotations = 0;
  const stop = startNativeTrayInsightRotation(
    10,
    3,
    () => {
      rotations += 1;
    },
    {
      setInterval(next, delay) {
        callback = next;
        delayMs = delay;
        return 21;
      },
      clearInterval(handle) {
        clearedHandle = handle;
      },
    },
  );

  assert.equal(delayMs, 10_000);
  callback?.();
  assert.equal(rotations, 1);
  stop();
  assert.equal(clearedHandle, 21);
});

test("rotate=0 或只有一条洞察时不创建定时器", () => {
  let timers = 0;
  const timer = {
    setInterval() {
      timers += 1;
      return 22;
    },
    clearInterval() {},
  };
  startNativeTrayInsightRotation(0, 3, () => {}, timer);
  startNativeTrayInsightRotation(10, 1, () => {}, timer);
  assert.equal(timers, 0);
});
