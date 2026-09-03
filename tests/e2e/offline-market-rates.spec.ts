import { expect, test, type Page } from "playwright/test";

/**
 * Offline-PC UI scenarios for the two online integrations the user surfaces
 * directly on the settings/market pages:
 *
 *   - Security Market page (`/market`, remote Skill index API), and
 *   - the manual exchange-rate refresh (`刷新汇率` on `/settings`).
 *
 * Unlike playwright.config.offline.ts (browser offline via
 * context.setOffline — which also blocks the 127.0.0.1 dev server, so it can
 * only assert an already-rendered page), these configs emulate a PC with NO
 * internet on the SERVER side: scripts/e2e/net-block-hook.mjs is loaded into
 * the Vite dev-server process and makes every non-loopback fetch fail
 * immediately, while renderer ↔ local server traffic keeps working. That is
 * the same failure the real offline desktop sees (fetch/DNS error).
 *
 * Launch with the dedicated configs:
 *   npx playwright test -c playwright.config.offline-warm.ts offline-market-rates.spec.ts
 *   npx playwright test -c playwright.config.offline-cold.ts offline-market-rates.spec.ts
 *
 * Scenarios are gated exactly like performance-stale-offline.spec.ts: the
 * config exports AITRACKER_E2E_OFFLINE_WARM / AITRACKER_E2E_OFFLINE_COLD and
 * the spec reads them to run or skip. Warm = seeded market-list + rate http
 * cache; cold = no cache at all.
 */

const hasWarm = (process.env.AITRACKER_E2E_OFFLINE_WARM ?? "").length > 0;
const hasCold = (process.env.AITRACKER_E2E_OFFLINE_COLD ?? "").length > 0;

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

/** Collects uncaught renderer errors; asserts they stay empty at the end. */
function collectPageErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return pageErrors;
}

/** Settle barrier: the hydration i18n effect rewrites ?locale= late. */
async function settle(page: Page) {
  await page.waitForURL(/locale=/, { timeout: 30_000 }).catch(() => undefined);
}

test.beforeEach(async ({ page }) => {
  await installStableLocaleInit(page);
});

// ---------------------------------------------------------------------------
// Warm cache: a previous online session wrote both caches; the machine then
// lost internet. The pages must keep serving the cached content and label it
// as cache — never white-screen or re-enter a loading spinner forever.
// ---------------------------------------------------------------------------

test("离线(有缓存): 安全市场列表正常渲染,不请求网络,无错误", async ({
  page,
}) => {
  test.skip(!hasWarm, "需要 playwright.config.offline-warm.ts");
  const pageErrors = collectPageErrors(page);

  const response = await page.goto("/market", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await settle(page);

  // KPI strip reports the seeded total instead of a network-dependent 0.
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText("Offline Demo Skill")).toBeVisible();
  await expect(page.getByText("共 1 个 Skill")).toBeVisible();

  // No failure toast, no cache warning on the fresh-cache read path.
  await expect(page.getByText("网络不可用：安全市场加载失败")).toHaveCount(0);
  await expect(page.getByText("网络不可用，正在显示本地缓存结果")).toHaveCount(
    0,
  );
  await expect(page.getByText("页面加载失败")).toHaveCount(0);

  await page.waitForTimeout(400);
  expect(pageErrors, "离线安全市场不应触发未捕获页面错误").toEqual([]);
});

