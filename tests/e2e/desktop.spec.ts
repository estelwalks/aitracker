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
  { path: "/agents", heading: /Agent 体检/ },
  { path: "/skills", heading: "今日洞察" },
  { path: "/security", heading: "安全播报" },
  { path: "/settings", heading: "设置" },
  { path: "/memory", heading: "今日洞察" },
  { path: "/chats", heading: "今日洞察" },
] as const;

/** Routes whose title is rendered by PageBar (a span, not a heading). */
const textRoutes = [{ path: "/widget", text: "菜单栏小组件" }] as const;

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

async function openRouteWithoutPageErrorsByText(
  page: Page,
  path: string,
  text: string,
) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto(path, { waitUntil: "domcontentloaded" });

  expect(response, `${path} 应返回页面响应`).not.toBeNull();
  expect(response?.status(), `${path} 不应返回 HTTP 错误`).toBeLessThan(400);
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
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

for (const route of textRoutes) {
  test(`${route.path} 可访问且无页面错误（PageBar 标题）`, async ({ page }) => {
    await openRouteWithoutPageErrorsByText(page, route.path, route.text);
  });
}

test("首页展示真实数据", async ({ page }) => {
  await page.goto("/");

  // 新首页（V3.0）真实数据信号：洞察 heading + 指标卡 + 事件计数
  await expect(
    page.getByRole("heading", { name: "今日洞察", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Token 消耗").first()).toBeVisible();
  // 第一个指标卡（Token 消耗）副文案：真实成本金额 · 较前 N 天
  // （价格目录未知时回退为「已观测 N 条事件」）
  await expect(
    page.getByText(/(¥[\d.,]+|已观测 [\d,]+ 条事件)/).first(),
  ).toBeVisible();
  await expect(
    page.getByText(/概览\s*[\d.]+[KMB]? tokens/).first(),
  ).toBeVisible();
  // 费用估算卡副文案：日均 / 预计本月投影（价格未知时回退为「部分模型价格未知…」）
  await expect(
    page
      .getByText(/(日均 .*预计本月|部分模型价格未知，金额为已知下限)/)
      .first(),
  ).toBeVisible();
  // 「本地采集状态」已不在新首页（旧 UI 的采集状态卡片已移除）
  await expect(page.getByText("本地采集状态", { exact: true })).toHaveCount(0);
});

test("首页展示活跃日历热力图与真实事件聚合", async ({ page }) => {
  await page.goto("/");

  // 新首页热力图 = 「活跃日历 · 近 12 个月」；旧 UI 的 7 × 24 热力图已移除
  await expect(
    page.getByRole("heading", { name: /^活跃日历 · 近 12 个月/ }),
  ).toBeVisible();
  // 隔离空 Home 也必须诚实展示零活跃摘要，不伪造事件。
  await expect(page.getByText(/\d+ 天活跃/).first()).toBeVisible();
});

test("Skill Hub 展示真实本地 Skill 数量", async ({ page }) => {
  await page.goto("/skills");

  // PageBar 摘要展示真实本地 Skill 数量（当前机器 13 个）。
  // 旧 UI 的「每 5 秒轮询说明」在新 UI（V3.0 对齐）中已移除，故不再断言。
  await expect(
    page.getByRole("button", { name: /^共 \d+ 个 Skill$/ }),
  ).toBeVisible();
});

test("Skill 当前筛选结果支持多选和全选但不执行清理", async ({ page }) => {
  test.setTimeout(120_000);
  // Skill 资产管理在 /skills（拆分后仅本地工作区，市场在独立 /market）；
  // 选择按钮是带 aria-label「选择 <name>」的 button（非原生 checkbox），
  // 全选按钮文案为「共 N 个 Skill」。
  // /skills 的 loader 并发拉取 workspace/dashboard/distillation，本机高负载下
  // 首屏可能超过默认 30s，故显式放宽 goto 与整体超时。
  await page.goto("/skills", { timeout: 90_000 });
  await page.waitForURL(/locale=/, { timeout: 30_000 });

  const skillSelect = page.getByRole("button", { name: /^选择 / });
  expect(await skillSelect.count()).toBeGreaterThanOrEqual(2);

  await skillSelect.nth(0).click();
  await skillSelect.nth(1).click();
  await expect(page.getByText("已选 2 项", { exact: true })).toBeVisible();

  // 全选当前页：选中状态下同一 toggle 按钮显示「已选 N 项」，点击后全部选中
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

  // 批量动作可用（但不执行清理）
  const uninstall = page.locator("main button").filter({ hasText: "卸载" });
  await expect(uninstall.first()).toBeEnabled();
  const sync = page.locator("main button").filter({ hasText: "同步" });
  await expect(sync.first()).toBeEnabled();

  // 取消选择后回到空选状态
  await page.locator("main button").filter({ hasText: "取消" }).click();
  await expect(page.getByText(/^共 \d+ 个 Skill$/).first()).toBeVisible();
});

test("市场搜索 draw.io 后展示真实结果", async ({ page }) => {
  // V3.0 拆分后市场为独立 /market 路由（安全市场，列表样式）
  await page.goto("/market");
  // 等待 React 水合完成：URL 出现 locale 参数即 search-param 同步已接管；
  // 搜索框由 SSR 先渲染，若在 onChange 挂载前 fill，React 不会收到 input
  // 事件，搜索不会触发（水合竞态）。
  await page.waitForURL(/locale=/, { timeout: 15_000 });
  await page.waitForTimeout(1000);

  const search = page.getByPlaceholder("搜索 Skill 名称、源路径或能力");
  await search.fill("draw.io");
  // 结果卡以真实名称/描述渲染 draw.io 文本（搜索框的 value 不参与 getByText 匹配）
  await expect(page.getByText(/draw\.io/i).first()).toBeVisible({
    timeout: 20_000,
  });
});

test("安全页浏览器下检测服务已连接", async ({ page }) => {
  // 浏览器 e2e 运行在 http://127.0.0.1:41737，满足 companion client 的
  // isCompanionOrigin 检查；Vite/Nitro dev server 提供 /api/security/*，
  // 因此 /security 页以「companion」transport 连接检测服务，而非旧的不可
  // 用引导态。绝不点击扫描按钮，避免触发真实本机 Skill I/O。
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/security", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "安全播报", exact: true }),
  ).toBeVisible();

  // 主 CTA 可见（但不点击）
  await expect(page.getByRole("button", { name: "立即检测" })).toBeVisible();

  // 旧的不可用引导态必须消失
  await expect(
    page.getByText("本机伴随服务不可用", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/不会读取本机 Skill/)).toHaveCount(0);

  // 播报摘要（健康度）可见
  await expect(page.getByText("健康度", { exact: true }).first()).toBeVisible();

  // 短暂 settle 后不应有未捕获页面错误
  await page.waitForTimeout(300);
  expect(pageErrors, "/security 不应触发未捕获页面错误").toEqual([]);
});

test("安全页连接检测服务且不自动触发扫描", async ({ page }) => {
  // 浏览器连接检测服务（companion transport），但页面加载时绝不自动触发
  // 扫描：不点击任何扫描按钮，扫描状态应保持 idle，不出现扫描中的 vortex
  // 覆盖层（「检测进度：…」标记）。
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/security", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "安全播报", exact: true }),
  ).toBeVisible();

  // 主 CTA 可见（但不点击）
  await expect(page.getByRole("button", { name: "立即检测" })).toBeVisible();

  // 播报摘要（健康度）可见
  await expect(page.getByText("健康度", { exact: true }).first()).toBeVisible();

  // 页面已连接（不展示旧的不可用引导态）
  await expect(
    page.getByText("本机伴随服务不可用", { exact: true }),
  ).toHaveCount(0);

  // 不点击扫描 CTA；settle 后断言没有扫描进行中的标记
  await page.waitForTimeout(600);
  await expect(page.getByText(/检测进度：/)).toHaveCount(0);
  await expect(page.getByText("扫描中", { exact: true })).toHaveCount(0);

  // 短暂 settle 后不应有未捕获页面错误
  expect(pageErrors, "/security 不应触发未捕获页面错误").toEqual([]);
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
  test.setTimeout(120_000);
  // 本机高负载下首屏可能超过默认 30s，显式放宽 goto 与整体超时。
  await page.goto("/", { timeout: 90_000 });
  await expect(page.getByText("本地采集状态", { exact: true })).toHaveCount(0);

  await page.goto("/sources", { timeout: 90_000 });
  await expect(
    page.getByRole("heading", { name: /Agent 生态 · \d+ 项/ }),
  ).toBeVisible();
  await expect(page.getByText("已接入Agent", { exact: true })).toBeVisible();
  await expect(page.getByText("采集事件", { exact: true })).toBeVisible();
  // 隔离空 Home 下应明确显示全部未安装，并保留扫描目录证据。
  await expect(page.getByRole("button", { name: /未安装 36/ })).toBeVisible();
  await expect(page.getByText(/扫描目录：/).first()).toBeVisible();
});

test("设置页偏好可修改并在当前隔离上下文持久化", async ({ page }) => {
  await page.goto("/settings");

  // 等待 React hydration 完成（URL 出现 locale 参数即 search-param 同步已
  // 接管）：否则点击会命中 SSR 静态按钮（无事件处理器），更改不生效。
  await page.waitForURL(/locale=/, { timeout: 15_000 });

  await page.getByRole("button", { name: "USD", exact: true }).click();
  await expect(page).toHaveURL(/currency=USD/);

  await page.reload();
  await expect(page).toHaveURL(/currency=USD/);
});
