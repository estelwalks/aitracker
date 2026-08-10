import assert from "node:assert/strict";
import test from "node:test";

import { CSV_HEADER } from "./csv.ts";
import { EXPORT_FILENAME_PREFIX } from "../app-config";
import { toExportCsv } from "./csv.ts";
import { toExportJson } from "./json.ts";
import { buildExportFilename } from "./download.ts";
import type { ExportRow } from "./types.ts";

// `download.ts` performs the real DOM download and is only meaningful in a
// browser. We only unit-test its pure filename builder here; the side-effecting
// `downloadExport` is intentionally not exercised under node:test.

/** Minimal valid row, overridable per test. */
function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    timestamp: "2026-07-27T10:00:00.000Z",
    source: "claude-code",
    model: "claude-sonnet-4.5",
    project: "~/demo",
    inputTokens: 1_000,
    outputTokens: 500,
    cachedInputTokens: 200,
    cacheCreationInputTokens: 100,
    reasoningOutputTokens: 50,
    cost: 1.234,
    ...overrides,
  };
}

test("toExportCsv: 空行仅输出表头一行", () => {
  const out = toExportCsv([]);
  const lines = out.split("\r\n");
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    "日期,工具名,模型名,项目,输入Token,输出Token,缓存读,缓存写,推理Token,费用,costDisplay,currency,rate,rateDate",
  );
  assert.equal(CSV_HEADER.length, 14);
  // No stray CRLF anywhere when splitting should yield exactly header-only.
  assert.ok(!out.includes("\n\r") && !out.endsWith("\r\n"));
});

test("toExportCsv: 可传入本地化表头, 缺省时保持中文 CSV_HEADER", () => {
  const out = toExportCsv([], undefined, [
    "Date",
    "Tool",
    "Model",
    "Project",
    "Input Tokens",
    "Output Tokens",
    "Cache Read",
    "Cache Write",
    "Reasoning Tokens",
    "Cost",
    "costDisplay",
    "currency",
    "rate",
    "rateDate",
  ]);
  assert.equal(
    out.split("\r\n")[0],
    "Date,Tool,Model,Project,Input Tokens,Output Tokens,Cache Read,Cache Write,Reasoning Tokens,Cost,costDisplay,currency,rate,rateDate",
  );
  // 缺省表头与 zh-CN 输出逐字一致(数据键兼容)
  assert.equal(toExportCsv([]), toExportCsv([], undefined, [...CSV_HEADER]));
});

test("toExportCsv: 使用 CRLF 行结束符", () => {
  const out = toExportCsv([makeRow()]);
  assert.ok(out.includes("\r\n"));
  const lines = out.split("\r\n");
  assert.equal(lines.length, 2); // header + one row, no trailing empty line
});

test("toExportCsv: 缺失 cost 渲染为空, 缺失 project 渲染为空", () => {
  const out = toExportCsv([makeRow({ project: undefined, cost: undefined })]);
  const lines = out.split("\r\n");
  const cells = lines[1].split(",");
  // project is the 4th column (index 3), cost is the last column (index 9).
  assert.equal(cells[3], "");
  assert.equal(cells[9], "");
  // token columns remain integers.
  assert.equal(cells[4], "1000");
  assert.equal(cells[5], "500");
  assert.equal(cells[6], "200");
  assert.equal(cells[7], "100");
  assert.equal(cells[8], "50");
});

test("toExportCsv: cost 渲染为两位小数, Token 为整数", () => {
  const out = toExportCsv([makeRow({ inputTokens: 1234.9, cost: 1.234 })]);
  const cells = out.split("\r\n")[1].split(",");
  assert.equal(cells[4], "1234"); // truncated to integer
  assert.equal(cells[9], "1.23"); // 2-decimal cost
});

test("toExportCsv: 含逗号的模型名被引号包裹", () => {
  const out = toExportCsv([makeRow({ model: "GPT-4, Turbo" })]);
  const lines = out.split("\r\n");
  // The whole record must equal the expected CSV line; the model cell is quoted
  // so a naive comma-split would over-split — assert on the full record instead.
  assert.equal(
    lines[1],
    '2026-07-27T10:00:00.000Z,claude-code,"GPT-4, Turbo",~/demo,1000,500,200,100,50,1.23,,,,',
  );
});

test("toExportCsv: source 通过 sourceLabels 映射, 未命中时回退原始 id", () => {
  const out = toExportCsv(
    [
      makeRow({ source: "claude-code" }),
      makeRow({ source: "unmapped-source" }),
    ],
    { "claude-code": "Claude Code" },
  );
  const line1 = out.split("\r\n")[1].split(",");
  const line2 = out.split("\r\n")[2].split(",");
  assert.equal(line1[1], "Claude Code");
  assert.equal(line2[1], "unmapped-source"); // raw fallback
});

