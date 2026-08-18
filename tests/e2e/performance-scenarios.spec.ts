import { expect, test } from "playwright/test";

/**
 * P7-T7-04: page-performance resilience scenarios.
 *
 * Runs against a dev server whose `TRUSTTOOLS_USAGE_HOME` points at an empty
 * temporary directory, simulating a fresh install with no snapshots: pages
 * must render the shell/empty state (never a white screen or the load-failed
 * boundary), stay within a reasonable response budget, and support retry.
 *
 * Launch with the dedicated config:
 *   npx playwright test -c playwright.config.empty-home.ts performance-scenarios.spec.ts
 */

const EMPTY_HOME = process.env.TRUSTTOOLS_E2E_EMPTY_HOME ?? "";
const hasEmptyHome = EMPTY_HOME.length > 0;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem("tt-locale");
    window.localStorage.removeItem("tt-locale-mode");
    Object.defineProperty(window.navigator, "language", {
      get: () => "zh-CN",
      configurable: true,
    });
  });
});

/** The dashboard must render its shell + empty state without errors. */
test("无快照时首页渲染空态而非错误页", async ({ page }) => {
  test.skip(!hasEmptyHome, "需要 playwright.config.empty-home.ts");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const startedAt = Date.now();
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  const loadMs = Date.now() - startedAt;

  expect(response?.status() ?? 0).toBeLessThan(400);
  // 无快照页面应在预算内返回（首屏 ≤ 300ms + 开发模式余量）。
  expect(loadMs).toBeLessThan(10_000);
  // 必须渲染应用壳（PageBar/导航），而不是白屏或错误页。
  await expect(page.getByText("页面加载失败")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();
  expect(pageErrors, "不应触发未捕获页面错误").toEqual([]);
});

/** Settings is a lightweight route and must load without snapshots. */
test("无快照时设置页正常渲染", async ({ page }) => {
  test.skip(!hasEmptyHome, "需要 playwright.config.empty-home.ts");
  const response = await page.goto("/settings", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await expect(page.getByText("页面加载失败")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();
});

/** Widget route must render in float mode without snapshots. */
test("无快照时 Widget 浮窗模式正常渲染", async ({ page }) => {
  test.skip(!hasEmptyHome, "需要 playwright.config.empty-home.ts");
  const response = await page.goto("/widget?mode=float", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await expect(page.getByText("页面加载失败")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();
});

/** Lazy route chunks must load on demand without errors (T6-04). */
test("懒加载路由（/agents）按需加载且无错误", async ({ page }) => {
  test.skip(!hasEmptyHome, "需要 playwright.config.empty-home.ts");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto("/agents", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await expect(page.getByText("页面加载失败")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForTimeout(300);
  expect(pageErrors, "懒加载不应触发页面错误").toEqual([]);
});
