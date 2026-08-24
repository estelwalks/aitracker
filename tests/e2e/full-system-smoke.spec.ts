import { expect, test, type Page } from "playwright/test";

const ROUTES = [
  "/",
  "/agents",
  "/skills",
  "/security",
  "/settings",
  "/memory",
  "/chats",
  "/reports",
  "/distill",
  "/market",
  "/tracker",
  "/sources",
  "/widget",
] as const;

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

async function assertRouteHealthy(page: Page, route: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto(route, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  expect(response, `${route} 应返回响应`).not.toBeNull();
  expect(response?.status(), `${route} 不应返回 HTTP 错误`).toBeLessThan(400);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: "页面加载失败" })).toHaveCount(
    0,
  );
  await page.waitForTimeout(300);
  expect(pageErrors, `${route} 不应触发未捕获页面错误`).toEqual([]);
}

test.describe("全系统路由冒烟", () => {
  for (const route of ROUTES) {
    test(`${route} 可访问且无页面错误`, async ({ page }) => {
      await assertRouteHealthy(page, route);
    });
  }
});

test("数据来源页支持状态筛选和平台目录", async ({ page }) => {
  await page.goto("/sources", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForURL(/locale=/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Agent & Skill Hub", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "搜索工具 / 目录" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重新扫描", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("36", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("source-card-claude-code")).toBeVisible();
  await expect(
    page.getByText("~/.claude/projects", { exact: true }),
  ).toBeVisible();

  await expect(page.getByTestId("source-card-openclaw")).toBeVisible();

  await page.getByRole("button", { name: /^未安装/ }).click();
  await expect(page.getByTestId("source-card-qodercn")).toBeVisible();
  await expect(
    page.getByText(/QoderCN\/SharedClientCache\/cache\/db\/local\.db/),
  ).toBeVisible();
});