test("toExportCsv: 含引号与换行的字段按 RFC 4180 转义", () => {
  // Model contains a double quote and a newline — must be wrapped and escaped.
  const tricky = 'a "quoted"\nmodel';
  const out = toExportCsv([{ ...makeRow(), model: tricky }]);
  const lines = out.split("\r\n");
  // The whole row must still be one logical line (the embedded \n is inside the
  // quoted cell, not a record separator). After splitting on CRLF, line[1] is
  // the entire CSV record.
  const record = lines[1];
  assert.ok(record.startsWith("2026-07-27T10:00:00.000Z,claude-code,"), record);
  // The model cell is `"a ""quoted""\nmodel"` (embedded " doubled, embedded \n preserved).
  assert.ok(record.includes('"a ""quoted""\nmodel"'), record);
  assert.equal(lines.length, 2); // header + single record
});

test("toExportJson: 输出可解析, 字段名与值正确", () => {
  const rows = [
    makeRow({ source: "claude-code", cost: 1.5 }),
    makeRow({ source: "codex", project: undefined, cost: undefined }),
  ];
  const out = toExportJson(rows, { "claude-code": "Claude Code" });

  // Pretty-printed with 2-space indent.
  assert.ok(out.startsWith("[\n  "), out);

  const parsed = JSON.parse(out) as Array<Record<string, unknown>>;
  assert.equal(parsed.length, 2);

  const keys = Object.keys(parsed[0]);
  assert.deepEqual(keys, [...CSV_HEADER]);

  // Row 0: source mapped, project present, cost present.
  assert.equal(parsed[0]["日期"], "2026-07-27T10:00:00.000Z");
  assert.equal(parsed[0]["工具名"], "Claude Code");
  assert.equal(parsed[0]["模型名"], "claude-sonnet-4.5");
  assert.equal(parsed[0]["项目"], "~/demo");
  assert.equal(parsed[0]["输入Token"], 1000);
  assert.equal(parsed[0]["输出Token"], 500);
  assert.equal(parsed[0]["缓存读"], 200);
  assert.equal(parsed[0]["缓存写"], 100);
  assert.equal(parsed[0]["推理Token"], 50);
  assert.equal(parsed[0]["费用"], 1.5);

  // Row 1: source unmapped (raw fallback), project empty, cost null.
  assert.equal(parsed[1]["工具名"], "codex");
  assert.equal(parsed[1]["项目"], "");
  assert.equal(parsed[1]["费用"], null);
});

test("toExportJson: 空行输出空数组", () => {
  assert.equal(toExportJson([]), "[]");
});

test("toExportCsv / toExportJson: 同输入字段顺序一致且确定性", () => {
  const rows = [makeRow(), makeRow({ source: "codex" })];
  assert.equal(toExportCsv(rows), toExportCsv(rows));
  assert.equal(toExportJson(rows), toExportJson(rows));
  // JSON keys exactly equal the CSV header vocabulary.
  const jsonKeys = Object.keys(JSON.parse(toExportJson(rows))[0]);
  assert.deepEqual(jsonKeys, [...CSV_HEADER]);
});

test("buildExportFilename: 本地时间生成 YYYYMMDDHHMM 文件名", () => {
  // 2026-08-03 14:05 local time → stamp 202608031405.
  // Construct via components to be timezone-stable regardless of test host.
  const d = new Date(2026, 7, 3, 14, 5, 0); // local time constructor
  assert.equal(
    buildExportFilename("csv", d.getTime()),
    `${EXPORT_FILENAME_PREFIX}202608031405.csv`,
  );
  assert.equal(
    buildExportFilename("json", d.getTime()),
    `${EXPORT_FILENAME_PREFIX}202608031405.json`,
  );
});

test("toExportCsv: 展示货币与汇率字段按机器可读稳定值输出", () => {
  const out = toExportCsv(
    [
      {
        ...makeRow({ cost: 1.5 }),
        costDisplay: 10.8,
        currency: "CNY",
        rate: 7.2,
        rateDate: "2026-08-05",
      },
    ],
    undefined,
    [
      "日期",
      "工具名",
      "模型名",
      "项目",
      "输入Token",
      "输出Token",
      "缓存读",
      "缓存写",
      "推理Token",
      "费用",
      "costDisplay",
      "currency",
      "rate",
      "rateDate",
    ],
  );
  const cells = out.split("\r\n")[1].split(",");
  assert.equal(cells[10], "10.80");
  assert.equal(cells[11], "CNY");
  assert.equal(cells[12], "7.2");
  assert.equal(cells[13], "2026-08-05");
});

test("toExportJson: 汇率字段缺省时输出 null 而非 0(未知价格不填 0)", () => {
  const out = toExportJson([makeRow({ cost: undefined })]);
  const parsed = JSON.parse(out) as Array<Record<string, unknown>>;
  assert.equal(parsed[0]["费用"], null);
  assert.equal(parsed[0]["costDisplay"], null);
  assert.equal(parsed[0]["rate"], null);
  assert.equal(parsed[0]["rateDate"], null);
});
