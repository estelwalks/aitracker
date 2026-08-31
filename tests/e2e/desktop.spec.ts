import { expect, test, type Page } from "playwright/test";
import { PUBLIC_TOOL_MANIFEST } from "../../src/lib/tool-registry/public-manifest.generated";

// F6-S3: the sources page's tool total is derived from the same registry the
// server projects (`AI_TOOLS`), so assert against the manifest instead of a
// magic number.
const TOOL_COUNT = PUBLIC_TOOL_MANIFEST.tools.length;

test.beforeEach(async ({ page }) => {
  // Fixed browser system language to zh-CN and no stored preference, ensuring the default language is Chinese
  // (Consistent with existing practice in locale.spec.ts; otherwise Playwright defaults to en-US in
  // When the client i18n converges, the interface is translated into English, destroying the Chinese copywriting assertion).
  await page.addInitScript(() => {
    window.localStorage.removeItem("aitracker-locale");
    window.localStorage.removeItem("aitracker-locale-mode");
    Object.defineProperty(window.navigator, "language", {
      get: () => "zh-CN",
      configurable: true,
    });
  });
});

const routes = [
  { path: "/", heading: "今日洞察" },
  { path: "/agents", heading: /Agent 体检/ },
  { path: "/skills", heading: "今日洞察" },
  { path: "/security", heading: "安全播报" },
  { path: "/settings", heading: "设置" },
  { path: "/memory", heading: "今日洞察" },
  { path: "/chats", heading: "今日洞察" },
] as const;

async function openRouteWithoutPageErrors(
  page: Page,
  path: string,
  heading: string,
) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto(path, { waitUntil: "domcontentloaded" });

  expect(response, `${path} 应返回页面响应`).not.toBeNull();
  expect(response?.status(), `${path} 不应返回 HTTP 错误`).toBeLessThan(400);
  await expect(
    page.getByRole("heading", { name: heading, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "页面加载失败" })).toHaveCount(
    0,
  );
  // Let the client settle before asserting zero page errors. The hydration
  // i18n effect writes `?locale=` (existing suite convention), so waiting for
  // it is a deterministic settle barrier instead of a fixed sleep.
  await page.waitForURL(/locale=/, { timeout: 30_000 }).catch(() => undefined);
  expect(pageErrors, `${path} 不应触发未捕获页面错误`).toEqual([]);
}

for (const route of routes) {
  test(`${route.path} 可访问且无页面错误`, async ({ page }) => {
    await openRouteWithoutPageErrors(page, route.path, route.heading);
  });
}

