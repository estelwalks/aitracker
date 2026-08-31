import assert from "node:assert/strict";
import test from "node:test";

import {
  createBoundFormatters,
  formatBytes,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatTime,
  formatTokens,
} from "./format.ts";

// Node's Intl is deterministic for the four locales used here; assertions are
// pinned per locale so a locale regression fails the test.

test("formatNumber: 按 locale 分组", () => {
  assert.equal(formatNumber("zh-CN", 1234567), "1,234,567");
  assert.equal(formatNumber("en-US", 1234567), "1,234,567");
  assert.equal(formatNumber("ja-JP", 1234567), "1,234,567");
  assert.equal(
    formatNumber("zh-CN", 12.5, { maximumFractionDigits: 1 }),
    "12.5",
  );
  assert.equal(formatNumber("zh-CN", Number.NaN), "—");
  assert.equal(formatNumber("en-US", Number.POSITIVE_INFINITY), "—");
});

test("formatPercent: 0-100 数值按 locale 输出百分比", () => {
  assert.equal(formatPercent("zh-CN", 45.2), "45.2%");
  assert.equal(formatPercent("en-US", 45.2), "45.2%");
  assert.equal(formatPercent("en-US", 0), "0%");
  assert.equal(formatPercent("en-US", 100), "100%");
  assert.equal(formatPercent("zh-CN", Number.NaN), "—");
});

test("formatTime: 24 小时制时分", () => {
  const d = new Date(2026, 7, 3, 9, 12); // 2026-08-03 09:12 local
  assert.equal(formatTime("zh-CN", d), "09:12");
  assert.equal(formatTime("en-US", d), "09:12");
  assert.equal(formatTime("ja-JP", d), "09:12");
  assert.equal(formatTime("ko-KR", d), "09:12");
  assert.equal(formatTime("zh-CN", "not-a-date"), "—");
});

test("formatDate: 四语言日期", () => {
  const d = new Date(2026, 7, 3); // 2026-08-03 local
  assert.equal(formatDate("zh-CN", d), "2026/08/03");
  assert.equal(formatDate("en-US", d), "08/03/2026");
  assert.equal(formatDate("ja-JP", d), "2026/08/03");
  assert.equal(formatDate("ko-KR", d), "2026. 08. 03.");
  assert.equal(formatDate("zh-CN", "not-a-date"), "—");
});

test("formatDateTime: 秒可选, 非法输入显示占位符", () => {
  const iso = new Date(2026, 7, 3, 14, 5, 9).toISOString();
  const withSeconds = formatDateTime("zh-CN", iso);
  assert.ok(withSeconds.includes("14:05:09"), withSeconds);
  const withoutSeconds = formatDateTime("zh-CN", iso, false);
  assert.ok(withoutSeconds.includes("14:05"), withoutSeconds);
  assert.ok(!withoutSeconds.includes(":09"), withoutSeconds);
  assert.equal(formatDateTime("zh-CN", "invalid"), "—");
});

test("formatMoney: 币种不随语言变, 金额分位规则保留", () => {
  // CNY is still CN¥ in the English UI, and is not converted to USD (zh-CN local currency symbol is ¥)
  assert.equal(formatMoney("zh-CN", 12.34, "CNY"), "¥12.34");
  assert.equal(formatMoney("en-US", 12.34, "CNY"), "CN¥12.34");
  assert.equal(formatMoney("ja-JP", 12.34, "CNY"), "元 12.34"); // ICU narrow space
  assert.equal(formatMoney("ko-KR", 12.34, "CNY"), "CN¥12.34");
  // Omit decimals when amount >= 100 (consistent with old formatMoney)
  assert.equal(formatMoney("zh-CN", 123, "USD"), "US$123");
  assert.equal(formatMoney("zh-CN", 0, "USD"), "US$0.00");
  assert.equal(formatMoney("zh-CN", Number.NaN, "USD"), "—");
  // Explicit decimal override
  assert.equal(
    formatMoney("en-US", 123, "USD", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    "$123.00",
  );
});

test("formatTokens: K/M/B 缩写与语言无关", () => {
  assert.equal(formatTokens("zh-CN", 999), "999");
  assert.equal(formatTokens("zh-CN", 1000), "1K");
  assert.equal(formatTokens("en-US", 1500), "1.5K");
  assert.equal(formatTokens("zh-CN", 1_234_567), "1.23M");
  assert.equal(formatTokens("zh-CN", 780_000_000), "780M");
  assert.equal(formatTokens("en-US", 1_200_000_000), "1.2B");
  assert.equal(formatTokens("en-US", 2_000_000_000), "2B");
  assert.equal(formatTokens("zh-CN", 12_345), "12.3K"); // Consistent with old trimFixed behavior
  assert.equal(formatTokens("zh-CN", Number.NaN), "—");
});

test("formatBytes: 0/小值/大值", () => {
  assert.equal(formatBytes("zh-CN", 0), "0 MB");
  assert.equal(formatBytes("zh-CN", 500 * 1024), "500.0 KB");
  assert.equal(formatBytes("en-US", 7.5 * 1024 * 1024), "7.5 MB");
  assert.equal(formatBytes("zh-CN", 12 * 1024 * 1024), "12 MB");
  assert.equal(formatBytes("en-US", 2 * 1024 * 1024 * 1024), "2.0 GB");
});

test("createBoundFormatters: 绑定 locale 后行为与纯函数一致", () => {
  const f = createBoundFormatters("en-US");
  assert.equal(f.locale, "en-US");
  assert.equal(f.formatNumber(1234567), "1,234,567");
  assert.equal(f.formatTokens(1500), "1.5K");
  assert.equal(
    f.formatDateTime(new Date(2026, 7, 3, 14, 5).toISOString(), false).length >
      0,
    true,
  );
  assert.equal(f.formatMoney(12.34, "CNY"), "CN¥12.34");
});

test("formatMoney: JPY/KRW 固定 0 小数位, CNY/USD 保留幅度规则", () => {
  assert.equal(formatMoney("zh-CN", 12345.678, "JPY"), "JP¥12,346");
  assert.equal(formatMoney("zh-CN", 12345.678, "KRW"), "₩12,346");
  assert.equal(formatMoney("zh-CN", 12.34, "CNY"), "¥12.34");
  assert.equal(formatMoney("zh-CN", 12.34, "USD"), "US$12.34");
  assert.equal(formatMoney("en-US", 12.34, "USD"), "$12.34");
  assert.equal(formatMoney("en-US", 123, "USD"), "$123"); // Amplitude rules:>=100 no decimals
  assert.equal(formatMoney("zh-CN", 41.2911, "CNY"), "¥41.29"); // Displays are reserved for a maximum of 2 digits
  assert.equal(formatMoney("zh-CN", 1.2, "JPY"), "JP¥1"); // No truncation error, rounding
});
