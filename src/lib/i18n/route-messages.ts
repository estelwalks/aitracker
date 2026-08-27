import type { Locale } from "./locale";

type RouteCatalog = Record<string, string>;

const zhCN: RouteCatalog = {
  "common.distillation.pageDesc": "将会话内容整理为可复用的知识与 Skill。",
  "common.reports.pageDesc": "查看使用情况、趋势与项目报告。",
  "dashboard.meta.description": "{appName} 本地 AI 工作台概览。",
  "errors.generic": "发生未知错误",
  "memory.metaDescription": "查看与管理 {appName} 的本地记忆。",
  "meta.titles.dashboard": "概览 · {appName}",
  "meta.titles.distill": "蒸馏 · {appName}",
  "meta.titles.market": "Skill 市场 · {appName}",
  "meta.titles.memory": "记忆 · {appName}",
  "meta.titles.reports": "报告 · {appName}",
  "meta.titles.security": "安全 · {appName}",
  "meta.titles.sessions": "会话 · {appName}",
  "meta.titles.settings": "设置 · {appName}",
  "meta.titles.skills": "Skill Hub · {appName}",
  "meta.titles.sources": "数据源 · {appName}",
  "meta.titles.tracker": "用量追踪 · {appName}",
  "meta.titles.widget": "桌面组件 · {appName}",
  "security.pageDescription": "检查 Skill 与本地工作区的安全状态。",
  "sessions.metaDescription": "浏览本地 AI 会话记录。",
  "settings.pageHeaderDesc": "管理应用偏好、模型与存储设置。",
  "skills.agentOverview.title": "Agent 概览",
  "skills.metaDesc": "浏览、筛选并管理本地 Skill。",
  "sources.metaDescription": "管理本地 AI 数据源。",
  "widget.metaDescription": "{appName} 桌面快捷组件。",
};

const english: RouteCatalog = {
  "common.distillation.pageDesc":
    "Distill conversations into reusable knowledge and skills.",
  "common.reports.pageDesc": "Review usage, trends, and project reports.",
  "dashboard.meta.description": "{appName} local AI workspace overview.",
  "errors.generic": "An unknown error occurred",
  "memory.metaDescription": "Review and manage local {appName} memory.",
  "meta.titles.dashboard": "Overview · {appName}",
  "meta.titles.distill": "Distill · {appName}",
  "meta.titles.market": "Skill Market · {appName}",
  "meta.titles.memory": "Memory · {appName}",
  "meta.titles.reports": "Reports · {appName}",
  "meta.titles.security": "Security · {appName}",
  "meta.titles.sessions": "Sessions · {appName}",
  "meta.titles.settings": "Settings · {appName}",
  "meta.titles.skills": "Skill Hub · {appName}",
  "meta.titles.sources": "Sources · {appName}",
  "meta.titles.tracker": "Usage · {appName}",
  "meta.titles.widget": "Desktop Widget · {appName}",
  "security.pageDescription":
    "Review security status for skills and local workspaces.",
  "sessions.metaDescription": "Browse local AI session history.",
  "settings.pageHeaderDesc": "Manage preferences, models, and storage.",
  "skills.agentOverview.title": "Agent Overview",
  "skills.metaDesc": "Browse, filter, and manage local skills.",
  "sources.metaDescription": "Manage local AI data sources.",
  "widget.metaDescription": "{appName} desktop quick-access widget.",
};

export const catalogs: Record<Locale, RouteCatalog> = {
  "zh-CN": zhCN,
  "en-US": english,
  "ja-JP": english,
  "ko-KR": english,
};

export function getMessage(
  catalog: RouteCatalog,
  key: string,
  params?: Record<string, string | number>,
): string {
  const template = catalog[key];
  if (template == null) return key;
  if (params == null) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
