import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellSource = readFileSync(
  new URL("./AppShell.tsx", import.meta.url),
  "utf8",
);
const syncSource = readFileSync(
  new URL(
    "../modules/widget/presentation/NativeTrayTitleSync.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("主窗口 AppShell 常驻挂载无 UI Tray 同步器", () => {
  const floatBranch = shellSource.indexOf("if (isWidgetFloat)");
  const synchronizer = shellSource.indexOf("<NativeTrayTitleSync />");
  assert.ok(floatBranch >= 0);
  assert.ok(synchronizer > floatBranch);
  assert.match(syncSource, /return null/);
});

test("启动同步等待持久化偏好和当前 Token 数据就绪", () => {
  assert.match(syncSource, /prefs, hydrated/);
  assert.match(syncSource, /getWidgetReadModel/);
  assert.match(syncSource, /desktopAvailable && hydrated && today != null/);
  assert.match(syncSource, /refetchIntervalInBackground: true/);
  assert.doesNotMatch(
    syncSource,
    /useWidgetData|useSecurityScanOverview|getMemoryAssets/,
  );
});
