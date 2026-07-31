import { gzipSync } from "node:zlib";

import { expect, test, type Page } from "playwright/test";

function writeTarOctal(buffer: Buffer, offset: number, length: number, value: number) {
  const octal = value.toString(8).padStart(length - 1, "0");
  buffer.write(octal, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function createTarGz(name: string, content: string): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);

  header.write(name, 0, 100, "utf8");
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, body.length);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;

  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return gzipSync(Buffer.concat([header, body, padding, Buffer.alloc(1024)]));
}

const routes = [
  { path: "/", heading: "首页总览" },
  { path: "/tokens", heading: "Token 分析" },
  { path: "/skills", heading: "Skill 管理" },
  { path: "/market", heading: "Skill 市场" },
  { path: "/memory", heading: "记忆" },
  { path: "/security", heading: "安全检测" },
  { path: "/settings", heading: "设置" },
] as const;

async function openRouteWithoutPageErrors(page: Page, path: string, heading: string) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto(path, { waitUntil: "domcontentloaded" });

  expect(response, `${path} 应返回页面响应`).not.toBeNull();
  expect(response?.status(), `${path} 不应返回 HTTP 错误`).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "页面加载失败" })).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(pageErrors, `${path} 不应触发未捕获页面错误`).toEqual([]);
}

for (const route of routes) {
  test(`${route.path} 可访问且无页面错误`, async ({ page }) => {
    await openRouteWithoutPageErrors(page, route.path, route.heading);
  });
}

test("首页展示真实数据", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("真实数据", { exact: true })).toBeVisible();
  await expect(page.getByText(/真实本地日志/)).toBeVisible();
  await expect(page.getByText("本地采集状态", { exact: true })).toHaveCount(0);
});

test("首页展示周时热力图和整体预算提示", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("整体费用预算预警", { exact: true })).toBeVisible();
  await expect(page.getByText(/非 Provider 预算/)).toBeVisible();
  await expect(page.getByText("周 × 时使用热力图", { exact: true })).toBeVisible();
  await expect(page.getByText("本机时区 · 真实事件 timestamp 聚合", { exact: true })).toBeVisible();

  const heatmapCells = page.getByLabel(/周[一二三四五六日] \d+ 时，\d+ 个事件，\d+ Token/);
  const emptyHeatmap = page.getByText("暂无可聚合的真实事件时间，热力图保持为空。", {
    exact: true,
  });
  expect((await heatmapCells.count()) > 0 || (await emptyHeatmap.isVisible())).toBe(true);
});

test("Token 支持人民币美元切换与明细下一页", async ({ page }) => {
  await page.goto("/tokens");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("真实数据", { exact: true })).toBeVisible();

  const estimatedCost = page.getByText("估算费用", { exact: true }).first().locator("..");
  await page.getByRole("button", { name: "美元", exact: true }).click();
  await expect(estimatedCost).toContainText("US$");

  await page.getByRole("button", { name: "人民币", exact: true }).click();
  await expect(estimatedCost).toContainText("¥");

  const nextPage = page.getByRole("button", { name: "下一页", exact: true });
  await expect(nextPage).toBeEnabled();
  await expect(page.getByText(/第 1 \/ \d+ 页/)).toBeVisible();
  await nextPage.click();
  await expect(page.getByText(/第 2 \/ \d+ 页/)).toBeVisible();
});

test("Skill 展示真实数量与轮询说明", async ({ page }) => {
  await page.goto("/skills");

  await expect(page.getByText(/\d+ 个真实 Skill/)).toBeVisible();
  await expect(
    page.getByText("页面可见时每 5 秒按变更指纹轮询（非原生 watcher）", { exact: true }),
  ).toBeVisible();
});

test("Skill 当前筛选结果支持多选和全选但不执行清理", async ({ page }) => {
  await page.goto("/skills");

  const skillCheckboxes = page.getByRole("checkbox", { name: /^选择 / });
  expect(await skillCheckboxes.count()).toBeGreaterThanOrEqual(2);

  await skillCheckboxes.nth(0).check();
  await skillCheckboxes.nth(1).check();
  await expect(page.getByText("已选 2 项", { exact: true })).toBeVisible();

  const selectAll = page.getByRole("checkbox", { name: "全选当前筛选", exact: true });
  await selectAll.check();
  await expect(selectAll).toBeChecked();
  await expect(page.getByRole("button", { name: "批量清理", exact: true })).toBeEnabled();

  await selectAll.uncheck();
  await expect(page.getByText("已选 0 项", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "批量清理", exact: true })).toBeDisabled();
});

