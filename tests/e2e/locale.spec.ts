import { expect, test } from "playwright/test";

/**
 * 四语言切换冒烟(I18N-007-3):
 *  - localStorage 偏好 → 首屏英文(en-US)
 *  - 设置页切换 ja-JP → 即时生效(导航/标题/html lang),reload 后保持
 *  - URL ?locale= 被写回,SSR 首帧与客户端一致
 */

test("en-US 偏好经 localStorage 生效,首屏无中文残留", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tt-locale", "en-US");
    window.localStorage.setItem("tt-locale-mode", "manual");
  });

  await page.goto("/");
  // 新首页（V3.0）英文标题是「Today's insight」，不再是旧 UI 的「Dashboard」
  await expect(
    page.getByRole("heading", { name: "Today's insight", exact: true }),
  ).toBeVisible();
  // 导航已英文化
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Security & Defense" }),
  ).toBeVisible();
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
  // 固定浏览器语言为 zh-CN 且无存储偏好,保证默认语言确定(系统语言回退逻辑)
  await page.addInitScript(() => {
    window.localStorage.removeItem("tt-locale");
    Object.defineProperty(window.navigator, "language", {
      get: () => "zh-CN",
      configurable: true,
    });
  });

  await page.goto("/settings");

  // 默认中文
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();

  // 点击语言分段控件里的「日本語」
  await page.getByRole("button", { name: "日本語", exact: true }).click();

  // 即时生效:页面标题、导航与 html lang
  await expect(
    page.getByRole("heading", { name: "設定", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "セキュリティと防御" }),
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
  await page.addInitScript(() => {
    window.localStorage.setItem("tt-locale", "en-US");
    window.localStorage.setItem("tt-locale-mode", "manual");
  });
  await page.goto("/settings");
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
  // 固定浏览器语言为 zh-CN(CNY),无存储偏好
  await page.addInitScript(() => {
    window.localStorage.removeItem("tt-locale");
    window.localStorage.removeItem("tt-currency-mode");
    window.localStorage.removeItem("tt-display-currency");
    Object.defineProperty(window.navigator, "language", {
      get: () => "zh-CN",
      configurable: true,
    });
  });

  await page.goto("/settings");

  // 默认:展示货币跟随系统(zh-CN → CNY),汇率区显示 CNY
  await page.getByRole("button", { name: "JPY", exact: true }).click();

  // 汇率区立即显示 JPY 汇率行与来源
  await expect(page.getByText(/1 USD = /)).toBeVisible();
  await expect(page.getByText(/JPY/).first()).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("JPY");

  // 切回跟随系统 → 回到 CNY(zh-CN 系统地区)
  // 注意:页面有两个"跟随系统"按钮(语言区与货币区),取货币区的第二个
  await page
    .getByRole("button", { name: "跟随系统", exact: true })
    .nth(1)
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("CNY");
});
