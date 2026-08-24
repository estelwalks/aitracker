import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  __resetNativeTrayTitleSyncForTest,
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