test("首页展示真实数据", async ({ page }) => {
  await page.goto("/");

  // The new home page exposes real insight, metric-card, and event-count signals.
  await expect(
    page.getByRole("heading", { name: "今日洞察", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Token 消耗").first()).toBeVisible();
  // Deputy copy of the first indicator card (Token consumption): True cost amount · Compared with the previous N days
  // (When the price catalog is unknown, it falls back to "N events observed")
  await expect(
    page.getByText(/(¥[\d.,]+|已观测 [\d,]+ 条事件)/).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/概览\s*[\d.]+[KMB]? tokens/).first(),
  ).toBeVisible();
  // Sub-copy of the cost estimate card: daily average / expected projection for this month (when the price is unknown, it will fall back to "The price of some models is unknown...")
  await expect(
    page
      .getByText(/(日均 .*预计本月|部分模型价格未知，金额为已知下限)/)
      .first(),
  ).toBeVisible();
  // "Local collection status" is no longer on the new homepage (the collection status card of the old UI has been removed)
  await expect(page.getByText("本地采集状态", { exact: true })).toHaveCount(0);
});

test("首页展示活跃日历热力图与真实事件聚合", async ({ page }) => {
  await page.goto("/");

  // New homepage heat map = "Active Calendar · Last 12 Months"; the 7 × 24 heat map of the old UI has been removed
  await expect(
    page.getByRole("heading", { name: /^活跃日历 · 近 12 个月/ }),
  ).toBeVisible();
  // Isolating empty Homes must also honestly display zero active summaries and not fake events.
  await expect(page.getByText(/\d+ 天活跃/).first()).toBeVisible();
});

test("Skill Hub 展示真实本地 Skill 数量", async ({ page }) => {
  await page.goto("/skills");

  // PageBar summary shows the actual number of local Skills (13 on current machine).
  // The old five-second polling note was removed from the current UI, so it is not asserted.
  await expect(
    page.getByRole("button", { name: /^共 \d+ 个 Skill$/ }),
  ).toBeVisible();
});

test("Skill 当前筛选结果支持多选和全选但不执行清理", async ({ page }) => {
  test.setTimeout(120_000);
  // Skill asset management is in /skills (only local workspace after split, market is in separate /market);
  // The selection button is a button with aria-label "Select <name>" (non-native checkbox),
  // The text of the select all button is "N Skills in total".
  // The loader of /skills concurrently pulls workspace/dashboard/distillation under high load on the local machine.
  // The first screen may take longer than the default 30 seconds, so explicitly relax the goto and overall timeout.
  await page.goto("/skills", { timeout: 90_000 });
  await page.waitForURL(/locale=/, { timeout: 30_000 });

  const skillSelect = page.getByRole("button", { name: /^选择 / });
  expect(await skillSelect.count()).toBeGreaterThanOrEqual(2);

  await skillSelect.nth(0).click();
  await skillSelect.nth(1).click();
  await expect(page.getByText("已选 2 项", { exact: true })).toBeVisible();

  // Select all of the current page: The same toggle button displays "N items selected" in the selected state. Click to select all
  const selectAll = page
    .locator("main button")
    .filter({ hasText: /^已选 \d+ 项$/ });
  await selectAll.first().click();
  await expect(page.getByText(/^已选 \d+ 项$/).first()).toBeVisible();
  const selectedAfter = await page
    .locator("main button")
    .filter({ hasText: /^已选 (\d+) 项$/ })
    .first()
    .textContent();
  const selectedCount = Number(
    selectedAfter?.match(/^已选 (\d+) 项$/)?.[1] ?? "0",
  );
  expect(selectedCount).toBeGreaterThan(2);

  // Batch actions are available (but no cleanup is performed)
  const uninstall = page.locator("main button").filter({ hasText: "卸载" });
  await expect(uninstall.first()).toBeEnabled();
  const sync = page.locator("main button").filter({ hasText: "同步" });
  await expect(sync.first()).toBeEnabled();

  // Return to empty selection state after deselecting
  await page.locator("main button").filter({ hasText: "取消" }).click();
  await expect(page.getByText(/^共 \d+ 个 Skill$/).first()).toBeVisible();
});

test("市场搜索 draw.io 后展示真实结果", async ({ page }) => {
  // The market is a standalone /market route with the security-market list layout.
  await page.goto("/market");
  // Waiting for React hydration to complete: the locale parameter appears in the URL, that is, the search-param synchronization has taken over
  // (React mounts onChange during hydration commit, earlier than i18n where ?locale= is written
  // effect), so there is no need to fix sleep before fill - fill itself will wait for the input box to be editable.
  await page.waitForURL(/locale=/, { timeout: 15_000 });

  const search = page.getByPlaceholder("搜索 Skill 名称、源路径或能力");
  await search.fill("draw.io");
  // Scorecard renders draw.io text with real name/description (search box value does not participate in getByText matching)
  await expect(page.getByText(/draw\.io/i).first()).toBeVisible({
    timeout: 20_000,
  });
});

test("安全页浏览器下检测服务已连接", async ({ page }) => {
  // The browser e2e runs at http://127.0.0.1:41737, which meets the requirements of companion client
  // isCompanionOrigin check; Vite/Nitro dev server provides /api/security/*,
  // Therefore, the /security page uses the "companion" transport connection detection service instead of the old unavailable
  // Use boot state. Never click the scan button to avoid triggering real native Skill I/O.
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/security", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "安全播报", exact: true }),
  ).toBeVisible();

  // Main CTA visible (but not clickable)
  await expect(page.getByRole("button", { name: "立即检测" })).toBeVisible();

  // The old unusable boot state must disappear
  await expect(
    page.getByText("本机伴随服务不可用", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/不会读取本机 Skill/)).toHaveCount(0);

  // The broadcast summary (health level) is visible
  await expect(page.getByText("健康度", { exact: true }).first()).toBeVisible();

  // There should be no uncaught page faults after a brief settlement (with hydration's ?locale= written as
  // deterministic settle barrier, alternative to fixed wait)
  await page.waitForURL(/locale=/, { timeout: 30_000 }).catch(() => undefined);
  expect(pageErrors, "/security 不应触发未捕获页面错误").toEqual([]);
});

test("安全页连接检测服务且不自动触发扫描", async ({ page }) => {
  // Browser connection detection service (companion transport), but never automatically triggered when the page loads
  // Scan: Do not click any scan button, the scanning status should remain idle, and the vortex during scanning should not appear.
  // Overlay ("Detection Progress:..." mark).
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/security", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "安全播报", exact: true }),
  ).toBeVisible();

  // Main CTA visible (but not clickable)
  await expect(page.getByRole("button", { name: "立即检测" })).toBeVisible();

  // The broadcast summary (health level) is visible
  await expect(page.getByText("健康度", { exact: true }).first()).toBeVisible();

  // The page is connected (the old unavailable boot state is not displayed)
  await expect(
    page.getByText("本机伴随服务不可用", { exact: true }),
  ).toHaveCount(0);

  // Do not click to scan the CTA; write hydration's ?locale= as an assertion after the settle barrier
  // No scan in progress for markers (alternative to fixed wait)
  await page.waitForURL(/locale=/, { timeout: 30_000 }).catch(() => undefined);
  await expect(page.getByText(/检测进度：/)).toHaveCount(0);
  await expect(page.getByText("扫描中", { exact: true })).toHaveCount(0);

  // There should be no uncaught page faults after a brief settlement
  expect(pageErrors, "/security 不应触发未捕获页面错误").toEqual([]);
});

