import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./SettingsPage.tsx", import.meta.url),
  "utf8",
);
const sectionSource = readFileSync(
  new URL("./MenuBarAppSettingsSection.tsx", import.meta.url),
  "utf8",
);

function categoryBlock(category: string, nextCategory: string): string {
  const start = source.indexOf(`category === "${category}"`);
  const end = source.indexOf(`category === "${nextCategory}"`, start);
  assert.ok(start >= 0, `缺少 ${category} 设置分类`);
  assert.ok(end > start, `无法确定 ${category} 设置分类边界`);
  return source.slice(start, end);
}

test("应用偏好按主题、语言、货币、汇率、动态栏、开机自启动排列", () => {
  const block = categoryBlock("preferences", "scan");
  const order = [
    'label={t("settings.theme")',
    'label={t("settings.language")',
    'label={t("settings.currency")',
    'label={t("settings.rate.title")',
    "<MenuBarAppSettingsSection />",
    'label={t("settings.autoLaunch")',
  ].map((marker) => block.indexOf(marker));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(
    [...order].sort((left, right) => left - right),
    order,
  );
});

test("应用偏好分类包含动态栏设置", () => {
  assert.doesNotMatch(
    categoryBlock("preferences", "scan"),
    /barStyle|barClick|defaultTab|lastTab|tone|rotate|smallContent|mediumContent|widgetTheme|WidgetConfigPanel/,
  );
  assert.match(
    categoryBlock("preferences", "scan"),
    /<MenuBarAppSettingsSection \/>/,
  );
});

test("动态栏设置只配置动态栏开关", () => {
  const block = categoryBlock("preferences", "scan");
  assert.match(block, /<MenuBarAppSettingsSection \/>/);
  assert.doesNotMatch(
    block,
    /barStyle|barClick|defaultTab|lastTab|tone|rotate|smallContent|mediumContent|widgetTheme|WidgetConfigPanel/,
  );

  assert.match(sectionSource, /settings\.menuBarApp\.dynamicBar/);
  assert.match(sectionSource, /setWidgetPref\("menuBarEnabled", enabled\)/);
  assert.equal(sectionSource.match(/<Toggle/g)?.length, 1);
  assert.doesNotMatch(
    sectionSource,
    /barStyle|barClick|defaultTab|lastTab|tone|rotate|smallContent|mediumContent|widgetTheme|WidgetConfigPanel/,
  );
});

test("设置页本体与单开关分类不重复加载 Tray 摘要数据", () => {
  assert.doesNotMatch(source, /useWidgetData|useWidgetPrefs|setTrayTitle/);
  assert.doesNotMatch(sectionSource, /useWidgetData|useNativeTrayTitleSync/);
  assert.match(sectionSource, /useWidgetPrefs\(\)/);
});
