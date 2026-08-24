import { expect, test } from "playwright/test";

test("菜单栏胶囊与透明白玻璃概览同时可用", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/widget?locale=zh-CN&currency=CNY", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);

  const pill = page.locator(".tt-menubar-glass");
  await expect(pill).toBeVisible();
  await expect(page.locator(".tt-glass-overview").first()).toBeVisible();
  await expect(page.locator(".tt-glass-agent-list").first()).toBeVisible();
  await expect(page.locator(".tt-glass-chart").first()).toBeVisible();
  await expect(page.locator(".tt-glass-security").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
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
  const widget = page.locator(".tt-glass-overview");
  await expect(widget).toBeVisible();
  await expect(
    page.getByRole("link", { name: "打开 Dashboard" }),
  ).toBeVisible();
  await expect(page.locator(".tt-glass-memory-grid")).toHaveCSS(
    "display",
    "grid",
  );

  const box = await widget.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(420);
  expect(box!.y + box!.height).toBeLessThanOrEqual(680);
  expect(pageErrors).toEqual([]);
});