test("设置加载完成", async ({ page }) => {
  await page.goto("/settings");
  await page.waitForURL(/locale=/, { timeout: 30_000 });

  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("开机自启动", { exact: true })).toBeVisible();
  // Data paths belong to the "Data and Storage" category and are not mixed with application preferences in the same panel.
  await page.getByRole("button", { name: "数据与存储", exact: true }).click();
  await expect(page.getByText("数据路径", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "清除缓存", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "应用偏好", exact: true }).click();
  await expect(page.getByText("主题", { exact: true })).toBeVisible();
});

test("本地采集状态仅在数据来源页展示真实结果", async ({ page }) => {
  test.setTimeout(120_000);
  // Under high load on the machine, the first screen may exceed the default 30s, so explicitly relax the goto and overall timeout.
  await page.goto("/", { timeout: 90_000 });
  await expect(page.getByText("本地采集状态", { exact: true })).toHaveCount(0);

  await page.goto("/sources", { timeout: 90_000 });
  await expect(
    page.getByRole("heading", { name: /Agent 生态 · \d+ 项/ }),
  ).toBeVisible();
  await expect(page.getByText("已接入Agent", { exact: true })).toBeVisible();
  await expect(page.getByText("采集事件", { exact: true })).toBeVisible();
  // PATH may hit some global executables, and even HOME isolation is not equivalent to zero installation.
  // The sum of verification status covers the complete tool catalog and preserves scanned catalog evidence.
  const connectedLabel = await page
    .getByText("已接入Agent", { exact: true })
    .locator("..")
    .locator("..")
    .textContent();
  const missingLabel = await page
    .getByRole("button", { name: /^未安装 \d+$/ })
    .textContent();
  const connectedCount = Number(connectedLabel?.match(/\d+/)?.[0] ?? NaN);
  const missingCount = Number(missingLabel?.match(/\d+$/)?.[0] ?? NaN);
  expect(connectedCount + missingCount).toBe(TOOL_COUNT);
  await expect(page.getByText(/扫描目录：/).first()).toBeVisible();
});

test("设置页偏好可修改并在当前隔离上下文持久化", async ({ page }) => {
  await page.goto("/settings");

  // Wait for React hydration to complete (the locale parameter in the URL, search-param, has been synchronized
  // Takeover): Otherwise the click will hit the SSR static button (no event handler) and the changes will not take effect.
  await page.waitForURL(/locale=/, { timeout: 15_000 });

  await page.getByRole("button", { name: "应用偏好", exact: true }).click();
  await page.getByRole("button", { name: "USD", exact: true }).click();
  await expect(page).toHaveURL(/currency=USD/);

  await page.reload();
  await expect(page).toHaveURL(/currency=USD/);
});
