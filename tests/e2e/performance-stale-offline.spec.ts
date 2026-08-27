import { expect, test, type Page } from "playwright/test";

/**
 * P7-T7-04: page-performance resilience scenarios (stale snapshot, offline,
 * multi-renderer widget, WSL-unavailable degradation).
 *
 * Launch with the dedicated configs:
 *   npx playwright test -c playwright.config.stale-home.ts performance-stale-offline.spec.ts
 *   npx playwright test -c playwright.config.offline.ts   performance-stale-offline.spec.ts
 *
 * Scenarios are gated the same way as performance-scenarios.spec.ts: each
 * config exports an env var (AITRACKER_E2E_STALE_HOME / AITRACKER_E2E_OFFLINE)
 * that the spec reads to decide whether to run or skip.
 */

const STALE_HOME = process.env.AITRACKER_E2E_STALE_HOME ?? "";
const hasStaleHome = STALE_HOME.length > 0;
const hasOffline = (process.env.AITRACKER_E2E_OFFLINE ?? "").length > 0;

/** Fixed zh-CN / clean-storage browser state, matching the other e2e specs. */
function installStableLocaleInit(page: Page) {
  return page.addInitScript(() => {
    window.localStorage.removeItem("aitracker-locale");
    window.localStorage.removeItem("aitracker-locale-mode");
    Object.defineProperty(window.navigator, "language", {
      get: () => "zh-CN",
      configurable: true,
    });
  });
}

test.beforeEach(async ({ page }) => {
  await installStableLocaleInit(page);
});

/** 1. A 7-day-old snapshot must be served immediately (last-known-good). */
test("stale 快照时首页立即渲染，不阻塞且无错误", async ({ page }) => {
  test.skip(!hasStaleHome, "需要 playwright.config.stale-home.ts");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const startedAt = Date.now();
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  const loadMs = Date.now() - startedAt;

  expect(response?.status() ?? 0).toBeLessThan(400);
  // stale 快照走 O(1) 读取路径直接返回：首屏不应因数据过期而阻塞或重扫。
  expect(loadMs, "stale 快照首屏应在预算内返回").toBeLessThan(10_000);
  await expect(page.getByText("页面加载失败")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();
  expect(pageErrors, "不应触发未捕获页面错误").toEqual([]);
});

/**
 * 2. Browser offline must not white-screen the app; exchange rates keep
 * rendering from the cache/built-in fallback (never "live" on the read path).
 *
 * Note: Playwright's offline emulation also blocks 127.0.0.1, so any SPA
 * navigation that runs a local server-fn loader would fail while offline.
 * The scenario therefore navigates to the settings page (which displays the
 * rate + "离线可用" hint) while online, then drops the network and asserts the
 * already-rendered page keeps working — the read path never re-fetches rates.
 */
test("离线时页面仍正常渲染，汇率回退内建值且无网络白屏", async ({
  page,
  context,
}) => {
  test.skip(!hasOffline, "需要 playwright.config.offline.ts");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // 在线加载首屏并导航到设置页（loader 需要本地 RPC，必须先在线完成）。
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await expect(page.getByText("页面加载失败")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();
  await page.getByRole("link", { name: "设置", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();

  // 断网后：已渲染的页面保持可用，汇率区以缓存/内置基准渲染并展示
  // 「离线可用」提示（读路径从不联网）。
  await context.setOffline(true);
  await expect(page.getByText(/1 USD = /).first()).toBeVisible();
  await expect(page.getByText("离线可用")).toBeVisible();
  await expect(page.getByText("页面加载失败")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();

  await page.waitForTimeout(300);
  expect(pageErrors, "离线不应触发未捕获页面错误").toEqual([]);
});

/** 3. Two widget float renderers share the same server projection. */
test("多窗口 Widget 浮窗均正常渲染且无错误", async ({ page, context }) => {
  test.skip(!hasStaleHome, "需要 playwright.config.stale-home.ts");

  // 第一个窗口。
  const pageErrors1: string[] = [];
  page.on("pageerror", (error) => pageErrors1.push(error.message));
  const response1 = await page.goto("/widget?mode=float", {
    waitUntil: "domcontentloaded",
  });
  expect(response1?.status() ?? 0).toBeLessThan(400);
  await expect(page.getByText("页面加载失败")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();

  // 第二个窗口（同一浏览器上下文，独立 renderer；init 脚本需单独挂载）。
  const page2 = await context.newPage();
  await installStableLocaleInit(page2);
  const pageErrors2: string[] = [];
  page2.on("pageerror", (error) => pageErrors2.push(error.message));
  const response2 = await page2.goto("/widget?mode=float", {
    waitUntil: "domcontentloaded",
  });
  expect(response2?.status() ?? 0).toBeLessThan(400);
  await expect(page2.getByText("页面加载失败")).toHaveCount(0);
  await expect(page2.locator("main")).toBeVisible();

  await page.waitForTimeout(300);
  expect(pageErrors1, "widget 窗口1不应触发未捕获页面错误").toEqual([]);
  expect(pageErrors2, "widget 窗口2不应触发未捕获页面错误").toEqual([]);
});

/**
 * 4. /agents depends on snapshot projections only (skill + usage), never on
 * `wsl.exe` probing on the query path: with WSL topology empty/unavailable
 * (non-Windows or failed enumeration) the page degrades to the empty state
 * instead of a white screen.
 */
test("WSL 不可用时 /agents 降级渲染不白屏", async ({ page }) => {
  test.skip(!hasStaleHome, "需要 playwright.config.stale-home.ts");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/agents", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await expect(page.getByText("页面加载失败")).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForTimeout(300);
  expect(pageErrors, "/agents 不应触发未捕获页面错误").toEqual([]);
});
