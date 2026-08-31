import { expect, test } from "playwright/test";

/**
 * Smoke when switching between four languages (I18N-007-3):
 *  - localStorage preferences → English above the fold (en-US)
 *  - Setting page switching ja-JP → effective immediately (navigation/title/html lang), maintained after reload
 *  - URL ?locale= is written back, and the first frame of SSR is consistent with the client
 */

async function selectLanguage(
  page: import("playwright/test").Page,
  label: "中文" | "English" | "日本語" | "한국어",
) {
  await page.goto("/settings");
  await page.waitForURL(/locale=/, { timeout: 15_000 });
  await page
    .getByRole("button", {
      name: /^(应用偏好|App preferences|アプリ設定|앱 환경설정)$/,
    })
    .click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

test("en-US 偏好经 SQLite 生效,首屏无中文残留", async ({ page }) => {
  await selectLanguage(page, "English");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("USD");
  await page.goto("/");
  // The new home page uses "Today's insight" instead of the legacy "Dashboard" heading.
  // Home page SSR needs to scan local logs (the first screen may be close to 10s under high load on this machine) and relax the assertion timeout.
  await expect(
    page.getByRole("heading", { name: "Today's insight", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  // Navigation has been englished
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Security Scan" })).toBeVisible();
  // localStorage preference also becomes the canonical browser URL, so a
  // subsequent SSR request starts from the same language.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("locale"))
    .toBe("en-US");
  // html lang sync
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("en-US");
});

test("设置页切换 ja-JP 即时生效并跨刷新保持", async ({ page }) => {
  await selectLanguage(page, "日本語");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("JPY");

  // Effective immediately: page title, navigation and html lang
  await expect(
    page.getByRole("heading", { name: "設定", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "セキュリティ検査" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("ja-JP");

  // URL written back ?locale=ja-JP (SSR conformance)
  await expect
    .poll(() => new URL(page.url()).searchParams.get("locale"))
    .toBe("ja-JP");

  // Keep Japanese after refreshing (the first frame of SSR is Japanese)
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "設定", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("JPY");
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

  // Default: Display the currency following system (zh-CN → CNY), and the exchange rate area displays CNY
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("CNY");
  await page.getByRole("button", { name: "JPY", exact: true }).click();

  // The exchange rate area immediately displays the JPY exchange rate row and source
  await expect(page.getByText("汇率", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 USD = /)).toBeVisible();
  await expect(page.getByText(/JPY/).first()).toBeVisible();
  await expect(page.getByText(/更新于/)).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("JPY");

  // Changing an unrelated setting must not restore the language-derived
  // currency after a user explicitly chooses one.
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("JPY");

  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.aitrackerHydrated === "true",
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("JPY");

  // Switch back to follow the system → Return to CNY (zh-CN system area)
  // The page has two "Follow System" buttons, the currency area is the second one.
  await page
    .getByRole("button", { name: "跟随系统", exact: true })
    .nth(1)
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("CNY");
});

test("切换 ko-KR 同步 KRW", async ({ page }) => {
  await selectLanguage(page, "한국어");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("currency"))
    .toBe("KRW");
});
