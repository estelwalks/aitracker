// AI 번역 초안, 검토 대기 (2026-08)
import type { Translations } from "../../schema";

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
import { tracker } from "./tracker";
import { skills } from "./skills";
import { security } from "./security";
import { sessions } from "./sessions";
import { sources } from "./sources";
import { settings } from "./settings";
import { theme } from "./theme";

export const ko = {
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
} as const satisfies Translations;
