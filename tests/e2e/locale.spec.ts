import { expect, test } from "playwright/test";

/**
 * 四语言切换冒烟(I18N-007-3):
 *  - localStorage 偏好 → 首屏英文(en-US)
 *  - 设置页切换 ja-JP → 即时生效(导航/标题/html lang),reload 后保持
 *  - URL ?locale= 被写回,SSR 首帧与客户端一致
 */

async function selectLanguage(
  page: import("playwright/test").Page,
  label: "中文" | "English" | "日本語",
) {
  await page.goto("/settings");
  await page.waitForURL(/locale=/, { timeout: 15_000 });
  await page.getByRole("button", { name: label, exact: true }).click();
}

test("en-US 偏好经 SQLite 生效,首屏无中文残留", async ({ page }) => {
  await selectLanguage(page, "English");
  await page.goto("/");
  // 新首页（V3.0）英文标题是「Today's insight」，不再是旧 UI 的「Dashboard」。
  // 首页 SSR 需扫描本地日志（本机高负载下首屏可能接近 10s），放宽断言超时。
  await expect(
    page.getByRole("heading", { name: "Today's insight", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  // 导航已英文化
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Security Scan" })).toBeVisible();
  // localStorage preference also becomes the canonical browser URL, so a
  // subsequent SSR request starts from the same language.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("locale"))
    .toBe("en-US");
  // html lang 同步
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("en-US");
});

test("设置页切换 ja-JP 即时生效并跨刷新保持", async ({ page }) => {
  await selectLanguage(page, "日本語");

  // 即时生效:页面标题、导航与 html lang
  await expect(
    page.getByRole("heading", { name: "設定", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "セキュリティ検査" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("ja-JP");

  // URL 已写回 ?locale=ja-JP(SSR 一致性)
  await expect
    .poll(() => new URL(page.url()).searchParams.get("locale"))
    .toBe("ja-JP");

  // 刷新后保持日文(SSR 首帧即日文)
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "設定", exact: true }),
  ).toBeVisible();
});

test("切回中文并校验 ?locale 同步", async ({ page }) => {
  await selectLanguage(page, "English");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "中文", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("locale"))
    .toBe("zh-CN");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("zh-CN");
});

test("展示货币手动切换 JPY 并校验汇率区与 ?currency 同步", async ({ page }) => {
  await selectLanguage(page, "中文");

  // 默认:展示货币跟随系统(zh-CN → CNY),汇率区显示 CNY
  await page.getByRole("button", { name: "JPY", exact: true }).click();

  // 汇率区立即显示 JPY 汇率行与来源
  await expect(page.getByText(/1 USD = /)).toBeVisible();
  await expect(page.getByText(/JPY/).first()).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("JPY");

  // 切回跟随系统 → 回到 CNY(zh-CN 系统地区)
  // 页面有两个“跟随系统”按钮，货币区是第二个。
  await page
    .getByRole("button", { name: "跟随系统", exact: true })
    .nth(1)
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("CNY");
});
