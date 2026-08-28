import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APP_BRAND_ICON_DARK_URL,
  APP_BRAND_ICON_LIGHT_URL,
} from "../lib/app-config.ts";

const shellSource = readFileSync(
  new URL("./AppShell.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../styles.css", import.meta.url),
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

test("侧边栏品牌标识使用独立的深浅主题资源", () => {
  assert.equal(
    APP_BRAND_ICON_DARK_URL,
    "/brand-logos/ai-tracker/ai-tracker-icon-color-dark.png",
  );
  assert.equal(
    APP_BRAND_ICON_LIGHT_URL,
    "/brand-logos/ai-tracker/ai-tracker-icon-color-light.png",
  );
  assert.match(shellSource, /src=\{APP_BRAND_ICON_DARK_URL\}/);
  assert.match(shellSource, /src=\{APP_BRAND_ICON_LIGHT_URL\}/);
  assert.doesNotMatch(shellSource, /ai-tracker-icon-app\.png/);
  assert.match(
    stylesSource,
    /\.theme-light \.aitracker-brand-mark-dark\s*{\s*display: none;/,
  );
  assert.match(
    stylesSource,
    /\.theme-light \.aitracker-brand-mark-light\s*{\s*display: block;/,
  );
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
