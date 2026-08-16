import { common } from "./common";
import { distill } from "./distill";
import { dashboard } from "./dashboard";
import { errors } from "./errors";
import { exportMessages } from "./export";
import { insights } from "./insights";
import { market } from "./market";
import { meta } from "./meta";
import { nav } from "./nav";
import { pricing } from "./pricing";
import { reports } from "./reports";
import { skills } from "./skills";
import { security } from "./security";
import { sessions } from "./sessions";
import { sources } from "./sources";
import { settings } from "./settings";
import { theme } from "./theme";
import { tracker } from "./tracker";

/**
 * 简体中文主字典 —— 消息 key、参数名与形状的单一事实来源。
 * 其余语言必须 `satisfies Translations`(缺失/多余 key 编译期报错)。
 */
export const zh = {
  common,
  distill,
  dashboard,
  insights,
  reports,
  pricing,

  nav,
  skills,
  security,
  sessions,
  sources,
  settings,
  market,
  tracker,
  meta,
  errors,
  export: exportMessages,
  theme,
} as const;
