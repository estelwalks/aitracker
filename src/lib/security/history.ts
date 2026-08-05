/**
 * 安全检测历史持久化层（PRD v3.0 §11 FR-020）。
 *
 * 复用与 `daily-limit.ts` / `settings/store.ts` 相同的 IPC 偏好通道：
 * - Electron：`window.desktopApi.getPreferences` / `setPreference`
 *   持久化到 userData 下的偏好文件，跨重启可见；
 * - 浏览器开发态 / IPC 不可用时：回退到 localStorage；
 * - SSR：直接 no-op / 返回空。
 *
 * 仅保留最近 30 天的检测历史，并在持久化前裁剪 `risks[]`（保留前 50 条），
 * 避免偏好文件膨胀。
 */

import type { SecurityReport } from "./scanner.ts";
import { STORAGE_KEY_PREFIX } from "../app-config";
import type { DesktopApi } from "../../../electron/contracts.ts";

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}security.history.v1`;
const HISTORY_DAYS = 30;
const HISTORY_CAP = 100;
const RISKS_CAP_PER_REPORT = 50;

function getDesktopApi(): DesktopApi | undefined {
  if (typeof window === "undefined") return undefined;
  return window.desktopApi;
}

function isWithinHistoryWindow(scannedAt: string, now: Date): boolean {
  const ts = Date.parse(scannedAt);
  if (!Number.isFinite(ts)) return false;
  return ts >= now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
}

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
function parseHistory(value: unknown): SecurityReport[] {
  if (!Array.isArray(value)) return [];
  const reports: SecurityReport[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<SecurityReport>;
    if (
      typeof candidate.scannedAt !== "string" ||
      typeof candidate.filesScanned !== "number" ||
      !Array.isArray(candidate.risks) ||
      (candidate.verdict !== "安全" &&
        candidate.verdict !== "可疑" &&
        candidate.verdict !== "危险")
    ) {
      continue;
    }
    // 兼容早期本地历史：缺少耗时/名称时只补展示字段，绝不补写或读取源码。
    reports.push({
      ...(candidate as SecurityReport),
      targetName:
        typeof candidate.targetName === "string" && candidate.targetName
          ? candidate.targetName
          : "SKILL.md",
      durationMs:
        typeof candidate.durationMs === "number" && candidate.durationMs >= 0
          ? candidate.durationMs
          : 0,
    });
  }
  return reports;
}

/**
 * 读取最近 30 天的检测历史（最新在前）。
 *
 * 优先从 IPC 偏好读取（Electron 持久），失败时回退到 localStorage
 * （浏览器开发态）。SSR 或 IPC 不可用时返回空数组。
 */
export async function loadSecurityHistory(
  now: Date = new Date(),
): Promise<SecurityReport[]> {
  if (typeof window === "undefined") return [];
  const api = getDesktopApi();

  let raw: string | null = null;
  if (api) {
    try {
      const prefs = await api.getPreferences();
      if (prefs && typeof prefs[STORAGE_KEY] === "string") {
        raw = prefs[STORAGE_KEY] as string;
      }
    } catch {
      // IPC 不可用，回退到 localStorage
    }
  }
  if (raw === null) {
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage 不可用
      return [];
    }
  }
  if (!raw) return [];

  const reports = parseHistory(
    (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    })(),
  );
  return reports
    .filter((report) => isWithinHistoryWindow(report.scannedAt, now))
    .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt));
}

/**
 * 持久化检测历史：裁剪到最近 30 天、最多 100 条，并裁剪每条 risks[]。
 * IPC 与 localStorage 双写，各自独立容错。
 */
export async function saveSecurityHistory(
  reports: SecurityReport[],
  now: Date = new Date(),
): Promise<void> {
  if (typeof window === "undefined") return;

  const trimmed = reports
    .filter((report) => isWithinHistoryWindow(report.scannedAt, now))
    .slice(0, HISTORY_CAP)
    .map(trimReportForHistory);

  const serialized = JSON.stringify(trimmed);

  const api = getDesktopApi();
  if (api) {
    try {
      await api.setPreference(STORAGE_KEY, serialized);
    } catch {
      // IPC 不可用，仍尝试 localStorage 镜像
    }
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // localStorage 不可用
  }
}

/**
 * 清除全部检测历史。IPC 与 localStorage 双清，各自独立容错。
 */
export async function clearSecurityHistory(): Promise<void> {
  if (typeof window === "undefined") return;
  const api = getDesktopApi();
  if (api) {
    try {
      await api.setPreference(STORAGE_KEY, "[]");
    } catch {
      // IPC 不可用
    }
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, "[]");
  } catch {
    // localStorage 不可用
  }
}
