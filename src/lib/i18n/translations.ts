export const zh = {
  nav: {
    dashboard: "首页总览",
    tokens: "Token 分析",
    skills: "Skill 管理",
    market: "Skill 市场",
    security: "安全检测",
    memory: "AI 记忆",
    settings: "设置",
  },
  dashboard: {
    title: "首页总览 · TrustTools V3.0",
    kpiTokens: "Token 消耗",
    kpiCost: "费用",
    kpiCache: "缓存节省",
    kpiSkills: "活跃 Skill",
    kpiSecurity: "安全扫描",
    poster: "生成海报",
  },
  settings: {
    language: "界面语言",
    languageDesc: "切换界面显示语言",
    theme: "主题",
  },
  common: {
    loading: "加载中...",
    error: "出错了",
    save: "保存",
    cancel: "取消",
  },
} as const;

type WidenLiteral<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? { [K in keyof T]: WidenLiteral<T[K]> }
    : T extends object
      ? { [K in keyof T]: WidenLiteral<T[K]> }
      : T;

export type Translations = WidenLiteral<typeof zh>;

export const en: Translations = {
  nav: {
    dashboard: "Dashboard",
    tokens: "Token Analysis",
    skills: "Skills",
    market: "Market",
    security: "Security",
    memory: "Memory",
    settings: "Settings",
  },
  dashboard: {
    title: "Dashboard · TrustTools V3.0",
    kpiTokens: "Token Usage",
    kpiCost: "Cost",
    kpiCache: "Cache Saved",
    kpiSkills: "Active Skills",
    kpiSecurity: "Security Scans",
    poster: "Generate Poster",
  },
  settings: {
    language: "Language",
    languageDesc: "Switch interface language",
    theme: "Theme",
  },
  common: {
    loading: "Loading...",
    error: "Error",
    save: "Save",
    cancel: "Cancel",
  },
};
