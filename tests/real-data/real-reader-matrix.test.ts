/**
 * 真实日志 · 工具 reader 兼容矩阵（Phase 1 验收项）
 * 对全部 registry 工具在真实主目录下逐源扫描，记录 files/events/诊断。
 * 验收：任一「检测到且读到了文件」的源，要么产出事件，要么有可理解的
 * 诊断/已知边界（诚实标注，不绕开、不伪造）。
 */
import assert from "node:assert/strict";
import { test, realLogsPresent, realSnapshot } from "./helpers.ts";

const KNOWN_NO_USAGE_REASON = new Map<string, string>([
  [
    "cursor",
    "registry usage 仅匹配 *usage*.json(l)；真实 ~/.cursor/projects/**/agent-transcripts 是对话转录（无 token 计数字段），不是 usage 记录。",
  ],
  [
    "codebuddy",
    "真实 ~/.codebuddy/projects 日志存在但记录无 token 计数字段（totalTokens=0 被诚实地过滤）。",
  ],
]);

test("兼容矩阵覆盖全部 registry 工具，逐源记录观测", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  const rows = snap.sources.map((s) => ({
    source: s.source,
    detected: s.detected,
    filesConsidered: s.filesConsidered,
    filesRead: s.filesRead,
    filesParsed: s.filesParsed,
    events: s.events,
    diagnostics: s.diagnostics?.map((d) => `${d.code}(${d.count})`) ?? [],
  }));
  // 打印观测表（供人工核对，属测试输出的一部分）
  t.diagnostic(`reader 兼容矩阵观测:\n${JSON.stringify(rows, null, 2)}`);

  const sources = new Set(snap.sources.map((s) => s.source));
  assert.ok(sources.size >= 30, `registry 源过少: ${sources.size}`);
  for (const row of rows) {
    assert.equal(
      row.filesConsidered,
      row.filesRead,
      `${row.source}: filesConsidered != filesRead`,
    );
    // 检测到且读过文件但没有事件 → 必须有可理解诊断或已知边界
    if (row.detected && row.filesConsidered > 0 && row.events === 0) {
      const hasDiag = row.diagnostics.length > 0;
      const hasKnownBoundary = KNOWN_NO_USAGE_REASON.has(row.source);
      assert.ok(
        hasDiag || hasKnownBoundary,
        `${row.source} 读了 ${row.filesConsidered} 个文件却无事件且无诊断，属未解释缺口`,
      );
    }
  }
});

test("至少一个已安装源产出真实事件，且诊断码全部是已识别枚举", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  const withEvents = snap.sources.filter((s) => s.events > 0);
  assert.ok(withEvents.length >= 1, "至少一个源应有真实事件");
  const validCodes = new Set([
    "config-invalid",
    "file-too-large",
    "field-mismatch",
    "malformed-json",
    "query-failed",
    "query-truncated",
    "read-failed",
    "retained-previous",
  ]);
  for (const source of snap.sources) {
    for (const diagnostic of source.diagnostics ?? []) {
      assert.ok(
        validCodes.has(diagnostic.code),
        `${source.source} 出现未识别诊断码: ${diagnostic.code}`,
      );
    }
  }
});

test("已安装源（events>0）的路径存在且可读（源路径自洽）", async (t) => {
  if (!realLogsPresent()) {
    t.skip("本机未检测到真实 agent 日志目录");
    return;
  }
  const snap = await realSnapshot();
  for (const source of snap.sources) {
    if (source.events === 0) continue;
    assert.ok(
      Array.isArray(source.paths) && source.paths.length > 0,
      `${source.source} 有事件但未声明路径`,
    );
    assert.equal(
      source.available,
      true,
      `${source.source} available 应为 true`,
    );
  }
});
