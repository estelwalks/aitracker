/**
 * 安全检测历史持久化层（PRD v3.0 §11 FR-020）。
 *
 * 历史权威源已迁移到 security assessment SQLite repository。这个旧的
 * renderer persistence facade 只保留 DTO 裁剪工具；调用旧读写入口会
 * 显式失败，避免重新引入浏览器或 Electron 文件存储。
 *
 * 仅保留最近 30 天的检测历史，并在持久化前裁剪 `risks[]`（保留前 50 条），
 * 避免偏好文件膨胀。
 */

import type { SecurityReport } from "./scanner.ts";
const RISKS_CAP_PER_REPORT = 50;

/**
 * 裁剪报告以安全持久化：仅保留前 50 条风险（按命中顺序），
 * 其余字段原样保留。返回新对象，不修改入参。
 */
export function trimReportForHistory(report: SecurityReport): SecurityReport {
  if (report.risks.length <= RISKS_CAP_PER_REPORT) return { ...report };
  return {
    ...report,
    risks: report.risks.slice(0, RISKS_CAP_PER_REPORT),
  };
}

/**
 * 从外部持久化数据中安全解析历史报告列表。非法或损坏条目会被丢弃。
 */
/**
 * 读取最近 30 天的检测历史（最新在前）。
 *
 * 旧入口不再持久化；调用方必须使用 SQLite security history client。
 */
export async function loadSecurityHistory(
  _now: Date = new Date(),
): Promise<SecurityReport[]> {
  throw new Error("SQLite security history client is required");
}

/**
 * 旧入口不再持久化；调用方必须使用 SQLite security history client。
 */
export async function saveSecurityHistory(
  _reports: SecurityReport[],
  _now: Date = new Date(),
): Promise<void> {
  throw new Error("SQLite security history client is required");
}

/**
 * 旧入口不再清理文件或浏览器状态。
 */
export async function clearSecurityHistory(): Promise<void> {
  throw new Error("SQLite security history client is required");
}
