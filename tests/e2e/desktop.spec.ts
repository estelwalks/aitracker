import { expect, test, type Page } from "playwright/test";

test.beforeEach(async ({ page }) => {
  // 固定浏览器系统语言为 zh-CN 且无存储偏好，保证默认语言为中文
  // （与 locale.spec.ts 的既有做法一致；否则 Playwright 默认 en-US 会在
  // 客户端 i18n 收敛时把界面翻成英文，破坏中文文案断言）。
  await page.addInitScript(() => {
    window.localStorage.removeItem("tt-locale");
    window.localStorage.removeItem("tt-locale-mode");
    Object.defineProperty(window.navigator, "language", {
      get: () => "zh-CN",
      configurable: true,
    });
  });
});

const routes = [
  { path: "/", heading: "今日洞察" },
  { path: "/agents", heading: "工具概览" },
  { path: "/skills", heading: "Skill 资产管理" },
  { path: "/security", heading: "安全与防御" },
  { path: "/settings", heading: "设置" },
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
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "页面加载失败" })).toHaveCount(
    0,
  );
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

  // 新首页（V3.0）真实数据信号：洞察 heading + 指标卡 + 事件计数
  await expect(
    page.getByRole("heading", { name: "今日洞察", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("TOKEN 总量")).toBeVisible();
  await expect(page.getByText(/已观测 [\d,]+ 条事件/).first()).toBeVisible();
  await expect(
    page.getByText(/概览\s*[\d.]+[KMB]? tokens/).first(),
  ).toBeVisible();
  await expect(
    page.getByText("按本地价格目录估算", { exact: true }),
  ).toBeVisible();
  // 「本地采集状态」已不在新首页（旧 UI 的采集状态卡片已移除）
  await expect(page.getByText("本地采集状态", { exact: true })).toHaveCount(0);
});

test("首页展示活跃日历热力图与真实事件聚合", async ({ page }) => {
  await page.goto("/");

  // 新首页热力图 = 「活跃日历 · 近 12 个月」；旧 UI 的 7 × 24 热力图已移除
  await expect(
    page.getByRole("heading", { name: "活跃日历 · 近 12 个月", exact: true }),
  ).toBeVisible();
  // 真实数据聚合摘要（如「4 个活跃日 · 合计 1.77B · 最长连续 4 天」）
  await expect(page.getByText(/\d+ 个活跃日/).first()).toBeVisible();
  // 热力图渲染近 12 个月逐日格子（每个格子 title 形如「YYYY-MM-DD · … 用量事件 …」）
  expect(await page.locator('span[title*="用量事件"]').count()).toBeGreaterThan(
    0,
  );
});

test("Skill Hub 展示真实本地 Skill 数量", async ({ page }) => {
  await page.goto("/skills");

  // PageBar 摘要展示真实本地 Skill 数量（当前机器 13 个）。
  // 旧 UI 的「每 5 秒轮询说明」在新 UI（V3.0 对齐）中已移除，故不再断言。
  await expect(page.getByText(/\d+ 个本地 Skill/).first()).toBeVisible();
});

test("Skill 当前筛选结果支持多选和全选但不执行清理", async ({ page }) => {
  // Skill 资产管理迁移到 /skills（local tab），而非旧 /agents 上的复选框列表
  await page.goto("/skills");

  const skillCheckboxes = page.getByRole("checkbox", { name: /^选择 / });
  expect(await skillCheckboxes.count()).toBeGreaterThanOrEqual(2);

  await skillCheckboxes.nth(0).check();
  await skillCheckboxes.nth(1).check();
  await expect(page.getByText("已选 2 项", { exact: true })).toBeVisible();

  const selectAll = page.getByRole("checkbox", {
    name: "全选当前页",
    exact: true,
  });
  await selectAll.check();
  await expect(selectAll).toBeChecked();
  await expect(
    page.getByRole("button", { name: "批量卸载", exact: true }),
  ).toBeEnabled();

  await selectAll.uncheck();
  await expect(page.getByText("已选 0 项", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "批量卸载", exact: true }),
  ).toBeDisabled();
});

test("市场搜索 draw.io 后展示真实结果", async ({ page }) => {
  // 独立市场路由已删除，市场入口在 /skills 的 market tab（卡片网格）
  await page.goto("/skills?tab=market");
  // 等待 React 水合：搜索框由 SSR 先渲染，若在 onChange 挂载前 fill，
  // React 不会收到 input 事件，搜索不会触发（水合竞态）。
  await page.waitForTimeout(1000);

  const search = page.getByPlaceholder("按名称或描述搜索真实 Skill…");
  await search.fill("draw.io");
  // 结果卡以真实名称/描述渲染 draw.io 文本（搜索框的 value 不参与 getByText 匹配）
  await expect(page.getByText(/draw\.io/i).first()).toBeVisible({
    timeout: 20_000,
  });
});

test("安全页浏览器下展示诚实引导态：本机伴随服务不可用", async ({ page }) => {
  // 安全扫描依赖桌面端伴随服务：纯浏览器（e2e 运行环境）下 `scanSelection`
  // 会直接抛错，无法执行真实扫描。因此断言诚实引导态，而非扫描额度。
  await page.goto("/security");

  await expect(
    page.getByRole("heading", { name: "安全与防御", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/健康度/).first()).toBeVisible();
  await expect(
    page.getByText("本机伴随服务不可用", { exact: true }),
  ).toBeVisible();
});

test("安全扫描为桌面端能力：浏览器 e2e 仅验证伴随服务引导态", async ({ page }) => {
  // 旧用例「上传 SKILL.md 生成真实安全报告」依赖桌面伴随服务执行真实扫描，
  // 浏览器 e2e 无该能力（scanSelection 在纯浏览器直接抛错），故改为断言
  // 引导态文案，说明用户需从桌面应用打开浏览器入口。
  await page.goto("/security");

  await expect(
    page.getByText("本机伴随服务不可用", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/不会读取本机 Skill/).first()).toBeVisible();
  await expect(
    page.getByText("重新连接", { exact: true }),
  ).toBeVisible();
});

test("设置加载完成", async ({ page }) => {
  await page.goto("/settings");

  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("界面语言", { exact: true })).toBeVisible();
  await expect(page.getByText("数据路径", { exact: true })).toBeVisible();
  await expect(page.getByText("清除缓存", { exact: true })).toBeVisible();
});

test("本地采集状态仅在数据来源页展示真实结果", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("本地采集状态", { exact: true })).toHaveCount(0);

  await page.goto("/sources");
  await expect(
    page.getByRole("heading", { name: "Agent & Skill Hub", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("已接入 / 总探测", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("采集事件总数", { exact: true })).toBeVisible();
  // 逐工具真实状态：存在有数据的工具与解析说明
  await expect(page.getByText("有数据", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/采集 [\d,]+ 事件/).first()).toBeVisible();
  await expect(page.getByText(/日志解析：/).first()).toBeVisible();
  // 无数据工具与缺失日志状态（真实本地数据）
  await expect(
    page.getByText("缺少日志文件", { exact: true }),
  ).toBeVisible();
});

test("设置页偏好可修改并在当前隔离上下文持久化", async ({ page }) => {
  await page.goto("/settings");

  await page.getByRole("button", { name: "USD", exact: true }).click();
  await expect(page).toHaveURL(/currency=USD/);

  await page.reload();
  await expect(page).toHaveURL(/currency=USD/);
});