test("离线(有缓存): 手动刷新安全市场失败后回退本地缓存并显示警告", async ({
  page,
}) => {
  test.skip(!hasWarm, "需要 playwright.config.offline-warm.ts");
  const pageErrors = collectPageErrors(page);

  const response = await page.goto("/market", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await settle(page);
  await expect(page.getByText("Offline Demo Skill")).toBeVisible();

  // Force refresh: the network attempt fails, fetchMarketSkills falls back to
  // the cache and surfaces the "network unavailable, showing cache" warning.
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(
    page.getByText("网络不可用，正在显示本地缓存结果"),
  ).toBeVisible();
  await expect(page.getByText("Offline Demo Skill")).toBeVisible();
  await expect(page.getByText("网络不可用：安全市场加载失败")).toHaveCount(0);
  await expect(page.getByText("页面加载失败")).toHaveCount(0);

  await page.waitForTimeout(400);
  expect(pageErrors, "离线刷新安全市场不应触发未捕获页面错误").toEqual([]);
});

test("离线(有缓存): 设置页显示缓存汇率+离线提示,手动刷新仍保持可用", async ({
  page,
}) => {
  test.skip(!hasWarm, "需要 playwright.config.offline-warm.ts");
  const pageErrors = collectPageErrors(page);

  const response = await page.goto("/settings", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await settle(page);

  // Seeded rate row: CNY 7.1 with source "缓存" and the offline hint.
  const rateLine = page.getByText(/1 USD = 7\.1 CNY/);
  await expect(rateLine).toBeVisible();
  await expect(page.getByText(/当前为缓存汇率，离线可用/)).toBeVisible();

  // Manual refresh while offline must not hang, crash or swap to a live
  // label; last-known-good stays in place. The result is NOT live, so the UI
  // must say the refresh failed (cache kept) instead of claiming "updated".
  await page.getByRole("button", { name: "刷新汇率", exact: true }).click();
  await expect(rateLine).toBeVisible();
  await expect(page.getByText(/当前为缓存汇率，离线可用/)).toBeVisible();
  await expect(
    page.getByText("汇率更新失败，已使用缓存或内置基准"),
  ).toBeVisible();
  await expect(page.getByText("汇率已更新", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "刷新汇率", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("页面加载失败")).toHaveCount(0);

  await page.waitForTimeout(400);
  expect(pageErrors, "离线刷新汇率不应触发未捕获页面错误").toEqual([]);
});

// ---------------------------------------------------------------------------
// Cold cache: a brand-new/cleared machine with no internet. The market page
// must degrade to a shell + explicit network-unavailable feedback, and the
// rate row must fall back to the built-in baseline — never an RPC error or a
// white screen.
// ---------------------------------------------------------------------------

test("离线(无缓存): 安全市场页面降级渲染并提示网络不可用,不白屏", async ({
  page,
}) => {
  test.skip(!hasCold, "需要 playwright.config.offline-cold.ts");
  const pageErrors = collectPageErrors(page);

  const response = await page.goto("/market", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await settle(page);

  // The shell still renders (KPI strip + main landmark) — no white screen.
  await expect(page.locator("main")).toBeVisible();
  await expect(
    page.getByText("安全市场上架 Skill", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("页面加载失败")).toHaveCount(0);

  // The failed list fetch surfaces the network-unavailable toast.
  await expect(page.getByText("网络不可用：安全市场加载失败")).toBeVisible();

  // The empty area must say "network unavailable", NOT "no matching Skills"
  // (a request failure is not a search miss).
  await expect(page.getByText("网络不可用，安全市场暂不可访问")).toBeVisible();
  await expect(page.getByText("没有匹配的 Skill", { exact: true })).toHaveCount(
    0,
  );

  // Manual retry keeps the page stable (still graceful, still offline).
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText("网络不可用，安全市场暂不可访问")).toBeVisible();
  await expect(page.getByText("页面加载失败")).toHaveCount(0);

  await page.waitForTimeout(400);
  expect(pageErrors, "冷启动离线安全市场不应触发未捕获页面错误").toEqual([]);
});

test("离线(无缓存): 设置页显示内置基准汇率+离线提示,手动刷新仍可用", async ({
  page,
}) => {
  test.skip(!hasCold, "需要 playwright.config.offline-cold.ts");
  const pageErrors = collectPageErrors(page);

  const response = await page.goto("/settings", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await settle(page);

  // No cache at all → built-in baseline (BUILTIN_RATES.CNY = 7.2) with the
  // source "内置基准" and the offline hint.
  const rateLine = page.getByText(/1 USD = 7\.2 CNY/);
  await expect(rateLine).toBeVisible();
  await expect(page.getByText(/当前为内置基准汇率，离线可用/)).toBeVisible();

  // Manual refresh while offline: completes, keeps last-known-good (built-in).
  // The result is NOT live, so the UI must say the refresh failed instead of
  // claiming "updated".
  await page.getByRole("button", { name: "刷新汇率", exact: true }).click();
  await expect(rateLine).toBeVisible();
  await expect(page.getByText(/当前为内置基准汇率，离线可用/)).toBeVisible();
  await expect(
    page.getByText("汇率更新失败，已使用缓存或内置基准"),
  ).toBeVisible();
  await expect(page.getByText("汇率已更新", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "刷新汇率", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("页面加载失败")).toHaveCount(0);

  await page.waitForTimeout(400);
  expect(pageErrors, "离线刷新汇率(内置基准)不应触发未捕获页面错误").toEqual(
    [],
  );
});
