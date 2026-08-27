import { expect, test } from "playwright/test";

test.use({ locale: "zh-CN" });

test("透明白玻璃浮窗概览可用", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto(
    "/widget?mode=float&locale=zh-CN&currency=CNY",
    { waitUntil: "domcontentloaded" },
  );
  expect(response?.status() ?? 0).toBeLessThan(400);

  await expect(page.locator(".aitracker-glass-overview").first()).toBeVisible();
  await expect(
    page.locator(".aitracker-glass-agent-list").first(),
  ).toBeVisible();
  await expect(page.locator(".aitracker-glass-chart").first()).toBeVisible();
  await expect(page.locator(".aitracker-glass-security").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("7 日 Token 趋势悬浮显示对应日期，移出恢复今日摘要", async ({ page }) => {
  await page.goto("/widget?mode=float&locale=zh-CN&currency=CNY", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle");

  const summary = page.getByTestId("widget-token-trend-summary");
  const todaySummary = await summary.textContent();
  expect(todaySummary).toMatch(/^今日 /);

  const firstBar = page.locator(".aitracker-glass-bar-column").first();
  await expect(firstBar).toBeVisible();
  const pointSummary = await firstBar.getAttribute("aria-label");
  expect(pointSummary).toMatch(/^\d+月\d+日 /);

  await firstBar.hover();
  await expect(summary).toHaveText(pointSummary ?? "");

  await page.mouse.move(0, 0);
  await expect(summary).toHaveText(todaySummary ?? "");
});

test("浮窗没有设置入口并始终保留三个 Agent 槽位", async ({ page }) => {
  await page.goto("/widget?mode=float&locale=zh-CN&currency=CNY", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("button", { name: "小组件设置" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "返回浮窗" })).toHaveCount(0);
  await expect(
    page.locator('.aitracker-glass-overview a[href^="/"]'),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "立即扫描" })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成简报" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开仪表盘" })).toBeVisible();
  await expect(page.locator(".aitracker-glass-settings")).toHaveCount(0);
  await expect(page.getByTestId("widget-config-row")).toHaveCount(0);

  const agentSlots = page.getByTestId("widget-agent-slot");
  await expect(agentSlots).toHaveCount(3);
  expect(
    await agentSlots.evaluateAll((elements) =>
      elements.every(
        (element) => element.getBoundingClientRect().height === 23,
      ),
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".aitracker-glass-overview")
      .evaluate((element) => getComputedStyle(element, "::after").opacity),
  ).toBe("1");
});

test("浮窗应用入口全部交给桌面主窗口路由", async ({ page }) => {
  await page.goto("/widget?mode=float&locale=zh-CN&currency=CNY", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    const target = window as unknown as {
      desktopApi: { openWindowRoute: (route: string) => Promise<void> };
      openedDesktopRoutes: string[];
    };
    target.openedDesktopRoutes = [];
    Object.defineProperty(target, "desktopApi", {
      configurable: true,
      value: {
        openWindowRoute: async (route: string) => {
          target.openedDesktopRoutes.push(route);
        },
      },
    });
  });

  const floatUrl = page.url();
  await page.locator(".aitracker-glass-security").click();
  await page.getByRole("button", { name: "立即扫描" }).click();
  await page.getByRole("button", { name: "生成简报" }).click();
  await page.getByRole("button", { name: "打开仪表盘" }).click();

  expect(page.url()).toBe(floatUrl);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { openedDesktopRoutes: string[] })
          .openedDesktopRoutes,
    ),
  ).toEqual(["/security", "/security", "/reports", "/"]);
});

test("Electron 浮窗模式完整绕过主应用壳且不裁切", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 680 });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto(
    "/widget?mode=float&locale=zh-CN&currency=CNY",
    { waitUntil: "domcontentloaded" },
  );
  expect(response?.status() ?? 0).toBeLessThan(400);

  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.getByText("全程本地执行", { exact: true })).toHaveCount(0);
  const widget = page.locator(".aitracker-glass-overview");
  await expect(widget).toBeVisible();
  await expect(page.getByRole("button", { name: "打开仪表盘" })).toBeVisible();
  await expect(page.locator(".aitracker-glass-memory-grid")).toHaveCSS(
    "display",
    "grid",
  );
  const stage = page.locator(".aitracker-widget-float-stage");
  await expect(stage).toHaveCSS("background-image", "none");
  await expect(stage).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  const box = await widget.boundingBox();
  const securityBox = await page
    .locator(".aitracker-glass-security")
    .boundingBox();
  const footerBox = await page.locator(".aitracker-glass-footer").boundingBox();
  expect(box).not.toBeNull();
  expect(securityBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(box!.x).toBeCloseTo(0);
  expect(box!.y).toBeCloseTo(0);
  expect(box!.width).toBeCloseTo(420);
  expect(box!.height).toBeCloseTo(680);
  expect(
    box!.y + box!.height - (footerBox!.y + footerBox!.height),
  ).toBeLessThan(2);
  expect(footerBox!.y - (securityBox!.y + securityBox!.height)).toBeLessThan(2);
  await expect(page.getByTestId("widget-agent-slot")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "小组件设置" })).toHaveCount(0);
  await expect(page.locator(".aitracker-glass-watermark")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
