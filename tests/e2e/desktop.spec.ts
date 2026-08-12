import { expect, test, type Page } from "playwright/test";

/** 安全扫描的 SKILL.md fixture：不含 `---` 等会命中注入规则的特征。 */
const SAFE_SKILL_MD =
  "# Safe fixture\n\nThis is a harmless skill fixture for the e2e test.\n";

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
  { path: "/", heading: "首页总览" },
  { path: "/agents", heading: "工具概览" },
  { path: "/skills", heading: "Skill 资产管理" },
  { path: "/security", heading: "安全检测" },
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

  // 真实本地快照信号：统计区间带最近同步时间戳 + 已同步徽标
  await expect(page.getByText(/统计区间：今日 · 最近同步/)).toBeVisible();
  await expect(page.getByText("已同步", { exact: true })).toBeVisible();
  await expect(page.getByText("本地采集状态", { exact: true })).toHaveCount(0);
});

test("首页展示 7 × 24 热力图与真实事件聚合", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByText("7 × 24 消耗热力图", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("按周导航 · 本机时区", { exact: true }),
  ).toBeVisible();

  const heatmapCells = page.getByLabel(
    /周[一二三四五六日] \d+ 时，\d+ 个事件，\d+ Token/,
  );
  const emptyHeatmap = page.getByText("当前周无可用事件，热力图保持为空。", {
    exact: true,
  });
  expect(
    (await heatmapCells.count()) > 0 || (await emptyHeatmap.isVisible()),
  ).toBe(true);
});

test("Skill 展示真实数量与轮询说明", async ({ page }) => {
  await page.goto("/agents");

  await expect(page.getByText(/\d+ 个本地 Skill/)).toBeVisible();
  await expect(
    page.getByText("页面可见时每 5 秒按变更指纹轮询（非原生 watcher）", {
      exact: true,
    }),
  ).toBeVisible();
});

test("Skill 当前筛选结果支持多选和全选但不执行清理", async ({ page }) => {
  await page.goto("/agents");

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

test("安全页默认展示本机扫描额度且未执行扫描", async ({ page }) => {
  await page.goto("/security");

  // 新会话默认额度：今日剩余 10 / 10 次，历史为空
  await expect(
    page.getByText("今日剩余 10 / 10 次", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("尚未执行扫描。", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("安全页本机扫描 SKILL.md 运行时生成真实安全报告", async ({ page }) => {
  await page.goto("/security");

  await expect(
    page.getByText("今日剩余 10 / 10 次", { exact: true }),
  ).toBeVisible();

  await page.locator('input[type="file"][accept*=".md"]').setInputFiles({
    name: "SKILL.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(SAFE_SKILL_MD),
  });

  await expect(
    page.getByText("安全报告 · SKILL.md", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("综合判定：安全", { exact: true })).toBeVisible();
  await expect(
    page.getByText("11 个维度均未命中静态风险规则。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("今日剩余 9 / 10 次", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("本地扫描完成：安全", { exact: true }),
  ).toBeVisible();
  // 检测历史写入真实扫描条目
  await expect(page.getByText("展示 1 / 1 条", { exact: true })).toBeVisible();
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
    page.getByRole("heading", { name: "数据来源", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("已接入 / 总探测", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("采集事件总数", { exact: true })).toBeVisible();
  // 逐工具真实状态：存在有数据的工具与解析说明
  await expect(page.getByText("有数据", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/采集事件 \d+/).first()).toBeVisible();
  await expect(page.getByText(/日志解析：/).first()).toBeVisible();
});

test("设置页偏好可修改并在当前隔离上下文持久化", async ({ page }) => {
  await page.goto("/settings");

  await page.getByRole("button", { name: "USD", exact: true }).click();
  await expect(page).toHaveURL(/currency=USD/);

  await page.reload();
  await expect(page).toHaveURL(/currency=USD/);
});