test("市场搜索 draw.io 后展示真实结果", async ({ page }) => {
  await page.goto("/market");

  const search = page.getByPlaceholder("按名称或描述搜索真实 Skill…");
  await search.fill("draw.io");
  await search.press("Enter");
  await expect(page.getByText("实时数据", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/关键词“draw\.io”/)).toBeVisible();
  await expect(
    page
      .locator("article")
      .filter({ hasText: /draw.?io/i })
      .first(),
  ).toBeVisible();
});

test("Memory 支持真实内容搜索", async ({ page }) => {
  await page.goto("/memory");

  const firstTitle = page.locator("article h3").first();
  await expect(firstTitle).toBeVisible();
  const title = (await firstTitle.textContent())?.trim();
  expect(title).toBeTruthy();

  await page.getByPlaceholder("搜索标题、摘要、正文或路径…").fill(title!);
  await expect(page.locator("article h3", { hasText: title! }).first()).toBeVisible();
  await expect(page.getByText("未发现匹配的记忆文件")).toHaveCount(0);
});

test("安全 AI 开关默认关闭且可开启", async ({ page }) => {
  await page.goto("/security");

  const aiReview = page.getByRole("checkbox");
  await expect(aiReview).not.toBeChecked();
  await aiReview.check();
  await expect(aiReview).toBeChecked();
});

test("安全页本机解包扫描运行时生成的安全 tar.gz", async ({ page }) => {
  await page.goto("/security");

  const aiReview = page.getByRole("checkbox");
  await expect(aiReview).not.toBeChecked();
  await expect(page.getByText("今日 0/10 次", { exact: true })).toBeVisible();
  await expect(page.getByText(/^当前时间 \d{2}:\d{2}:\d{2}$/)).toBeVisible();

  const archive = createTarGz(
    "safe-skill/SKILL.md",
    "---\nname: safe-e2e-skill\ndescription: harmless fixture\n---\n\n# Safe fixture\n",
  );
  await page.locator('input[type="file"][accept*=".tar"]').setInputFiles({
    name: "safe-e2e-skill.tar.gz",
    mimeType: "application/gzip",
    buffer: archive,
  });

  await expect(
    page.getByText("压缩包已在本机安全解包并完成真实扫描", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/safe-e2e-skill\.tar\.gz · 1 个条目/)).toBeVisible();
  await expect(page.getByText("安全报告 · 1 个文件", { exact: true })).toBeVisible();
  await expect(page.getByText("综合判定：安全", { exact: true })).toBeVisible();
  await expect(page.getByText("今日 1/10 次", { exact: true })).toBeVisible();
  await expect(aiReview).not.toBeChecked();
  await expect(page.getByText("未请求", { exact: true })).toBeVisible();
  await expect(
    page.getByText("未启用 AI 二次审查，结论仅来自本地静态规则。", { exact: true }),
  ).toBeVisible();
});

test("设置加载完成", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByText("已载入本机设置", { exact: true })).toBeVisible();
});

test("本地采集状态仅在设置的数据采集分类展示真实结果", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("本地采集状态", { exact: true })).toHaveCount(0);

  await page.goto("/tokens");
  await expect(page.getByText("真实数据源", { exact: true })).toHaveCount(0);

  await page.goto("/settings");
  await page.getByRole("button", { name: "数据采集", exact: true }).click();

  await expect(page.getByText("真实数据源", { exact: true })).toBeVisible();
  await expect(page.getByText(/本地采集状态 · 生成时间/)).toBeVisible();
  await expect(page.getByText(/生成时间：/)).toBeVisible();
  await expect(page.getByTestId("local-usage-adapter")).toHaveCount(10);
  await expect(page.getByText(/文件读取/).first()).toBeVisible();
  await expect(page.getByText(/^事件 \d+/).first()).toBeVisible();
  await expect(page.getByText(/^异常行 \d+$/).first()).toBeVisible();
  await expect(page.getByText("真实数据", { exact: true })).toBeVisible();
});

test("设置页 Provider 预算可添加并在当前隔离上下文持久化", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "预警", exact: true }).click();

  await page.getByRole("textbox", { name: "服务商名称", exact: true }).fill("E2E Provider");
  await page.getByLabel("每日预算", { exact: true }).fill("11");
  await page.getByLabel("每周预算", { exact: true }).fill("55");
  await page.getByLabel("每月预算", { exact: true }).fill("199");
  await page.getByRole("button", { name: "新增", exact: true }).click();

  await expect(page.getByText("E2E Provider", { exact: true })).toBeVisible();
  await expect(page.getByText("日 ¥11", { exact: true })).toBeVisible();
  await expect(page.getByText("周 ¥55", { exact: true })).toBeVisible();
  await expect(page.getByText("月 ¥199", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "预警", exact: true }).click();
  await expect(page.getByText("E2E Provider", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "删除服务商预算 E2E Provider" })).toBeVisible();
});
