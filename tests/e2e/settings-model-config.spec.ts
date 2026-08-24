import { expect, test, type Page } from "playwright/test";

test.beforeEach(async ({ page }) => {
  // 固定浏览器系统语言为 zh-CN 且无存储偏好，保证默认语言为中文
  // （与 locale.spec.ts 的既有做法一致）。
  await page.addInitScript(() => {
    window.localStorage.removeItem("tt-locale");
    window.localStorage.removeItem("tt-locale-mode");
    Object.defineProperty(window.navigator, "language", {
      get: () => "zh-CN",
      configurable: true,
    });
  });
  // 偏好已迁移到 SQLite；通过真实 UI 将共享隔离数据库归一化为中文。
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/locale=/, { timeout: 15_000 });
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByRole("button", { name: "中文", exact: true }).click();
});

/** 设置页内容面板（排除侧边导航中的「日报周报」等链接文本）。 */
function content(page: Page) {
  return page.locator("main");
}

async function openModelSection(page: Page): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto("/settings?section=model", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status() ?? 0).toBeLessThan(400);
  await expect(
    page.getByText("模型配置", { exact: true }).first(),
  ).toBeVisible();
  await page.waitForTimeout(200);
  expect(pageErrors).toEqual([]);
  return pageErrors;
}

test("S-005 模型配置页对齐原型：左列表/右表单/操作入口，无多余说明", async ({
  page,
}) => {
  const pageErrors = await openModelSection(page);
  const main = content(page);

  // 等待列表加载完成（server fn 返回、hydration 完成），避免点击落在
  // SSR 静态 HTML 上：「加载中...」（common.loading）仅在 loading 期间渲染；
  // dev 冷启动首次编译 server fn 可能较慢，给足超时。
  await expect(main.getByText("加载中...")).toHaveCount(0, {
    timeout: 60_000,
  });

  // 左列表：标题计数；新增和启用入口属于当前原型契约。
  await expect(main.getByText(/模型配置（\d+）/)).toBeVisible();
  await expect(main.getByRole("button", { name: "新增" })).toBeVisible();
  await expect(
    main.getByRole("button", { name: "启用" }).first(),
  ).toBeVisible();

  // 已去除的多余说明（提及其它 AI 功能用词，仅检查设置内容面板）
  await expect(main.getByText(/安全检测|日报周报|今日洞察/)).toHaveCount(0);
  await expect(main.getByText(/蒸馏/)).toHaveCount(0);
  await expect(main.getByText(/API Key 仅保存于本机服务端文件/)).toHaveCount(0);

  // 新版默认仅展示配置列表；点击新增后再校验右侧编辑表单。
  await main.getByRole("button", { name: "新增" }).click();

  const dialog = page.getByRole("dialog", { name: "新增模型配置" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("API格式")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /OpenAI 兼容/ }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Anthropic/ })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "获取模型列表" }),
  ).toBeVisible();
  await expect(dialog.getByText("API Key", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Base URL", { exact: true })).toBeVisible();
  await expect(dialog.getByText("请求路径", { exact: true })).toBeVisible();
  await expect(dialog.getByText("POST /chat/completions")).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("S-005 扫描配置分类不再出现模型相关说明", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/settings?section=scan", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("扫描配置", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "扫描计划" })).toBeVisible();
  // 已删除的「自动扫描将根据是否配置模型自动选择快速/深度检测」说明
  await expect(content(page).getByText(/快速\/深度检测/)).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(pageErrors).toEqual([]);
});
