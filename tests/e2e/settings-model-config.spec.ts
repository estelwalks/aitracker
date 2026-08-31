import { expect, test, type Page } from "playwright/test";

test.beforeEach(async ({ page }) => {
  // Fixed browser system language to zh-CN and no stored preference, ensuring the default language is Chinese
  // (Consistent with the existing practice of locale.spec.ts).
  await page.addInitScript(() => {
    window.localStorage.removeItem("aitracker-locale");
    window.localStorage.removeItem("aitracker-locale-mode");
    Object.defineProperty(window.navigator, "language", {
      get: () => "zh-CN",
      configurable: true,
    });
  });
  // Preferences migrated to SQLite; shared isolation database normalized to Chinese via real UI.
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/locale=/, { timeout: 15_000 });
  await page.getByRole("button", { name: "应用偏好", exact: true }).click();
  await page.getByRole("button", { name: "中文", exact: true }).click();
});

/** Settings page content panel (excluding link text such as "Daily and Weekly Report" in the side navigation). */
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
    page.getByText("模型与 AI", { exact: true }).first(),
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

  // Wait for the list to be loaded (server fn returns, hydration completes) to avoid clicking on
  // On SSR static HTML: "Loading..." (common.loading) is only rendered during loading;
  // Compiling server fn for the first time during dev cold start may be slow due to sufficient timeout.
  await expect(main.getByText("加载中...")).toHaveCount(0, {
    timeout: 60_000,
  });

  // Left list: Title count; new and enabled entries belong to the current prototype contract.
  await expect(main.getByText(/模型配置（\d+）/)).toBeVisible();
  await expect(main.getByRole("button", { name: "新增" })).toBeVisible();
  await expect(
    main.getByRole("button", { name: "启用" }).first(),
  ).toBeVisible();

  // Removed redundant descriptions (words referring to other AI functions, only check the settings content panel)
  await expect(main.getByText(/安全检测|日报周报|今日洞察/)).toHaveCount(0);
  await expect(main.getByText(/蒸馏/)).toHaveCount(0);
  await expect(main.getByText(/API Key 仅保存于本机服务端文件/)).toHaveCount(0);

  // The new version only displays the configuration list by default; click Add and then verify the editing form on the right.
  await main.getByRole("button", { name: "新增" }).click();

  const dialog = page.getByRole("dialog", { name: "新增模型配置" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("API格式")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /OpenAI Completion/ }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /OpenAI Responses/ }),
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

test("S-005 扫描与安全分类不再出现模型相关说明", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/settings?section=scan", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText("扫描与安全", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "扫描计划" })).toBeVisible();
  // Deleted "Automatic scan will automatically select fast/deep detection based on whether the model is configured" description
  await expect(content(page).getByText(/快速\/深度检测/)).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(pageErrors).toEqual([]);
});
